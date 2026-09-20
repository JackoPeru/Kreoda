// CadSessionService relay (§11, Phase 11b): a WebSocket front for the
// single authoritative local core. The core stays single-threaded and
// single-document (no OCCT threading changes): this relay owns session
// semantics — client registry, pairing gate, mutation serialization with
// feature locks (§11.13), idempotent retries (§11.14), base-revision
// fencing with full-snapshot recovery (§11.6), and server-pushed deltas.
//
// Transport (§11.3): JSON text frames. Binary mesh streaming stays
// sidecar-direct for Desktop until the Quest slice needs it (Phase 12);
// the relay never invents geometry — every mutation runs through the typed
// core commands with the core's own validation and error codes.
//
// Security (§11.16): disabled unless KREODA_SESSION_PORT is set; binds
// loopback by default (KREODA_SESSION_HOST opts into LAN); every client
// must present the pairing token in `hello` or the socket is closed.

import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { decodeMeshFrame, frameMessage } from "@kreoda/protocol";
import type { SidecarManager } from "./sidecar";
import {
  normalizeSnapshot,
  runSessionQuery,
  QUERY_METHODS,
  type MeshData,
  type QueryEnv,
  type SelectionRegistry,
  type SnapshotData,
} from "./session-queries";

export const SESSION_PROTOCOL_VERSION = 1;

/** Model delta broadcast to session clients + the local renderer. */
export interface SessionDelta {
  originClientId: string;
  documentId: string;
  revision: number;
  features: unknown[];
  sketches: unknown[];
}

interface ClientInfo {
  id: string;
  ws: WebSocket;
  clientType: string;
  name: string;
}

interface PendingHello {
  authed: boolean;
}

/** Feature ids touched by one mutation (for §11.13 conflict locks). */
function mutationFeatures(
  type: number,
  fields: Record<string, unknown>,
): string[] | "*" {
  // Undo/redo and transaction control re-resolve the whole document.
  if (type === 8 || type === 9 || type === 27 || type === 28 || type === 29) {
    return "*";
  }
  const ids: string[] = [];
  const take = (v: unknown): void => {
    if (typeof v === "string" && v.length > 0) ids.push(v);
  };
  take(fields["featureId"]);
  take(fields["targetId"]);
  take(fields["sketchId"]);
  const list = fields["featureIds"];
  if (Array.isArray(list)) for (const v of list) take(v);
  const edges = fields["edgeIds"];
  if (Array.isArray(edges)) {
    for (const v of edges) {
      if (typeof v === "string") {
        const cut = v.indexOf(":");
        take(cut < 0 ? v : v.slice(0, cut));
      }
    }
  }
  return [...new Set(ids)];
}

export class SessionRelay {
  private server: WebSocketServer | null = null;
  private clients = new Map<string, ClientInfo>();
  private documentId = "doc-phase1";
  private revisionCache: number | null = null;
  private revisionPending: Promise<number> | null = null;
  // Mutation serialization (§11.13): one core mutation at a time.
  private queue: Promise<void> = Promise.resolve();
  private inFlight = new Set<string>();
  // Idempotent retries (§11.14): bounded clientId:requestId → result.
  private static readonly DEDUP_MAX = 200;
  private dedup = new Map<string, unknown>();
  private seq = 0;
  // Client-local selections published as shared metadata (§11.5).
  private selections = new Map<string, string[]>();
  // Spatial preview sessions (§11.11): visual-only until commit.
  private previews = new Map<
    string,
    {
      clientId: string;
      documentId: string;
      featureId: string;
      paramName: string;
      valueMm: number;
      expression: string;
      baseRevision: number;
    }
  >();

  private selectionRegistry(): SelectionRegistry {
    return {
      get: (id) => [...(this.selections.get(id) ?? [])],
      set: (id, ids) => {
        this.selections.set(id, [...ids]);
      },
      clear: (id) => {
        this.selections.delete(id);
      },
      drop: (id) => {
        this.selections.delete(id);
      },
    };
  }

  constructor(
    private readonly sidecar: () => SidecarManager | null,
    private readonly onDelta?: (delta: SessionDelta) => void,
  ) {}

