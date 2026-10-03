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

import { createHash, randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { decodeMeshFrame, frameMessage } from "@kreoda/protocol";
import type {
  SessionEntityChange,
  SessionEntityKind,
  SessionIncrementalDelta,
  SessionModelEntity,
} from "@kreoda/protocol";
import type { SidecarManager } from "./sidecar";
import {
  normalizeSnapshot,
  runSessionQuery,
  QUERY_METHODS,
  type MeshData,
  type QueryEnv,
  type SelectionRegistry,
  type SessionBody,
  type SnapshotData,
} from "./session-queries";

export const SESSION_PROTOCOL_VERSION = 1;

/** Former full-list delta retained for legacy v1 network clients. */
interface LegacySessionDelta {
  originClientId: string;
  sessionId: string;
  documentId: string;
  revision: number;
  features: unknown[];
  sketches: unknown[];
  /** Slice 6: real bodies (bodyId/tip/history) at this revision. */
  bodies: SessionBody[];
  /** Slice 6: visible results — one tip feature id per body. */
  tips: string[];
  /** Slice 6: bodies whose membership or tip changed in this delta. */
  changedBodyIds: string[];
  /** Slice 6: tip meshes remotes must re-tessellate (tips of changed bodies). */
  changedMeshIds: string[];
  /** Slice 6: feature + body ids that disappeared (undo/delete/rollback). */
  disappearedIds: string[];
}

export interface SessionSnapshotRequired {
  event: "snapshot-required";
  sessionId: string;
  documentId: string;
  revision: number;
  originClientId: string;
}

/** Incremental events delivered to the renderer and opted-in clients. */
export type SessionDelta = SessionIncrementalDelta | SessionSnapshotRequired;

interface CommittedSnapshot {
  sessionId: string;
  documentId: string;
  revision: number;
  features: unknown[];
  sketches: unknown[];
  bodies: SessionBody[];
  tips: string[];
}

interface ClientInfo {
  /** Per-socket key. Never reused after a reconnect. */
  id: string;
  logicalClientId: string;
  principalId: string;
  ws: WebSocket;
  clientType: string;
  name: string;
  capabilities: string[];
}

interface PendingHello {
  authed: boolean;
}

interface CachedReply {
  ok: boolean;
  payload: Record<string, unknown>;
}

interface ReplayEntry {
  fingerprint: string;
  promise: Promise<CachedReply>;
  resolve: (reply: CachedReply) => void;
  settled: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOGICAL_CLIENT_PATTERN = /^client-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPERATION_METHODS = new Set([
  "invoke",
  "txnBegin",
  "txnCommit",
  "txnRollback",
  "txnForceRollback",
  "previewBegin",
  "previewUpdate",
  "previewCommit",
  "previewCancel",
  "setSelection",
  "clearSelection",
]);
const CORE_ENVELOPE_FIELDS = new Set([
  "protocolVersion",
  "requestId",
  "documentId",
  "type",
  "transactionId",
  "isPreview",
]);

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
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

/** Semantic roots changed by a command; targetId is intentionally excluded. */
function mutationAffectedIds(fields: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === "string" && value.length > 0) ids.add(value);
  };
  add(fields["featureId"]);
  add(fields["sketchId"]);
  const values = fields["featureIds"];
  if (Array.isArray(values)) for (const value of values) add(value);
  return [...ids];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function appendUnique(target: unknown[], value: unknown): void {
  const serialized = canonicalJson(value);
  if (!target.some((item) => canonicalJson(item) === serialized)) target.push(value);
}

export class SessionRelay {
  private server: WebSocketServer | null = null;
  // Socket and logical client identities are distinct: legacy requestId replay
  // is per connection; explicit operation replay survives reconnect.
  private clients = new Map<string, ClientInfo>();
  private clientPrincipals = new Map<string, string>();
  private sessionId = randomUUID();
  private documentId = "doc-phase1";
  private revisionCache: number | null = null;
  private revisionPending: Promise<number> | null = null;
  // Mutation serialization (§11.13): one core mutation at a time.
  private queue: Promise<void> = Promise.resolve();
  private inFlight = new Set<string>();
  // operationId entries live for the complete session/document lineage.
  private operationReplay = new Map<string, ReplayEntry>();
  // Legacy requestId replay lasts only until its socket closes.
  private requestReplay = new Map<string, ReplayEntry>();
  private committedBaseline: CommittedSnapshot | null = null;
  private transactionBaseline: CommittedSnapshot | null = null;
  private transactionAffectedIds = new Set<string>();
  private transactionReferenceRemaps: unknown[] = [];
  private transactionWarnings: unknown[] = [];
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

  /** Local recovery shares queue order with network mutations; no listener needed. */
  localSnapshot(): Promise<import("@kreoda/protocol").SessionModelSnapshot> {
    const run = this.queue.then(async () => {
      if (this.txn && this.txn.ownerClientId !== "desktop") {
        throw Object.assign(new Error("another client owns an open transaction"), { code: "BUSY" });
      }
      const snapshot = await this.coreSnapshot(this.documentId);
      const entity = (value: unknown): SessionModelEntity => {
        const result = asRecord(value);
        if (!result) throw new Error("snapshot contains a non-object entity");
        return result;
      };
      return {
        sessionId: this.sessionId, documentId: snapshot.documentId, revision: snapshot.revision,
        features: snapshot.features.map(entity), sketches: snapshot.sketches.map(entity),
        bodies: snapshot.bodies.map((body) => ({ ...body })),
      };
    });
    this.queue = run.then(() => {}, () => {});
    return run;
  }

  start(opts: { port: number; host: string; token: string }): void {
    if (this.server) throw new Error("session relay already running");
    const token = opts.token;
    if (!token) throw new Error("session relay requires a pairing token");
    this.sessionId = randomUUID();
    this.committedBaseline = null;
    this.clearTransactionTracking();
    this.lastBroadcastRevision = null;
    this.lastSent = null;
    this.revisionCache = null;
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
    this.clientPrincipals.clear();
    this.selections.clear();
    this.previews.clear();
    this.txn = null;
    this.committedBaseline = null;
    this.clearTransactionTracking();
    this.operationReplay.clear();
    this.requestReplay.clear();
    this.server?.close();
    this.server = null;
  }
  /** Sidecar died/restarted: drop in-flight state; clients resync by revision. */
  onSidecarCrashed(): void {
    this.sessionId = randomUUID();
    this.inFlight.clear();
    this.committedBaseline = null;
    this.clearTransactionTracking();
    this.operationReplay.clear();
    this.requestReplay.clear();
    this.previews.clear();
    this.txn = null;
    this.revisionCache = null;
    this.revisionPending = null;
    this.lastBroadcastRevision = null;
    this.lastSent = null;
    const note = JSON.stringify({
      event: "core-restarted",
      sessionId: this.sessionId,
      documentId: this.documentId,
    });
    for (const c of this.clients.values()) {
      if (c.ws.readyState === WebSocket.OPEN) c.ws.send(note);
    }
  }

  private clearTransactionTracking(): void {
    this.transactionBaseline = null;
    this.transactionAffectedIds.clear();
    this.transactionReferenceRemaps = [];
    this.transactionWarnings = [];
  }

  /**
   * A mutation committed through a non-relay path (the local renderer's
   * toolbar/palette/AI flows call the sidecar directly). The renderer pings
   * here after every commit so remote clients observe the same delta stream.
   * Adopt document switches (new lineage: drop replay/locks), broadcast only
   * when the revision actually advanced.
   */
  async noteLocal(
    documentId: string,
    revision: number,
    _features?: unknown[],
    _sketches?: unknown[],
  ): Promise<void> {
    if (!Number.isFinite(revision) || revision < 0) return;
    if (documentId !== this.documentId) {
      this.documentId = documentId;
      this.sessionId = randomUUID();
      this.txn = null;
      this.clearTransactionTracking();
      this.committedBaseline = null;
      this.inFlight.clear();
      this.operationReplay.clear();
      this.requestReplay.clear();
      this.revisionCache = null;
      this.revisionPending = null;
      this.lastBroadcastRevision = null;
      this.lastSent = null;
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
    // Renderer summaries omit sketch coordinates and can lag the kernel.
    // Use the same canonical state as remote mutations for the delta baseline.
    let canonical: Awaited<ReturnType<SessionRelay["coreSnapshot"]>>;
    try {
      canonical = await this.coreSnapshot(documentId);
    } catch (e) {
      console.error("[session] noteLocal snapshot failed", e);
      return;
    }
    const list = canonical.features;
    const sk = canonical.sketches;
    revision = canonical.revision;
    const snap = normalizeSnapshot(documentId, revision, list, sk);
    const after: CommittedSnapshot = {
      sessionId: this.sessionId,
      documentId,
      revision,
      features: list,
      sketches: sk,
      bodies: snap.bodies,
      tips: snap.tips,
    };
    const before = this.committedBaseline;
    this.revisionCache = revision;
    this.committedBaseline = after;
    this.broadcast("desktop", after, before, new Set(), [], []);
  }

  private lastBroadcastRevision: number | null = null;
  // Slice 6: last broadcast model per document (for changed/disappeared
  // diffing). A new lineage resets it: everything current is "changed",
  // nothing "disappeared".
  private lastSent: {
    documentId: string;
    ids: Set<string>;
    bodies: Map<string, { tip: string; history: string[] }>;
  } | null = null;

  private handleConnection(ws: WebSocket, token: string): void {
    const hello = { authed: false } as PendingHello;
    let connectionId: string | null = null;
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
      void this.handleMessage(ws, hello, (id) => (connectionId = id), data, token)
        .catch((e: unknown) => {
          console.error("[session] message handler failed", e);
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1011, "SESSION_FAILED");
          }
        });
    });
    const drop = (): void => {
      clearTimeout(timer);
      if (connectionId) {
        const client = this.clients.get(connectionId);
        this.clients.delete(connectionId);
        for (const key of this.requestReplay.keys()) {
          if (key.startsWith(`${connectionId}:`)) this.requestReplay.delete(key);
        }
        const clientId = client?.logicalClientId;
        if (clientId) this.selections.delete(clientId);
        for (const [id, p] of this.previews) {
          if (p.clientId === clientId) this.previews.delete(id);
        }
        // A dead owner must not wedge the core: best-effort rollback of its
        // open unit (recoverable via txnStatus/txnForceRollback if lost).
        if (clientId) this.autoRollback(clientId);
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
    setConnectionId: (id: string) => void,
    data: unknown,
    token: string,
  ): Promise<void> {
    let msg: {
      requestId?: unknown;
      method?: unknown;
      params?: unknown;
      operationId?: unknown;
      sessionId?: unknown;
    };
    let activeReplay: ReplayEntry | null = null;
    try {
      const text = typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8");
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        ws.close(4400, "MALFORMED");
        return;
      }
      msg = parsed as typeof msg;
    } catch {
      ws.close(4400, "MALFORMED");
      return; // No requestId to correlate.
    }
    const requestId = msg.requestId;
    if (typeof requestId !== "string" || requestId.trim().length === 0) {
      ws.close(4400, "MALFORMED");
      return;
    }
    const reply = (ok: boolean, payload: Record<string, unknown>): void => {
      if (activeReplay && !activeReplay.settled) {
        this.settleReplay(activeReplay, { ok, payload });
      }
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ requestId, ok, ...payload }));
    };
    if (typeof msg.method !== "string") {
      reply(false, { errorCode: "MALFORMED", error: "method is required" });
      return;
    }
    const hasParams = Object.prototype.hasOwnProperty.call(msg, "params");
    if (
      hasParams &&
      (typeof msg.params !== "object" || msg.params === null || Array.isArray(msg.params))
    ) {
      reply(false, { errorCode: "BAD_PARAMS", error: "params must be an object" });
      return;
    }
    const params = hasParams ? (msg.params as Record<string, unknown>) : {};

    // The pairing gate (§11.16): only `hello` is reachable pre-auth, and a
    // wrong token closes the socket (no oracle beyond the close code).
    if (msg.method === "hello") {
      if (hello.authed) {
        reply(false, { errorCode: "BAD_HELLO", error: "hello already completed" });
        return;
      }
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
      const hasClientId = Object.prototype.hasOwnProperty.call(params, "clientId");
      if (
        hasClientId &&
        (typeof params["clientId"] !== "string" ||
          !LOGICAL_CLIENT_PATTERN.test(params["clientId"] as string) ||
          params["clientId"] === "client-desktop")
      ) {
        reply(false, { errorCode: "BAD_PARAMS", error: "clientId must use client-UUID syntax" });
        return;
      }
      const hasCapabilities = Object.prototype.hasOwnProperty.call(params, "capabilities");
      const rawCapabilities = params["capabilities"];
      if (
        hasCapabilities &&
        (!Array.isArray(rawCapabilities) ||
          !rawCapabilities.every((capability) =>
            typeof capability === "string" && capability.trim().length > 0,
          ))
      ) {
        reply(false, { errorCode: "BAD_PARAMS", error: "capabilities must be a string array" });
        return;
      }
      const logicalClientId =
        typeof params["clientId"] === "string"
          ? params["clientId"].toLowerCase()
          : `client-${randomUUID()}`;
      const principalId = createHash("sha256").update(token).digest("hex");
      const priorPrincipal = this.clientPrincipals.get(logicalClientId);
      if (priorPrincipal !== undefined && priorPrincipal !== principalId) {
        reply(false, { errorCode: "CONFLICT", error: "client identity belongs to another principal" });
        return;
      }
      if ([...this.clients.values()].some((client) => client.logicalClientId === logicalClientId)) {
        reply(false, { errorCode: "CONFLICT", error: "client identity is already connected" });
        return;
      }
      const id = `socket-${randomUUID()}`;
      this.clientPrincipals.set(logicalClientId, principalId);
      hello.authed = true;
      setConnectionId(id);
      this.clients.set(id, {
        id,
        logicalClientId,
        principalId,
        ws,
        clientType:
          typeof params["clientType"] === "string"
            ? (params["clientType"] as string)
            : "unknown",
        name:
          typeof params["clientName"] === "string"
            ? (params["clientName"] as string)
            : "",
        capabilities: Array.isArray(rawCapabilities)
          ? [...new Set(rawCapabilities as string[])]
          : [],
      });
      reply(true, {
        clientId: logicalClientId,
        sessionId: this.sessionId,
        documentId: this.documentId,
        capabilities: ["operation-replay", "incremental-deltas"],
        revision: await this.currentRevision(),
      });
      return;
    }
    if (!hello.authed) {
      reply(false, { errorCode: "NOT_AUTHED", error: "send hello first" });
      return;
    }
    const connection = [...this.clients.entries()].find(([, c]) => c.ws === ws);
    if (!connection) {
      reply(false, { errorCode: "NOT_AUTHED", error: "send hello first" });
      return;
    }
    const [connectionId, clientInfo] = connection;
    const clientId = clientInfo.logicalClientId;

    const hasSessionId = Object.prototype.hasOwnProperty.call(msg, "sessionId");
    const hasOperationId = Object.prototype.hasOwnProperty.call(msg, "operationId");
    if (
      hasSessionId &&
      (typeof msg.sessionId !== "string" || !UUID_PATTERN.test(msg.sessionId))
    ) {
      reply(false, { errorCode: "BAD_PARAMS", error: "sessionId must be a UUID" });
      return;
    }
    if (
      hasOperationId &&
      (typeof msg.operationId !== "string" || !UUID_PATTERN.test(msg.operationId))
    ) {
      reply(false, { errorCode: "BAD_PARAMS", error: "operationId must be a UUID" });
      return;
    }
    if (hasOperationId && (!hasSessionId || !OPERATION_METHODS.has(msg.method))) {
      reply(false, { errorCode: "BAD_PARAMS", error: "operationId requires a mutating method and sessionId" });
      return;
    }
    if (
      hasSessionId &&
      (msg.sessionId as string).toLowerCase() !== this.sessionId
    ) {
      reply(false, {
        errorCode: "NEED_FULL_SNAPSHOT",
        error: "session identity changed; fetch a full snapshot",
      });
      return;
    }
    const hasDocumentId = Object.prototype.hasOwnProperty.call(params, "documentId");
    if (
      hasDocumentId &&
      (typeof params["documentId"] !== "string" ||
        (params["documentId"] as string).trim().length === 0)
    ) {
      reply(false, { errorCode: "BAD_PARAMS", error: "documentId must be a non-empty string" });
      return;
    }
    const documentId =
      typeof params["documentId"] === "string"
        ? (params["documentId"] as string)
        : this.documentId;
    if (documentId !== this.documentId) {
      reply(false, {
        errorCode: "NEED_FULL_SNAPSHOT",
        error: "document identity changed; fetch a full snapshot",
      });
      return;
    }

    if (OPERATION_METHODS.has(msg.method)) {
      const fingerprint = canonicalJson({ method: msg.method, params });
      const operationId =
        typeof msg.operationId === "string" ? msg.operationId.toLowerCase() : null;
      const replayMap = operationId ? this.operationReplay : this.requestReplay;
      const replayKey = operationId
        ? JSON.stringify([
            clientInfo.principalId,
            clientId,
            this.sessionId,
            documentId,
            operationId,
          ])
        : `${connectionId}:${requestId}`;
      const existing = replayMap.get(replayKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          reply(false, {
            errorCode: "CONFLICT",
            error: "operation identity was already used for a different request",
          });
          return;
        }
        const cached = await existing.promise;
        reply(cached.ok, cached.payload);
        return;
      }
      activeReplay = this.createReplayEntry(fingerprint);
      replayMap.set(replayKey, activeReplay);
    }

    try {
      switch (msg.method) {
        case "snapshot": {
          const snap = await this.coreSnapshot(
            documentId,
          );
          reply(true, { ...snap, sessionId: this.sessionId });
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
          if (type === 27 || type === 28 || type === 29) {
            reply(false, {
              errorCode: "BAD_PARAMS",
              error: "use txnBegin, txnCommit, or txnRollback for transaction control",
            });
            return;
          }
          const rawFields = params["fields"];
          if (
            rawFields !== undefined &&
            (typeof rawFields !== "object" ||
              rawFields === null ||
              Array.isArray(rawFields))
          ) {
            reply(false, {
              errorCode: "BAD_PARAMS",
              error: "invoke fields must be an object",
            });
            return;
          }
          const fields =
            (rawFields as Record<string, unknown> | undefined) ?? {};
          if ([...CORE_ENVELOPE_FIELDS].some((key) => Object.hasOwn(fields, key))) {
            reply(false, {
              errorCode: "BAD_PARAMS",
              error: "invoke fields cannot override core envelope or preview metadata",
            });
            return;
          }
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
              doc,
              transactionId,
            );
          } else if (msg.method === "txnCommit") {
            result = await this.txnCommit(
              clientId,
              doc,
              transactionId,
            );
          } else if (msg.method === "txnForceRollback") {
            result = await this.txnForceRollback(
              clientId,
              doc,
              transactionId,
            );
          } else {
            result = await this.txnRollback(
              clientId,
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
                  ownerConnected: this.isLogicalClientConnected(this.txn.ownerClientId),
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

  private createReplayEntry(fingerprint: string): ReplayEntry {
    let resolve!: (reply: CachedReply) => void;
    const promise = new Promise<CachedReply>((done) => {
      resolve = done;
    });
    return { fingerprint, promise, resolve, settled: false };
  }

  private settleReplay(entry: ReplayEntry, reply: CachedReply): void {
    if (entry.settled) return;
    entry.settled = true;
    const payload = JSON.parse(JSON.stringify(reply.payload)) as Record<string, unknown>;
    entry.resolve({ ok: reply.ok, payload });
  }

  private isLogicalClientConnected(clientId: string): boolean {
    return [...this.clients.values()].some(
      (client) => client.logicalClientId === clientId,
    );
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
    const commandFields = Object.fromEntries(
      Object.entries(fields).filter(([key]) => !CORE_ENVELOPE_FIELDS.has(key)),
    );
    const envelope = {
      protocolVersion: SESSION_PROTOCOL_VERSION,
      requestId: `relay-${++this.seq}`,
      documentId,
      type,
      transactionId:
        typeof fields["transactionId"] === "string"
          ? (fields["transactionId"] as string)
          : "",
      isPreview: fields["isPreview"] === true,
      ...commandFields,
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
    bodies: SessionBody[];
    tips: string[];
  }> {
    const parsed = await this.coreInvoke(documentId, 26, {});
    const features = Array.isArray(parsed["features"])
      ? (parsed["features"] as unknown[])
      : [];
    const sketchSummaries = Array.isArray(parsed["sketches"])
      ? (parsed["sketches"] as unknown[])
      : [];
    // Counts alone cannot distinguish coordinate edits or their Undo/Redo.
    // Read the canonical sketch model so semantic deltas remain accurate.
    const sketches: unknown[] = [];
    for (const summary of sketchSummaries) {
      const record = asRecord(summary);
      if (typeof record?.["featureId"] !== "string") {
        throw new Error("snapshot contains a sketch without featureId");
      }
      const full = await this.coreInvoke(documentId, 17, { featureId: record["featureId"] });
      const sketch = asRecord(full["sketch"]);
      if (!sketch || !asRecord(sketch["model"])) {
        throw new Error("canonical sketch response is missing its model");
      }
      sketches.push({ ...record, ...sketch, featureId: record["featureId"] });
    }
    const revision =
      typeof parsed["revision"] === "number"
        ? (parsed["revision"] as number)
        : 0;
    // Slice 6: the core wire stays feature-flat (Slice 7 owns the protocol);
    // bodies/tips are derived here by the BodyStore rule (read-only).
    const snap = normalizeSnapshot(documentId, revision, features, sketches);
    return { documentId, revision, features, sketches, bodies: snap.bodies, tips: snap.tips };
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
   * One serialized mutation (§11.13): replay is handled by the request
   * envelope before this queue; fence by baseRevision (§11.6), conflict-lock
   * per feature.
   * Joined transaction steps (opts.joinTxn) skip fencing and broadcast —
   * the commit/rollback publishes the single atomic delta.
   */
  private runMutation(
    clientId: string,
    documentId: string,
    type: number,
    fields: Record<string, unknown>,
    baseRevision: number | null,
    opts: {
      joinTxn?: string;
      noBroadcast?: boolean;
      allowOrphanRollback?: boolean;
      beginTxn?: { ownerClientId: string; transactionId: string };
    } = {},
  ): Promise<Record<string, unknown>> {
    const run = this.queue.then(async () => {
      if (opts.beginTxn) {
        if (!this.isLogicalClientConnected(opts.beginTxn.ownerClientId)) {
          const err = new Error("transaction owner disconnected before begin") as Error & {
            code?: string;
          };
          err.code = "CLIENT_DISCONNECTED";
          throw err;
        }
        if (this.txn) {
          const err = new Error(
            `transaction ${this.txn.transactionId} already open`,
          ) as Error & { code?: string };
          err.code = "TRANSACTION_BUSY";
          throw err;
        }
        // Reserve in queue order, immediately before the native await. This
        // keeps earlier queued mutations ahead of the new transaction while
        // still letting disconnect enqueue rollback during a slow begin.
        this.txn = opts.beginTxn;
      }

      if (!opts.allowOrphanRollback) {
        if (type === 28 || type === 29) {
          const transactionId =
            typeof fields["transactionId"] === "string"
              ? (fields["transactionId"] as string)
              : "";
          if (!transactionId) {
            const err = new Error("transactionId is required") as Error & {
              code?: string;
            };
            err.code = "BAD_PARAMS";
            throw err;
          }
          if (!this.txn || this.txn.transactionId !== transactionId) {
            const err = new Error("no matching session transaction") as Error & {
              code?: string;
            };
            err.code = "NO_TRANSACTION";
            throw err;
          }
          if (this.txn.ownerClientId !== clientId) {
            const err = new Error("transaction belongs to another client") as Error & {
              code?: string;
            };
            err.code = "NOT_OWNER";
            throw err;
          }
        } else if (this.txn && this.txn.ownerClientId !== clientId) {
          const err = new Error("another client owns the active transaction") as Error & {
            code?: string;
          };
          err.code = "BUSY";
          throw err;
        }
      }

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
        const terminalTxn = type === 28 || type === 29;
        let before: CommittedSnapshot | null = null;
        if (opts.joinTxn) {
          // The begin snapshot is the baseline for the complete atomic unit.
          before = this.transactionBaseline;
        } else if (terminalTxn) {
          before = this.transactionBaseline;
        } else {
          // Capture inside the serialized queue, immediately before native
          // mutation. This detects changes made through Desktop-local paths
          // and supplies the only valid baseRevision for the patch.
          const snap = await this.coreSnapshot(documentId);
          before = this.committedSnapshot(snap);
          if (baseRevision !== null && snap.revision !== baseRevision) {
            const err = new Error(
              `stale base revision ${baseRevision} (current ${snap.revision}) — snapshot and retry`,
            ) as Error & { code?: string };
            err.code = "NEED_FULL_SNAPSHOT";
            throw err;
          }
          this.revisionCache = snap.revision;
          this.committedBaseline = before;
          if (opts.beginTxn) this.transactionBaseline = before;
        }

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
        const affectedIds = mutationAffectedIds(fields);
        const referenceRemaps = Array.isArray(parsed["referenceRemaps"])
          ? parsed["referenceRemaps"]
          : [];
        const warnings = Array.isArray(parsed["warnings"])
          ? parsed["warnings"]
          : [];
        if (opts.joinTxn) {
          for (const id of affectedIds) this.transactionAffectedIds.add(id);
          for (const remap of referenceRemaps) {
            appendUnique(this.transactionReferenceRemaps, remap);
          }
          for (const warning of warnings) {
            appendUnique(this.transactionWarnings, warning);
          }
        } else if (terminalTxn) {
          for (const remap of referenceRemaps) {
            appendUnique(this.transactionReferenceRemaps, remap);
          }
          for (const warning of warnings) {
            appendUnique(this.transactionWarnings, warning);
          }
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
        // Joined steps stay silent. Begin only captures the transaction
        // baseline; terminal commit/rollback publishes one atomic patch.
        if (opts.beginTxn || opts.joinTxn || opts.noBroadcast) return result;

        let after: CommittedSnapshot;
        try {
          after = this.committedSnapshot(await this.coreSnapshot(documentId));
        } catch (e) {
          console.error("[session] post-mutation snapshot failed", e);
          const revision = this.revisionCache ?? 0;
          this.committedBaseline = null;
          this.sendSnapshotRequired(clientId, documentId, revision);
          if (terminalTxn) this.clearTransactionTracking();
          return result;
        }
        this.revisionCache = after.revision;
        this.committedBaseline = after;

        const roots = terminalTxn
          ? new Set(this.transactionAffectedIds)
          : new Set(affectedIds);
        if (before && after.revision > before.revision) {
          const remaps = terminalTxn
            ? this.transactionReferenceRemaps
            : referenceRemaps;
          const notices = terminalTxn ? this.transactionWarnings : warnings;
          this.broadcast(clientId, after, before, roots, remaps, notices);
        } else if (!before) {
          this.broadcast(clientId, after, null, roots, [], []);
        }
        if (terminalTxn) this.clearTransactionTracking();
        return { ...result, revision: after.revision };
      } catch (e) {
        const code =
          typeof e === "object" && e !== null && "code" in e
            ? (e as { code: unknown }).code
            : undefined;
        if (
          opts.beginTxn &&
          code !== undefined &&
          this.txn?.transactionId === opts.beginTxn.transactionId &&
          this.txn.ownerClientId === opts.beginTxn.ownerClientId
        ) {
          this.txn = null;
          this.clearTransactionTracking();
        }
        throw e;
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

  private clearTerminalTxn(e: unknown, transactionId: string): void {
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? (e as { code: unknown }).code
        : undefined;
    if (
      this.txn?.transactionId === transactionId &&
      (code === "TRANSACTION_TAINTED" || code === "NO_TRANSACTION")
    ) {
      this.txn = null;
      this.clearTransactionTracking();
    }
  }

  private docOf(params: Record<string, unknown>): string {
    return typeof params["documentId"] === "string" &&
      params["documentId"] !== ""
      ? (params["documentId"] as string)
      : this.documentId;
  }

  private async txnBegin(
    clientId: string,
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
    return this.runMutation(clientId, documentId, 27, {
        transactionId,
      },
      null,
      { noBroadcast: true, beginTxn: { ownerClientId: clientId, transactionId } },
    );
  }

  private async txnCommit(
    clientId: string,
    documentId: string,
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    try {
      const result = await this.runMutation(
        clientId,
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
      this.clearTerminalTxn(e, transactionId);
      throw e;
    }
  }

  private async txnRollback(
    clientId: string,
    documentId: string,
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    try {
      const result = await this.runMutation(
        clientId,
        documentId,
        29,
        { transactionId },
        null,
      );
      this.txn = null;
      return result;
    } catch (e) {
      this.clearTerminalTxn(e, transactionId);
      throw e;
    }
  }

  private async txnForceRollback(
    clientId: string,
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
    // Recovery hatch only: the recorded owner must be disconnected.
    const open = this.txn;
    if (!open || open.transactionId !== transactionId) {
      const err = new Error("no matching session transaction") as Error & {
        code?: string;
      };
      err.code = "NO_TRANSACTION";
      throw err;
    }
    if (this.isLogicalClientConnected(open.ownerClientId)) {
      const err = new Error(
        "transaction owner still connected — ask it to roll back",
      ) as Error & { code?: string };
      err.code = "TRANSACTION_BUSY";
      throw err;
    }
    const result = await this.runMutation(
      clientId,
      documentId,
      29,
      { transactionId },
      null,
      { allowOrphanRollback: true },
    ).catch((e) => {
      this.clearTerminalTxn(e, transactionId);
      throw e;
    });
    this.txn = null;
    return result;
  }

  private autoRollback(clientId: string): void {
    const open = this.txn;
    if (!open || open.ownerClientId !== clientId) return;
    // coreInvokeRaw assigns this internal cleanup a fresh relay-N requestId.
    void this.runMutation(
      clientId,
      this.documentId,
      29,
      { transactionId: open.transactionId },
      null,
    ).then(
      () => {
        if (this.txn?.transactionId === open.transactionId) this.txn = null;
      },
      (e: unknown) => {
        // Transport failed: record stays so txnStatus reports the orphan
        // and txnForceRollback can recover it after the owner is gone.
        this.clearTerminalTxn(e, open.transactionId);
      },
    );
  }

  private committedSnapshot(snap: Awaited<ReturnType<SessionRelay["coreSnapshot"]>>): CommittedSnapshot {
    return {
      sessionId: this.sessionId,
      documentId: snap.documentId,
      revision: snap.revision,
      features: snap.features,
      sketches: snap.sketches,
      bodies: snap.bodies,
      tips: snap.tips,
    };
  }

  private sendSnapshotRequired(
    originClientId: string,
    documentId: string,
    revision: number,
  ): void {
    const event: SessionSnapshotRequired = {
      event: "snapshot-required",
      sessionId: this.sessionId,
      documentId,
      revision,
      originClientId,
    };
    for (const client of this.clients.values()) {
      if (
        client.capabilities.includes("incremental-deltas") &&
        client.ws.readyState === WebSocket.OPEN
      ) {
        client.ws.send(JSON.stringify(event));
      }
    }
    try {
      this.onDelta?.(event);
    } catch (e) {
      console.error("[session] snapshot-required forward failed", e);
    }
  }

  private incrementalDelta(
    after: CommittedSnapshot,
    before: CommittedSnapshot,
    affectedIds: Set<string>,
    referenceRemaps: unknown[],
    warnings: unknown[],
  ): SessionIncrementalDelta {
    const currentNormalized = normalizeSnapshot(
      after.documentId,
      after.revision,
      after.features,
      after.sketches,
    );
    const affectedClosure = new Set(affectedIds);
    // Undo/Redo have no featureId in their command. Actual semantic changes,
    // including sketch coordinates, must seed mesh invalidation as well.
    for (const kind of ["features", "sketches"] as const) {
      const previous = new Map(before[kind].map((value) => {
        const record = asRecord(value);
        return [record?.["featureId"], record] as const;
      }));
      for (const value of after[kind]) {
        const record = asRecord(value);
        const id = record?.["featureId"];
        if (typeof id === "string" && canonicalJson(previous.get(id)) !== canonicalJson(record)) {
          affectedClosure.add(id);
        }
      }
    }
    let grew = true;
    while (grew) {
      grew = false;
      for (const feature of currentNormalized.features) {
        if (
          !affectedClosure.has(feature.featureId) &&
          feature.dependsOn.some((dependency) => affectedClosure.has(dependency))
        ) {
          affectedClosure.add(feature.featureId);
          grew = true;
        }
      }
    }

    const added: SessionEntityChange[] = [];
    const updated: SessionEntityChange[] = [];
    const diffCollection = (
      kind: SessionEntityKind,
      oldValues: unknown[],
      newValues: unknown[],
      forced: Set<string> = new Set(),
    ): void => {
      const idKey = kind === "body" ? "bodyId" : "featureId";
      const old = oldValues.map((value, index) => {
        const record = asRecord(value);
        const id = record?.[idKey];
        if (typeof id !== "string" || id.length === 0) {
          throw new Error(`snapshot contains ${kind} without ${idKey}`);
        }
        return { id, value: record as SessionModelEntity, index };
      });
      const current = newValues.map((value, index) => {
        const record = asRecord(value);
        const id = record?.[idKey];
        if (typeof id !== "string" || id.length === 0) {
          throw new Error(`snapshot contains ${kind} without ${idKey}`);
        }
        return { id, value: record as SessionModelEntity, index };
      });
      const oldById = new Map(old.map((entry) => [entry.id, entry]));
      for (const entry of current) {
        const previous = oldById.get(entry.id);
        const change: SessionEntityChange = {
          kind,
          id: entry.id,
          index: entry.index,
          value: entry.value,
        };
        if (!previous) {
          added.push(change);
        } else if (
          previous.index !== entry.index ||
          canonicalJson(previous.value) !== canonicalJson(entry.value) ||
          forced.has(entry.id)
        ) {
          updated.push(change);
        }
      }
    };

    diffCollection("feature", before.features, after.features, affectedClosure);
    diffCollection("sketch", before.sketches, after.sketches, affectedClosure);
    diffCollection("body", before.bodies, after.bodies);

    const idsOf = (kind: SessionEntityKind, values: unknown[]): string[] => {
      const key = kind === "body" ? "bodyId" : "featureId";
      return values.flatMap((value) => {
        const id = asRecord(value)?.[key];
        return typeof id === "string" && id.length > 0 ? [id] : [];
      });
    };
    const oldIds = new Set([
      ...idsOf("feature", before.features),
      ...idsOf("sketch", before.sketches),
      ...idsOf("body", before.bodies),
    ]);
    const newIds = new Set([
      ...idsOf("feature", after.features),
      ...idsOf("sketch", after.sketches),
      ...idsOf("body", after.bodies),
    ]);
    const removedIds = [...oldIds].filter((id) => !newIds.has(id));
    const changedMeshes = new Set<string>();
    const oldBodies = new Map(
      before.bodies.flatMap((value) => {
        const body = asRecord(value);
        return typeof body?.["bodyId"] === "string"
          ? [[body["bodyId"] as string, body] as const]
          : [];
      }),
    );
    const newBodies = new Map(
      after.bodies.flatMap((value) => {
        const body = asRecord(value);
        return typeof body?.["bodyId"] === "string"
          ? [[body["bodyId"] as string, body] as const]
          : [];
      }),
    );
    for (const [bodyId, oldBody] of oldBodies) {
      const newBody = newBodies.get(bodyId);
      if (
        !newBody || canonicalJson(oldBody) !== canonicalJson(newBody)
      ) {
        if (typeof oldBody["tip"] === "string") changedMeshes.add(oldBody["tip"]);
        if (typeof newBody?.["tip"] === "string") changedMeshes.add(newBody["tip"]);
      }
    }
    for (const [bodyId, newBody] of newBodies) {
      if (!oldBodies.has(bodyId) && typeof newBody["tip"] === "string") {
        changedMeshes.add(newBody["tip"]);
      }
      const history = newBody["history"];
      if (
        Array.isArray(history) &&
        history.some((id) => typeof id === "string" && affectedClosure.has(id)) &&
        typeof newBody["tip"] === "string"
      ) {
        changedMeshes.add(newBody["tip"]);
      }
    }
    for (const feature of currentNormalized.features) {
      if (feature.type === "Instance" && affectedClosure.has(feature.featureId)) {
        changedMeshes.add(feature.featureId);
      }
    }

    return {
      event: "delta",
      baseRevision: before.revision,
      newRevision: after.revision,
      revision: after.revision,
      sessionId: after.sessionId,
      documentId: after.documentId,
      originClientId: "",
      added,
      updated,
      removedIds,
      changedMeshIds: [...changedMeshes],
      referenceRemaps: [...referenceRemaps],
      warnings: [...warnings],
    };
  }

  private broadcast(
    originClientId: string,
    after: CommittedSnapshot,
    before: CommittedSnapshot | null,
    affectedIds: Set<string>,
    referenceRemaps: unknown[],
    warnings: unknown[],
  ): void {
    if (
      before &&
      before.sessionId === after.sessionId &&
      before.documentId === after.documentId &&
      after.revision <= before.revision
    ) {
      this.lastBroadcastRevision = after.revision;
      return;
    }
    this.lastBroadcastRevision = after.revision;

    // Legacy v1 clients retain the exact full-list event and skip-origin
    // behavior. New clients opt in to the smaller ordered entity patch.
    const snap = normalizeSnapshot(
      after.documentId,
      after.revision,
      after.features,
      after.sketches,
    );
    const prev =
      this.lastSent && this.lastSent.documentId === after.documentId
        ? this.lastSent
        : null;
    const changedBodyIds: string[] = [];
    for (const body of snap.bodies) {
      const prior = prev?.bodies.get(body.bodyId);
      if (
        !prior || prior.tip !== body.tip ||
        prior.history.length !== body.history.length ||
        prior.history.some((id, i) => id !== body.history[i])
      ) changedBodyIds.push(body.bodyId);
    }
    const currentIds = new Set<string>([
      ...snap.features.map((feature) => feature.featureId),
      ...snap.bodies.map((body) => body.bodyId),
    ]);
    const disappearedIds = prev
      ? [...prev.ids].filter((id) => !currentIds.has(id))
      : [];
    const changedTips = new Set(
      snap.bodies
        .filter((body) => changedBodyIds.includes(body.bodyId))
        .map((body) => body.tip),
    );
    this.lastSent = {
      documentId: after.documentId,
      ids: currentIds,
      bodies: new Map(
        snap.bodies.map((body) => [body.bodyId, {
          tip: body.tip,
          history: [...body.history],
        }]),
      ),
    };
    const legacyDelta: LegacySessionDelta = {
      originClientId,
      sessionId: after.sessionId,
      documentId: after.documentId,
      revision: after.revision,
      features: after.features,
      sketches: after.sketches,
      bodies: snap.bodies,
      tips: snap.tips,
      changedBodyIds,
      changedMeshIds: [...changedTips],
      disappearedIds,
    };
    for (const client of this.clients.values()) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      if (client.capabilities.includes("incremental-deltas")) {
        continue;
      }
      if (client.logicalClientId !== originClientId) {
        client.ws.send(JSON.stringify({ event: "delta", ...legacyDelta }));
      }
    }

    let event: SessionDelta;
    const usableBefore = before &&
      before.sessionId === after.sessionId &&
      before.documentId === after.documentId &&
      after.revision > before.revision
      ? before
      : null;
    if (usableBefore) {
      const incremental = this.incrementalDelta(
        after,
        usableBefore,
        affectedIds,
        referenceRemaps,
        warnings,
      );
      event = { ...incremental, originClientId };
      for (const client of this.clients.values()) {
        if (
          client.capabilities.includes("incremental-deltas") &&
          client.ws.readyState === WebSocket.OPEN
        ) client.ws.send(JSON.stringify(event));
      }
    } else {
      event = {
        event: "snapshot-required",
        sessionId: after.sessionId,
        documentId: after.documentId,
        revision: after.revision,
        originClientId,
      };
      for (const client of this.clients.values()) {
        if (
          client.capabilities.includes("incremental-deltas") &&
          client.ws.readyState === WebSocket.OPEN
        ) client.ws.send(JSON.stringify(event));
      }
    }
    try {
      this.onDelta?.(event);
    } catch (e) {
      console.error("[session] delta forward failed", e);
    }
  }
}