  get clientCount(): number {
    return this.clients.size;
  }

  start(opts: { port: number; host: string; token: string }): void {
    if (this.server) throw new Error("session relay already running");
    const token = opts.token;
    if (!token) throw new Error("session relay requires a pairing token");
    this.server = new WebSocketServer({
      port: opts.port,
      host: opts.host,
      maxPayload: 1024 * 1024,
    });
    this.server.on("connection", (ws: WebSocket) =>
      this.handleConnection(ws, token),
    );
    console.log(
      `[session] relay listening on ${opts.host}:${opts.port} (protocol ${SESSION_PROTOCOL_VERSION})`,
    );
  }

  stop(): void {
    for (const c of this.clients.values()) {
      try {
        c.ws.close(1001, "relay stopping");
      } catch {
        // Best-effort.
      }
    }
    this.clients.clear();
    this.selections.clear();
    this.previews.clear();
    this.txn = null;
    this.server?.close();
    this.server = null;
  }
  /** Sidecar died/restarted: drop in-flight state; clients resync by revision. */
  onSidecarCrashed(): void {
    this.inFlight.clear();
    this.dedup.clear();
    this.previews.clear();
    this.txn = null;
    this.revisionCache = null;
    this.revisionPending = null;
    this.lastBroadcastRevision = null;
    const note = JSON.stringify({
      event: "core-restarted",
      documentId: this.documentId,
    });
    for (const c of this.clients.values()) {
      if (c.ws.readyState === WebSocket.OPEN) c.ws.send(note);
    }
  }

  /**
   * A mutation committed through a non-relay path (the local renderer's
   * toolbar/palette/AI flows call the sidecar directly). The renderer pings
   * here after every commit so remote clients observe the same delta stream.
   * Adopt document switches (new lineage: drop dedup/locks), broadcast only
   * when the revision actually advanced.
   */
  async noteLocal(
    documentId: string,
    revision: number,
    features?: unknown[],
    sketches?: unknown[],
  ): Promise<void> {
    if (!Number.isFinite(revision) || revision < 0) return;
    if (documentId !== this.documentId) {
      this.documentId = documentId;
      this.inFlight.clear();
      this.dedup.clear();
      this.revisionCache = null;
      this.lastBroadcastRevision = null;
    }
    if (
      this.lastBroadcastRevision !== null &&
      revision <= this.lastBroadcastRevision
    ) {
      if (this.revisionCache === null || revision > this.revisionCache) {
        this.revisionCache = revision;
      }
      return;
    }
    let list = Array.isArray(features) ? features : null;
    let sk = Array.isArray(sketches) ? sketches : [];
    if (!list) {
      try {
        const snap = await this.coreSnapshot(documentId);
        list = snap.features;
        sk = snap.sketches;
        revision = snap.revision;
      } catch (e) {
        console.error("[session] noteLocal snapshot failed", e);
        return;
      }
    }
    this.revisionCache = revision;
    this.broadcast(
      "desktop",
      documentId,
      revision,
      list,
      sk,
    );
  }

  private lastBroadcastRevision: number | null = null;

  private handleConnection(ws: WebSocket, token: string): void {
    const hello = { authed: false } as PendingHello;
    let clientId: string | null = null;
    const timer = setTimeout(() => {
      if (!hello.authed) {
        try {
          ws.close(4401, "hello timeout");
        } catch {
          // Best-effort.
        }
      }
    }, 10000);
    ws.on("message", (data) => {
      void this.handleMessage(ws, hello, (id) => (clientId = id), data, token);
    });
    const drop = (): void => {
      clearTimeout(timer);
      if (clientId) {
        this.clients.delete(clientId);
        this.selections.delete(clientId);
        // A dead owner must not wedge the core: best-effort rollback of its
        // open unit (recoverable via txnStatus/txnForceRollback if lost).
        this.autoRollback(clientId);
      }
    };
    ws.on("close", drop);
    ws.on("error", () => {
      // Per-socket errors must not take the relay down.
    });
  }

  private async handleMessage(
    ws: WebSocket,
    hello: PendingHello,
    setClientId: (id: string) => void,
    data: unknown,
    token: string,
  ): Promise<void> {
    let msg: {
      requestId?: unknown;
      method?: unknown;
      params?: unknown;
    };
    try {
      const text = typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8");
      msg = JSON.parse(text) as typeof msg;
    } catch {
      return; // No requestId to correlate — drop silently.
    }
    const requestId = msg.requestId;
    const reply = (ok: boolean, payload: Record<string, unknown>): void => {
      if (typeof requestId !== "string" || requestId.length === 0) return;
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ requestId, ok, ...payload }));
    };
    if (typeof msg.method !== "string") {
      reply(false, { errorCode: "MALFORMED", error: "method is required" });
      return;
    }
    const params =
      msg.params !== undefined && msg.params !== null
        ? (msg.params as Record<string, unknown>)
        : {};

    // The pairing gate (§11.16): only `hello` is reachable pre-auth, and a
    // wrong token closes the socket (no oracle beyond the close code).
    if (msg.method === "hello") {
      if (
        typeof requestId !== "string" ||
        params["token"] !== token ||
        params["protocolVersion"] !== SESSION_PROTOCOL_VERSION
      ) {
        if (params["token"] !== token) {
          console.warn("[session] rejected client (bad pairing token)");
          try {
            ws.close(4403, "bad token");
          } catch {
            // Best-effort.
          }
          return;
        }
        reply(false, {
          errorCode: "BAD_HELLO",
          error: "protocolVersion must be 1 with a requestId",
        });
        return;
      }
      const id = `client-${randomUUID()}`;
      hello.authed = true;
      setClientId(id);
      this.clients.set(id, {
        id,
        ws,
        clientType:
          typeof params["clientType"] === "string"
            ? (params["clientType"] as string)
            : "unknown",
        name:
          typeof params["clientName"] === "string"
            ? (params["clientName"] as string)
            : "",
      });
      reply(true, {
        clientId: id,
        sessionId: `session-${this.documentId}`,
        documentId: this.documentId,
        revision: await this.currentRevision(),
      });
      return;
    }
    if (!hello.authed) {
      reply(false, { errorCode: "NOT_AUTHED", error: "send hello first" });
      return;
    }
    const clientId = [...this.clients.entries()].find(
      ([, c]) => c.ws === ws,
    )?.[0];
    if (!clientId) {
      reply(false, { errorCode: "NOT_AUTHED", error: "send hello first" });
      return;
    }

    try {
      switch (msg.method) {
        case "snapshot": {
          const snap = await this.coreSnapshot(
            typeof params["documentId"] === "string" &&
              params["documentId"] !== ""
              ? (params["documentId"] as string)
              : this.documentId,
          );
          reply(true, snap);
          return;
        }
        case "invoke": {
          const type = params["type"];
          if (typeof type !== "number" || !Number.isInteger(type)) {
            reply(false, {
              errorCode: "BAD_PARAMS",
              error: "invoke needs an integer core command type",
            });
            return;
          }
          const fields =
            params["fields"] !== undefined && params["fields"] !== null
              ? (params["fields"] as Record<string, unknown>)
              : {};
          const base =
            typeof params["baseRevision"] === "number"
              ? (params["baseRevision"] as number)
              : null;
          // Joined transaction steps carry the unit id alongside the core
          // fields; the core fence (TRANSACTION_OPEN) stays authoritative.
          const joinTxn =
            typeof params["transactionId"] === "string" &&
            params["transactionId"] !== ""
              ? (params["transactionId"] as string)
              : undefined;
          const result = await this.runMutation(
            clientId,
            requestId as string,
            typeof params["documentId"] === "string" &&
              params["documentId"] !== ""
              ? (params["documentId"] as string)
              : this.documentId,
            type,
            fields,
            base,
            joinTxn ? { joinTxn } : {},
          );
          reply(true, result as Record<string, unknown>);
          return;
        }
        case "txnBegin":
        case "txnCommit":
        case "txnRollback":
        case "txnForceRollback": {
          const transactionId =
            typeof params["transactionId"] === "string"
              ? (params["transactionId"] as string)
              : "";
          const doc = this.docOf(params);
          let result: Record<string, unknown>;
          if (msg.method === "txnBegin") {
            result = await this.txnBegin(
              clientId,
              requestId as string,
              doc,
              transactionId,
            );
          } else if (msg.method === "txnCommit") {
            result = await this.txnCommit(
              clientId,
              requestId as string,
              doc,
              transactionId,
            );
          } else if (msg.method === "txnForceRollback") {
            result = await this.txnForceRollback(
              clientId,
              requestId as string,
              doc,
              transactionId,
            );
          } else {
            result = await this.txnRollback(
              clientId,
              requestId as string,
              doc,
              transactionId,
            );
          }
          reply(true, result);
          return;
        }
        case "txnStatus": {
          reply(true, {
            open: this.txn !== null,
            ...(this.txn
              ? {
                  transactionId: this.txn.transactionId,
                  ownerClientId: this.txn.ownerClientId,
                  ownerConnected: this.clients.has(this.txn.ownerClientId),
                }
              : {}),
          });
          return;
        }
        default: {
          // §11c semantic queries (read-only projections + previews).
          // Wire shape: queries reply {result} uniformly. (snapshot/invoke
          // keep their flat 11b payloads — frozen by the acceptance spec.)
          if (!(QUERY_METHODS as readonly string[]).includes(msg.method)) {
            reply(false, {
              errorCode: "NOT_IMPLEMENTED",
              error: `unknown session method: ${msg.method} (typed mutations go through invoke)`,
            });
            return;
          }
          const { result, notify } = await runSessionQuery(
            this.queryEnv(),
            this.selectionRegistry(),
            clientId,
            msg.method,
            params,
            typeof params["documentId"] === "string" &&
              params["documentId"] !== ""
              ? (params["documentId"] as string)
              : this.documentId,
          );
          reply(true, { result });
          if (notify) {
            for (const [, c] of this.clients) {
              if (c.ws.readyState !== WebSocket.OPEN) continue;
              c.ws.send(JSON.stringify({ ...notify }));
            }
          }
        }
      }
    } catch (e) {
      const code =
        typeof e === "object" && e !== null && "code" in e &&
        typeof (e as { code: unknown }).code === "string" &&
        ((e as { code: string }).code.length > 0)
          ? (e as { code: string }).code
          : "SESSION_FAILED";
      reply(false, { errorCode: code, error: this.errorMessage(e) });
    }
  }

  private errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  private async currentRevision(): Promise<number> {
    if (this.revisionCache !== null) return this.revisionCache;
    if (!this.revisionPending) {
      this.revisionPending = this.coreSnapshot(this.documentId)
        .then((s) => s.revision)
        .finally(() => {
          this.revisionPending = null;
        });
    }
    const rev = await this.revisionPending;
    this.revisionCache = rev;
    return rev;
  }

  private async coreInvoke(
    documentId: string,
    type: number,
    fields: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const raw = await this.coreInvokeRaw(documentId, type, fields);
    if (raw.length > 0 && raw[0] === 0x7b) {
      const parsed = JSON.parse(new TextDecoder().decode(raw)) as Record<
        string,
        unknown
      >;
      if (parsed["status"] === "error") {
        const err = new Error(
          (parsed["errorMessage"] as string | undefined) ?? "core error",
        ) as Error & { code?: string };
        err.code = (parsed["errorCode"] as string | undefined) ?? "CORE_FAILED";
        throw err;
      }
      return parsed;
    }
    throw new Error("binary frame on a JSON session path");
  }

  private async coreInvokeRaw(
    documentId: string,
    type: number,
    fields: Record<string, unknown>,
  ): Promise<Uint8Array> {
    const sidecar = this.sidecar();
    if (!sidecar) throw new Error("geometry engine not running");
    const envelope = {
      protocolVersion: SESSION_PROTOCOL_VERSION,
      requestId: `relay-${++this.seq}`,
      documentId,
      type,
      ...fields,
    };
    const framed = frameMessage(
      new TextEncoder().encode(JSON.stringify(envelope)),
    );
    return sidecar.invoke(new Uint8Array(framed));
  }

  private async coreSnapshot(documentId: string): Promise<{
    documentId: string;
    revision: number;
    features: unknown[];
    sketches: unknown[];
  }> {
    const parsed = await this.coreInvoke(documentId, 26, {});
    const features = Array.isArray(parsed["features"])
      ? (parsed["features"] as unknown[])
      : [];
    const sketches = Array.isArray(parsed["sketches"])
      ? (parsed["sketches"] as unknown[])
      : [];
    const revision =
      typeof parsed["revision"] === "number"
        ? (parsed["revision"] as number)
        : 0;
    return { documentId, revision, features, sketches };
  }

  /** QueryEnv for session-queries.ts: snapshot/mesh/frames/previews. */
  private queryEnv(): QueryEnv {
    const vec = (v: unknown): [number, number, number] | null => {
      if (!Array.isArray(v) || v.length < 3) return null;
      const [x, y, z] = v as unknown[];
      if (
        typeof x !== "number" ||
        typeof y !== "number" ||
        typeof z !== "number" ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(z)
      ) {
        return null;
      }
      return [x, y, z];
    };
    return {
      snapshot: async (documentId: string): Promise<SnapshotData> => {
        const snap = await this.coreSnapshot(documentId);
        return normalizeSnapshot(
          snap.documentId,
          snap.revision,
          snap.features,
          snap.sketches,
        );
      },
      mesh: async (documentId: string, featureId: string): Promise<MeshData> => {
        const raw = await this.coreInvokeRaw(documentId, 12, {
          featureId,
          lod: 1,
        });
        const mesh = decodeMeshFrame(raw);
        return {
          positions: mesh.positions,
          indices: mesh.indices,
          faces: mesh.faces,
          edges: mesh.edges,
          bboxMm: mesh.bboxMm,
          volumeMm3: mesh.volumeMm3,
        };
      },
      faceInfo: async (documentId, featureId, role) => {
        const parsed = await this.coreInvoke(documentId, 23, {
          featureId,
          faceRole: role,
        });
        const originMm = vec(parsed["originMm"]);
        const xAxis = vec(parsed["xAxis"]);
        const yAxis = vec(parsed["yAxis"]);
        const normal = vec(parsed["normal"]);
        if (!originMm || !xAxis || !yAxis || !normal) {
          throw new Error("face frame malformed");
        }
        return { originMm, xAxis, yAxis, normal };
      },
      previewBegin: async (clientId, docId, params) => {
        const featureId =
          typeof params["featureId"] === "string" ? params["featureId"] : "";
        const paramName =
          typeof params["paramName"] === "string" ? params["paramName"] : "";
        const valueMm =
          typeof params["valueMm"] === "number" ? params["valueMm"] : 0;
        const expression =
          typeof params["expression"] === "string" ? params["expression"] : "";
        if (!featureId || !paramName || (params["valueMm"] === undefined && !expression)) {
          const err = new Error(
            "previewBegin needs featureId, paramName and valueMm or expression",
          ) as Error & { code?: string };
          err.code = "BAD_PARAMS";
          throw err;
        }
        const id = `preview-${randomUUID()}`;
        const baseRevision = await this.currentRevision();
        this.previews.set(id, {
          clientId,
          documentId: docId,
          featureId,
          paramName,
          valueMm,
          expression,
          baseRevision,
        });
        return {
          previewId: id,
          ...(await this.runPreview(docId, featureId, paramName, valueMm, expression)),
        };
      },
      previewUpdate: async (clientId, previewId, params) => {
        const state = this.previewState(clientId, previewId);
        if (typeof params["valueMm"] === "number") {
          state.valueMm = params["valueMm"] as number;
          state.expression = "";
        }
        if (typeof params["expression"] === "string") {
          state.expression = params["expression"] as string;
        }
        return {
          previewId,
          ...(await this.runPreview(
            state.documentId,
            state.featureId,
            state.paramName,
            state.valueMm,
            state.expression,
          )),
        };
      },
      previewCommit: async (clientId, previewId) => {
        const state = this.previewState(clientId, previewId);
        const result = await this.runMutation(
          clientId,
          `${previewId}:commit`,
          state.documentId,
          6,
          {
            featureId: state.featureId,
            paramName: state.paramName,
            valueMm: state.valueMm,
            ...(state.expression ? { expression: state.expression } : {}),
          },
          state.baseRevision,
        );
        this.previews.delete(previewId);
        return result;
      },
      previewCancel: async (clientId, previewId) => {
        this.previewState(clientId, previewId);
        this.previews.delete(previewId);
        return { previewId, cancelled: true as const };
      },
    };
  }

  private previewState(
    clientId: string,
    previewId: string,
  ): {
    clientId: string;
    documentId: string;
    featureId: string;
    paramName: string;
    valueMm: number;
    expression: string;
    baseRevision: number;
  } {
    const state = this.previews.get(previewId);
    if (!state || state.clientId !== clientId) {
      const err = new Error(`unknown preview ${previewId}`) as Error & {
        code?: string;
      };
      err.code = "NOT_FOUND";
      throw err;
    }
    return state;
  }

  /** Transient core preview (§13): tessellated, never committed. */
  private async runPreview(
    documentId: string,
    featureId: string,
    paramName: string,
    valueMm: number,
    expression: string,
  ): Promise<Record<string, unknown>> {
    const raw = await this.coreInvokeRaw(documentId, 6, {
      featureId,
      paramName,
      valueMm,
      isPreview: true,
      ...(expression ? { expression } : {}),
    });
    let mesh;
    try {
      mesh = decodeMeshFrame(raw);
    } catch {
      // A JSON error frame decodes here when the preview itself is invalid
      // (unknown ref, bad value): surface the core's honest message.
      if (raw.length > 0 && raw[0] === 0x7b) {
        const parsed = JSON.parse(new TextDecoder().decode(raw)) as Record<
          string,
          unknown
        >;
        const err = new Error(
          (parsed["errorMessage"] as string | undefined) ?? "preview failed",
        ) as Error & { code?: string };
        err.code = (parsed["errorCode"] as string | undefined) ?? "PREVIEW_FAILED";
        throw err;
      }
      throw new Error("preview frame corrupt");
    }
    return {
      triangles: mesh.indices.length / 3,
      volumeMm3: mesh.volumeMm3,
      bboxMm: [...mesh.bboxMm],
      revision: mesh.revision,
    };
  }

  /**
   * One serialized mutation (§11.13): idempotent on clientId:requestId
   * (§11.14), fenced by baseRevision (§11.6), conflict-locked per feature.
   * Joined transaction steps (opts.joinTxn) skip fencing and broadcast —
   * the commit/rollback publishes the single atomic delta.
   */
  private runMutation(
    clientId: string,
    requestId: string,
    documentId: string,
    type: number,
    fields: Record<string, unknown>,
    baseRevision: number | null,
    opts: { joinTxn?: string; noBroadcast?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    const run = this.queue.then(async () => {
      const dedupKey = `${clientId}:${requestId}`;
      const cached = this.dedup.get(dedupKey);
      if (cached !== undefined) return cached as Record<string, unknown>;

      if (opts.joinTxn) {
        // Joined steps run inside the atomic unit: the owner was checked by
        // the caller, the revision is frozen mid-transaction by design.
        if (
          !this.txn ||
          this.txn.ownerClientId !== clientId ||
          this.txn.transactionId !== opts.joinTxn
        ) {
          const err = new Error(
            "no such open transaction for this client",
          ) as Error & { code?: string };
          err.code = "NO_TRANSACTION";
          throw err;
        }
      } else if (baseRevision !== null) {
        const current = await this.currentRevision();
        if (baseRevision !== current) {
          const err = new Error(
            `stale base revision ${baseRevision} (current ${current}) — snapshot and retry`,
          ) as Error & { code?: string };
          err.code = "NEED_FULL_SNAPSHOT";
          throw err;
        }
      }

      const scope = mutationFeatures(type, fields);
      const exclusive = scope === "*";
      // Jobs run strictly serialized on the queue, so inFlight is normally
      // empty here — this is defense-in-depth for overlapping scopes (e.g.
      // a future parallel lane): exclusive ("*") conflicts with anything
      // in flight, scoped ops conflict with "*" or shared ids.
      const clash =
        this.inFlight.size > 0 &&
        (this.inFlight.has("*") ||
          exclusive ||
          (Array.isArray(scope) && scope.some((f) => this.inFlight.has(f))));
      if (clash) {
        const err = new Error(
          "another client is mutating an overlapping feature — retry",
        ) as Error & { code?: string };
        err.code = "BUSY";
        throw err;
      }
      const held: string[] = exclusive ? ["*"] : [...(scope as string[])];
      for (const f of held) this.inFlight.add(f);
      try {
        // Joined steps must carry the unit id into the core envelope: the
        // core fence reads it there (TRANSACTION_OPEN otherwise).
        const parsed = await this.coreInvoke(documentId, type, {
          ...fields,
          ...(opts.joinTxn ? { transactionId: opts.joinTxn } : {}),
        });
        this.documentId = documentId;
        if (typeof parsed["revision"] === "number") {
          this.revisionCache = parsed["revision"] as number;
        }
        // The core echoes the SIDECAR-level requestId (relay-N): strip it
        // so it can never clobber the CLIENT-level id in reply() below
        // (spread order would otherwise break client correlation and hang
        // every mutation call — found by the relay unit test).
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { requestId: _drop, protocolVersion: _drop2, ...rest } = parsed;
        const result = {
          ...rest,
          revision: this.revisionCache ?? parsed["revision"],
        };
        this.dedup.set(dedupKey, result);
        while (this.dedup.size > SessionRelay.DEDUP_MAX) {
          const oldest = this.dedup.keys().next();
          if (oldest.done) break;
          this.dedup.delete(oldest.value);
        }
        // Server-pushed delta (§11.6): every other client + the renderer.
        // Single-record commits (creates, dimension edits) carry no list —
        // snapshot the committed state so the delta is always complete.
        // (One extra cheap JSON round-trip; tessellation never runs here.)
          // Joined transaction steps stay silent: the commit/rollback
          // publishes the single atomic delta for the whole unit. Control
          // calls that change nothing (txnBegin) stay silent too — a same-
          // revision list broadcast would otherwise wipe renderer trees.
          if (!opts.joinTxn && !opts.noBroadcast) {
          let features: unknown[] | null = Array.isArray(parsed["features"])
            ? (parsed["features"] as unknown[])
            : null;
          let sketches: unknown[] = Array.isArray(parsed["sketches"])
            ? (parsed["sketches"] as unknown[])
            : [];
          let rev = this.revisionCache ?? 0;
          if (!features) {
            const snap = await this.coreSnapshot(documentId);
            features = snap.features;
            sketches = snap.sketches;
            rev = snap.revision;
            this.revisionCache = rev;
          }
          this.broadcast(clientId, documentId, rev, features, sketches);
        }
        return result;
      } finally {
        for (const f of held) this.inFlight.delete(f);
      }
    });
    // The chain itself never rejects (callers get the per-run outcome);
    // without this, one failure would wedge every later mutation.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // §11.12 multi-command transactions: the relay tracks the open unit so a
  // dead owner never wedges the core (auto-rollback on disconnect) and a
  // transport-failed control call has a recovery path (txnStatus /
  // txnForceRollback once the owner is gone).
  private txn: { ownerClientId: string; transactionId: string } | null = null;

  private static readonly TERMINAL_TXN_CODES = new Set([
    "NO_TRANSACTION",
    "NOT_OWNER",
    "TRANSACTION_TAINTED",
  ]);

  private docOf(params: Record<string, unknown>): string {
    return typeof params["documentId"] === "string" &&
      params["documentId"] !== ""
      ? (params["documentId"] as string)
      : this.documentId;
  }

  private async txnBegin(
    clientId: string,
    requestId: string,
    documentId: string,
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    if (!transactionId) {
      const err = new Error("transactionId is required") as Error & {
        code?: string;
      };
      err.code = "BAD_PARAMS";
      throw err;
    }
    if (this.txn) {
      const err = new Error(
        `transaction ${this.txn.transactionId} already open`,
      ) as Error & { code?: string };
      err.code = "TRANSACTION_BUSY";
      throw err;
    }
    const result = await this.runMutation(clientId, requestId, documentId, 27, {
      transactionId,
    }, null, { noBroadcast: true });
    this.txn = { ownerClientId: clientId, transactionId };
    return result;
  }

  private async txnCommit(
    clientId: string,
    requestId: string,
    documentId: string,
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    try {
      const result = await this.runMutation(
        clientId,
        requestId,
        documentId,
        28,
        { transactionId },
        null,
      );
      this.txn = null;
      return result;
    } catch (e) {
      // Terminal core states mean no unit is open anymore — drop the record
      // so the next begin is not wedged. Transport failures keep it (the
      // core may still hold the unit; recover via txnRollback/txnStatus).
      const code =
        typeof e === "object" && e !== null && "code" in e
          ? (e as { code: unknown }).code
          : undefined;
      if (
        typeof code === "string" &&
        SessionRelay.TERMINAL_TXN_CODES.has(code)
      ) {
        this.txn = null;
      }
      throw e;
    }
  }

  private async txnRollback(
    clientId: string,
    requestId: string,
    documentId: string,
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    try {
      const result = await this.runMutation(
        clientId,
        requestId,
        documentId,
        29,
        { transactionId },
        null,
      );
      this.txn = null;
      return result;
    } catch (e) {
      const code =
        typeof e === "object" && e !== null && "code" in e
          ? (e as { code: unknown }).code
          : undefined;
      if (
        typeof code === "string" &&
        SessionRelay.TERMINAL_TXN_CODES.has(code)
      ) {
        this.txn = null;
      }
      throw e;
    }
  }

  private async txnForceRollback(
    clientId: string,
    requestId: string,
    documentId: string,
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    // Recovery hatch only: the recorded owner must be gone (disconnected),
    // otherwise this would nuke a live client's atomic unit.
    if (
      this.txn &&
      this.txn.transactionId === transactionId &&
      this.clients.has(this.txn.ownerClientId)
    ) {
      const err = new Error(
        "transaction owner still connected — ask it to roll back",
      ) as Error & { code?: string };
      err.code = "TRANSACTION_BUSY";
      throw err;
    }
    const result = await this.runMutation(clientId, requestId, documentId, 29, {
      transactionId,
    }, null).catch((e) => {
      const code =
        typeof e === "object" && e !== null && "code" in e
          ? (e as { code: unknown }).code
          : undefined;
      if (
        typeof code === "string" &&
        SessionRelay.TERMINAL_TXN_CODES.has(code)
      ) {
        this.txn = null;
      }
      throw e;
    });
    this.txn = null;
    return result;
  }

  private autoRollback(clientId: string): void {
    const open = this.txn;
    if (!open || open.ownerClientId !== clientId) return;
    void this.runMutation(clientId, `auto-rollback-${open.transactionId}`, this.documentId, 29, {
      transactionId: open.transactionId,
    }, null).then(
      () => {
        if (this.txn?.transactionId === open.transactionId) this.txn = null;
      },
      () => {
        // Transport failed: record stays so txnStatus reports the orphan
        // and txnForceRollback can recover it after the owner is gone.
      },
    );
  }

  private broadcast(
    originClientId: string,
    documentId: string,
    revision: number,
    features: unknown[],
    sketches: unknown[],
  ): void {    this.lastBroadcastRevision = revision;
    const delta: SessionDelta = {
      originClientId,
      documentId,
      revision,
      features,
      sketches,
    };
    for (const [id, c] of this.clients) {
      if (id === originClientId) continue;
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(JSON.stringify({ event: "delta", ...delta }));
      }
    }
    try {
      this.onDelta?.(delta);
    } catch (e) {
      console.error("[session] delta forward failed", e);
    }
  }
}
