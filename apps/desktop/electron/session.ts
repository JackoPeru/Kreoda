// CadSessionService relay (§11, Phase 11b): a WebSocket front for the
// single authoritative local core. The core stays single-threaded and
// single-document (no OCCT threading changes): this relay owns session
// semantics — client registry, pairing gate, mutation serialization with
// feature locks (§11.13), idempotent retries (§11.14), base-revision
// fencing with full-snapshot recovery (§11.6), and server-pushed deltas.
//
// Transport (§11.3): JSON control frames; opted-in clients receive the
// unchanged native MeshUpdate as a binary frame after its JSON identity header.
//
// Security (§11.16): transport is disabled by default. Explicit enable binds
// loopback or an assigned private IPv4 interface. Pair/authenticate exchanges
// owner-protected device credentials for a current listener token; hello
// creates the connected identity. Explicit bootstrap tokens are for tests.

import { createHash, randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { decodeMeshFrame, decodeMeshUpdateFb, frameMessage, FrameDecoder, InvokeParamsSchema, NamedCommandParamsSchema, PairParamsSchema, AuthenticateParamsSchema,
  MeshHeaderSchema, RequestMeshLODParamsSchema, PreviewMeshHeaderSchema, RequestPreviewMeshParamsSchema, OPERATION_METHODS as OPERATION_METHOD_NAMES,
  SESSION_CONTROL_MAX_PAYLOAD_BYTES, SESSION_CONTROL_VERSION, SESSION_SERVER_CAPABILITIES } from "@kreoda/protocol";
import type { RequestMeshLODParams, RequestPreviewMeshParams, PreviewMeshHeader, SelectionEvent } from "@kreoda/protocol";
import { commandNativeRequest, commandCreatesFeature, validateLegacyNativeCommand } from "@kreoda/command-schema";
import type {
  SessionEntityChange,
  SessionEntityKind,
  SessionIncrementalDelta,
  SessionModelEntity,
} from "@kreoda/protocol";
import type { SidecarManager } from "./sidecar";
import type { SessionDevices } from "./session-devices";
import { validateSessionListener } from "./session-listener";
import type { SessionConnectionStatus } from "./session-control-ui";
import {
  normalizeSnapshot,
  runSessionQuery,
  QUERY_METHODS,
  type MeshData,
  type QueryEnv,
  coded,
  type SelectionRegistry,
  type SessionBody,
  type SnapshotData,
} from "./session-queries";

export const SESSION_PROTOCOL_VERSION = SESSION_CONTROL_VERSION;
const MAX_CONTROL_PAYLOAD_BYTES = SESSION_CONTROL_MAX_PAYLOAD_BYTES;
const MAX_BINARY_MESH_BYTES = 64 * 1024 * 1024;
const MAX_OUTBOUND_PEER_BYTES = 64 * 1024 * 1024;
const MAX_RETAINED_PREVIEW_BYTES = 256 * 1024 * 1024;
const MAX_CLIENT_PREVIEWS = 4;
export function serializeSessionControlReply(requestId: string, ok: boolean, payload: Record<string, unknown>): {
  ok: boolean; payload: Record<string, unknown>; text: string;
} {
  let finalOk = ok;
  let finalPayload = payload;
  let text = JSON.stringify({ requestId, ok: finalOk, ...finalPayload });
  if (Buffer.byteLength(text) > MAX_CONTROL_PAYLOAD_BYTES) {
    finalOk = false;
    finalPayload = { errorCode: "MESSAGE_TOO_LARGE", error: "session control reply exceeds 64 MiB" };
    text = JSON.stringify({ requestId, ok: finalOk, ...finalPayload });
  }
  return { ok: finalOk, payload: finalPayload, text };
}
interface PreviewState {
  clientId: string; sessionId: string; documentId: string; featureId: string;
  paramName: string; valueMm: number; expression: string; baseRevision: number;
  bodyId: string; targetTipId: string; previewId: string; generation: number;
  values: Record<string, number>; raw: Uint8Array; header?: PreviewMeshHeader;
  release: () => void; pending: Promise<void>;
}

/** Former full-list delta retained for legacy v1 network clients. */
interface LegacySessionDelta {
  originClientId: string;
  sessionId: string;
  documentId: string;
  revision: number;
  features: unknown[];
  sketches: unknown[];
  datums: unknown[];
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
export type SessionSelection = SelectionEvent & { sessionId: string; documentId: string; revision: number };

interface CommittedSnapshot {
  sessionId: string;
  documentId: string;
  revision: number;
  features: unknown[];
  sketches: unknown[];
  datums: unknown[];
  bodies: SessionBody[];
  tips: string[];
}

interface ClientInfo {
  /** Per-socket key. Never reused after a reconnect. */
  id: string;
  logicalClientId: string;
  principalId: string;
  deviceId?: string;
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
const OPERATION_METHODS = new Set<string>(OPERATION_METHOD_NAMES);
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
  if ([2, 8, 9, 10, 11, 27, 28, 29].includes(type)) {
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
  private reservations = new Map<string, { clientId: string; scope: string[] | "*" }>();
  private localPreviews = new Map<string, () => void>();
  private pendingTxn: { ownerClientId: string; transactionId: string } | null = null;
  private localGeneration = 0;
  private localConnected = true;
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
  private publishedSelections = new Map<string, string[]>();
  // Spatial preview sessions (§11.11): visual-only until commit.
  private previews = new Map<string, PreviewState>();

  private selectionRegistry(): SelectionRegistry {
    return {
      get: (id, requester) => [...((id === requester ? this.selections : this.publishedSelections).get(id) ?? [])],
      set: (id, ids, publish) => {
        this.selections.set(id, [...ids]);
        if (publish) this.publishedSelections.set(id, [...ids]);
      },
      clear: (id, publish) => {
        this.selections.delete(id);
        if (publish) this.publishedSelections.delete(id);
      },
      drop: (id) => {
        this.selections.delete(id);
        this.publishedSelections.delete(id);
      },
    };
  }

  constructor(
    private readonly sidecar: () => SidecarManager | null,
    private readonly onDelta?: (delta: SessionDelta) => void,
    private readonly devices?: SessionDevices,
    private readonly onSelection?: (event: SessionSelection) => void,
  ) {}

  private selectionStamp(clientId: string, ids: string[]): SessionSelection {
    return { event: "selection", clientId, ids: [...ids],
      sessionId: this.sessionId, documentId: this.documentId,
      revision: this.committedBaseline?.revision ?? this.revisionCache ?? 0 };
  }

  private emitSelection(clientId: string, ids: string[], captured?: SessionSelection): void {
    const event = captured ?? this.selectionStamp(clientId, ids);
    const serialized = JSON.stringify(event);
    for (const client of this.clients.values())
      if (client.ws.readyState === WebSocket.OPEN) client.ws.send(serialized);
    try { this.onSelection?.(event); }
    catch { console.error("[session] selection forward failed"); }
  }

  private clearSharedTargets(): void {
    for (const clientId of this.publishedSelections.keys()) this.emitSelection(clientId, []);
    this.publishedSelections.clear();
  }

  get clientCount(): number {
    return this.clients.size;
  }

  private scopeWithDependencies(scope: string[] | "*"): string[] | "*" {
    if (scope === "*") return scope;
    const ids = new Set(scope);
    let changed = true;
    while (changed) {
      changed = false;
      for (const value of this.committedBaseline?.features ?? []) {
        const feature = asRecord(value);
        const id = feature?.["featureId"];
        const dependencies = feature?.["dependsOn"];
        if (typeof id === "string" && !ids.has(id) && Array.isArray(dependencies) && dependencies.some(parent => ids.has(parent))) {
          ids.add(id);changed = true;
        }
      }
    }
    return [...ids];
  }

  private reserve(clientId: string, scope: string[] | "*"): () => void {
    scope = this.scopeWithDependencies(scope);
    for (const held of this.reservations.values()) {
      if (held.clientId !== clientId && (scope === "*" || held.scope === "*" || scope.some(id => held.scope.includes(id)))) {
        throw coded("BUSY", "another client owns an overlapping edit");
      }
    }
    const id = randomUUID();this.reservations.set(id, { clientId, scope });
    return () => { this.reservations.delete(id); };
  }

  private assertReadOwner(clientId: string): void {
    const active = this.txn ?? this.pendingTxn;
    if (active && active.ownerClientId !== clientId) throw coded("BUSY", "another client owns an active transaction");
  }

  private orderedRead<T>(clientId: string, documentId: string | null, read: () => Promise<T>, localGeneration?: number): Promise<T> {
    try { if (documentId !== null) this.assertReadOwner(clientId); } catch (error) { return Promise.reject(error); }
    const lineage = this.sessionId;
    const run = this.queue.then(async () => {
      if (documentId !== null) this.assertReadOwner(clientId);
      if (documentId !== null && (lineage !== this.sessionId || documentId !== this.documentId)) throw coded("NEED_FULL_SNAPSHOT", "document lineage changed before query");
      if (localGeneration !== undefined && localGeneration !== this.localGeneration) throw coded("CLIENT_DISCONNECTED", "Desktop renderer changed");
      if (clientId !== "desktop" && !this.isLogicalClientConnected(clientId)) throw coded("CLIENT_DISCONNECTED", "query client disconnected");
      return read();
    });
    this.queue = run.then(() => {}, () => {});return run;
  }

  /** Desktop keeps its existing framed API; every CAD operation enters this service. */
  async invokeLocal(framed: Uint8Array): Promise<Uint8Array> {
    let requestId = "";
    let finishingFeatureId = "";
    try {
      if (framed.length < 4 || framed.length - 4 > new FrameDecoder().maxFrameBytes || new DataView(framed.buffer, framed.byteOffset, framed.byteLength).getUint32(0, true) !== framed.length - 4) throw coded("BAD_ENVELOPE", "invalid framed command");
      const request = asRecord(JSON.parse(new TextDecoder().decode(framed.subarray(4))));
      if (!request || request["protocolVersion"] !== SESSION_PROTOCOL_VERSION || typeof request["requestId"] !== "string" || !request["requestId"] || typeof request["documentId"] !== "string" || !Number.isInteger(request["type"]) || typeof request["type"] !== "number") throw coded("BAD_ENVELOPE", "invalid Desktop envelope");
      requestId = request["requestId"];
      const type = request["type"];
      const documentId = request["documentId"] || this.documentId;
      const fields = Object.fromEntries(Object.entries(request).filter(([key]) => !["protocolVersion", "requestId", "documentId", "type"].includes(key)));
      if (fields["isPreview"] === true && ![6, 14].includes(type)) throw coded("BAD_PARAMS", "preview is unsupported for this command");
      const generation = this.localGeneration;
      const encode = (value: Record<string, unknown>): Uint8Array => new TextEncoder().encode(JSON.stringify({ ...value, protocolVersion: SESSION_PROTOCOL_VERSION, requestId }));
      if (![1, 2, 11].includes(type) && documentId !== this.documentId) throw coded("NEED_FULL_SNAPSHOT", "document identity changed");
      if ([1, 12, 17, 18, 23, 26, 30, 35, 38].includes(type) || fields["isPreview"] === true) {
        if (type !== 1) this.assertReadOwner("desktop");
        const featureId = typeof fields["featureId"] === "string" ? fields["featureId"] : "";
        let added = false;
        if (fields["isPreview"] === true && [6, 14].includes(type) && !this.localPreviews.has(featureId)) {
          this.localPreviews.set(featureId, this.reserve("desktop", mutationFeatures(type, fields)));added = true;
        }
        try {
          // Engine metadata follows queue order but survives document replacement.
          const response = await this.orderedRead("desktop", type === 1 ? null : documentId, async () => {
            const sidecar = this.sidecar();if (!sidecar) throw coded("CORE_FAILED", "geometry engine not running");
            return sidecar.invoke(framed);
          }, generation);
          if (type === 38 && response[0] === 0x7b) {
            try {
              const parsed = JSON.parse(new TextDecoder().decode(response)) as Record<string, unknown>;
              if (parsed["status"] === "ok" && parsed["documentId"] === "doc-bootstrap") {
                return new TextEncoder().encode(JSON.stringify({ ...parsed, documentId }));
              }
            } catch { /* Preserve malformed native replies for the caller to diagnose. */ }
          }
          if (added && response[0] === 0x7b && JSON.parse(new TextDecoder().decode(response))["status"] === "error") await this.cancelLocalEdit(featureId);
          return response;
        } catch (error) { if (added) await this.cancelLocalEdit(featureId);throw error; }
      }
      let result: Record<string, unknown>;
      if ([6, 14].includes(type) && typeof fields["featureId"] === "string") finishingFeatureId = fields["featureId"];
      if (type === 27) result = await this.txnBegin("desktop", documentId, fields["transactionId"] as string, generation);
      else if (type === 28) result = await this.txnCommit("desktop", documentId, fields["transactionId"] as string, generation);
      else if (type === 29) result = await this.txnRollback("desktop", documentId, fields["transactionId"] as string, generation);
      else result = await this.runMutation("desktop", documentId, type, fields, null, {
        localGeneration: generation,
        ...(typeof fields["transactionId"] === "string" && fields["transactionId"] ? { joinTxn: fields["transactionId"] } : {}),
      });
      return encode(result);
    } catch (error) {
      return new TextEncoder().encode(JSON.stringify({ protocolVersion: SESSION_PROTOCOL_VERSION, requestId, status: "error",
        errorCode: (error as { code?: string }).code ?? "BAD_ENVELOPE", errorMessage: this.errorMessage(error) }));
    } finally { if (finishingFeatureId) await this.cancelLocalEdit(finishingFeatureId); }
  }

  async cancelLocalEdit(featureId: string): Promise<void> {
    const run = this.queue.then(() => { this.localPreviews.get(featureId)?.();this.localPreviews.delete(featureId); });
    this.queue = run.then(() => {}, () => {});await run;
  }

  onRendererDisconnected(): void {
    this.localGeneration++;this.localConnected = false;
    for (const release of this.localPreviews.values()) release();this.localPreviews.clear();
    this.autoRollback("desktop");
  }

  onRendererConnected(): void { this.localConnected = true; }

  sessionInfo(): import("@kreoda/protocol").SessionInfoPayload {
    const transaction = this.txn ?? this.pendingTxn;
    return {
      sessionId: this.sessionId, documentId: this.documentId, documentRevision: this.revisionCache,
      connectedClients: [{ clientId: "desktop", clientType: "desktop", name: "Desktop",
        capabilities: ["incremental-deltas"], connectionState: this.localConnected ? "connected" : "reconnecting" },
        ...[...this.clients.values()].map(client => ({ clientId: client.logicalClientId, clientType: client.clientType,
          name: client.name, deviceId: client.deviceId, capabilities: [...client.capabilities],
          connectionState: client.ws.readyState === WebSocket.OPEN ? "connected" as const : "closing" as const }))],
      transactionState: transaction ? { ...transaction, ownerConnected: this.isLogicalClientConnected(transaction.ownerClientId),
        state: this.txn ? "open" : "pending" } : null,
    };
  }

  /** Local recovery shares queue order with network mutations; no listener needed. */
  localSnapshot(): Promise<import("@kreoda/protocol").SessionModelSnapshot> {
    return this.orderedRead("desktop", this.documentId, async () => {
      const snapshot = await this.coreSnapshot(this.documentId);
      if (!this.txn) this.committedBaseline = this.committedSnapshot(snapshot);
      const entity = (value: unknown): SessionModelEntity => {
        const result = asRecord(value);
        if (!result) throw new Error("snapshot contains a non-object entity");
        return result;
      };
      return {
        sessionId: this.sessionId, documentId: snapshot.documentId, revision: snapshot.revision,
        features: snapshot.features.map(entity), sketches: snapshot.sketches.map(entity),
        bodies: snapshot.bodies.map((body) => ({ ...body })),
        datums: snapshot.datums.map(entity),
      };
    });
  }

  start(opts: { port: number; host: string; token?: string }): void {
    if (this.server) throw new Error("session relay already running");
    validateSessionListener(opts);
    const token = opts.token ?? "";
    if (!token && !this.devices) throw new Error("session relay requires trusted device storage or an explicit test token");
    this.devices?.rotateSessionTokens();
    this.server = new WebSocketServer({
      port: opts.port,
      host: opts.host,
      maxPayload: MAX_CONTROL_PAYLOAD_BYTES,
    });
    this.server.on("connection", (ws: WebSocket) =>
      this.handleConnection(ws, token),
    );
    this.server.on("error", (error: NodeJS.ErrnoException) => {
      console.error("[session] listener failed", error.code ?? "LISTENER_FAILED");
    });
    console.log(
      `[session] relay listening on ${opts.host}:${opts.port} (protocol ${SESSION_PROTOCOL_VERSION})`,
    );
  }

  async enableListener(opts: { port: number; host: string; token?: string }): Promise<void> {
    this.start(opts);
    const server = this.server!;
    try {
      await new Promise<void>((ready, failed) => {
        const listening = (): void => { server.off("error", error);ready(); };
        const error = (reason: Error): void => { server.off("listening", listening);failed(reason); };
        server.once("listening", listening);server.once("error", error);
      });
    } catch {
      if (this.server === server) this.server = null;
      this.devices?.rotateSessionTokens();
      throw coded("LISTENER_FAILED", "cannot start session listener");
    }
  }

  /** Disable transport while preserving the authoritative CAD lineage. */
  async disableListener(): Promise<void> {
    this.clearSharedTargets();
    const server = this.server;
    this.server = null;
    this.devices?.rotateSessionTokens();
    if (!server) return;
    for (const ws of server.clients) ws.terminate();
    await new Promise<void>(ready => server.close(() => ready()));
    // Socket close schedules rollback for an interrupted remote transaction.
    await this.queue;
  }

  connectionStatus(): Pick<SessionConnectionStatus, "listener" | "clients" | "transaction" | "session"> {
    const address = this.server?.address();
    return {
      session: this.sessionInfo(),
      listener: address && typeof address !== "string" ? { host: address.address, port: address.port } : null,
      clients: [...this.clients.values()].map(client => ({
        deviceId: client.deviceId, name: client.name, clientType: client.clientType, capabilities: [...client.capabilities],
      })),
      transaction: this.txn ? { ownerClientId: this.txn.ownerClientId, transactionId: this.txn.transactionId } : null,
    };
  }

  stop(): void {
    this.clearSharedTargets();
    this.devices?.rotateSessionTokens();
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
    this.publishedSelections.clear();
    this.previews.clear();
    this.reservations.clear();this.localPreviews.clear();this.pendingTxn = null;
    this.txn = null;
    this.committedBaseline = null;
    this.clearTransactionTracking();
    this.operationReplay.clear();
    this.requestReplay.clear();
    this.server?.close();
    this.server = null;
  }
  async revokeDevice(deviceId: string): Promise<void> {
    if (!this.devices) throw coded("NOT_IMPLEMENTED", "trusted device storage is unavailable");
    await this.devices.revoke(deviceId);
    for (const client of this.clients.values()) if (client.deviceId === deviceId) client.ws.close(4403, "device revoked");
  }
  /** Sidecar died/restarted: drop in-flight state; clients resync by revision. */
  onSidecarCrashed(): void {
    this.clearSharedTargets();
    this.sessionId = randomUUID();
    this.committedBaseline = null;
    this.clearTransactionTracking();
    this.operationReplay.clear();
    this.requestReplay.clear();
    this.previews.clear();
    this.selections.clear();this.publishedSelections.clear();
    this.reservations.clear();this.localPreviews.clear();this.pendingTxn = null;
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
    ws.on("message", (data, isBinary) => {
      void this.handleMessage(ws, hello, (id) => (connectionId = id), data, isBinary, token)
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
        if (clientId) {
          this.selections.delete(clientId);
          if (this.publishedSelections.delete(clientId)) {
            this.emitSelection(clientId, []);
          }
        }
        for (const [id, p] of this.previews) {
          if (p.clientId === clientId) { p.release();this.previews.delete(id); }
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
    isBinary: boolean,
    token: string,
  ): Promise<void> {
    if (isBinary) {
      if (ws.readyState === WebSocket.OPEN) ws.close(4400, "CONTROL_TEXT_ONLY");
      return;
    }
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
      let encoded = serializeSessionControlReply(requestId, ok, payload);
      if (ws.readyState !== WebSocket.OPEN) {
        if (activeReplay && !activeReplay.settled) this.settleReplay(activeReplay, { ok: encoded.ok, payload: encoded.payload });
        return;
      }
      if (ws.bufferedAmount + Buffer.byteLength(encoded.text) > MAX_OUTBOUND_PEER_BYTES) {
        encoded = serializeSessionControlReply(requestId, false, { errorCode: "SLOW_CONSUMER", error: "session output queue exceeds 64 MiB" });
        if (ws.bufferedAmount + Buffer.byteLength(encoded.text) > MAX_OUTBOUND_PEER_BYTES) {
          if (activeReplay && !activeReplay.settled) this.settleReplay(activeReplay, { ok: encoded.ok, payload: encoded.payload });
          ws.close(4429, "slow consumer");
          return;
        }
      }
      if (activeReplay && !activeReplay.settled) this.settleReplay(activeReplay, { ok: encoded.ok, payload: encoded.payload });
      ws.send(encoded.text);
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

    if (msg.method === "pair" || msg.method === "authenticate") {
      if (hello.authed) { reply(false, { errorCode: "BAD_PARAMS", error: "device authentication must precede hello" });return; }
      if (!this.devices) { reply(false, { errorCode: "NOT_IMPLEMENTED", error: "trusted device storage unavailable" });return; }
      try {
        if (msg.method === "pair") {
          const parsed = PairParamsSchema.safeParse(params);
          if (!parsed.success) {
            this.devices.noteFailedPairingGuess(params["pairingToken"]);
            throw coded("BAD_PARAMS", "invalid pair parameters");
          }
          reply(true, await this.devices.pair(parsed.data.pairingToken, parsed.data.deviceName));
        } else {
          const parsed = AuthenticateParamsSchema.safeParse(params);
          if (!parsed.success) throw coded("BAD_PARAMS", "invalid authenticate parameters");
          reply(true, this.devices.authenticate(parsed.data.deviceId, parsed.data.credential));
        }
      } catch (error) {
        reply(false, { errorCode: (error as { code?: string }).code ?? "SESSION_STORAGE", error: (error as Error).message });
      }
      return;
    }

    // Device exchange is pre-auth only; hello creates the connected identity.
    if (msg.method === "hello") {
      if (hello.authed) {
        reply(false, { errorCode: "BAD_HELLO", error: "hello already completed" });
        return;
      }
      const deviceId = typeof params["deviceId"] === "string" ? params["deviceId"] : undefined;
      if (Object.hasOwn(params, "deviceId") && deviceId === undefined) {
        reply(false, { errorCode: "BAD_PARAMS", error: "deviceId must be a string" });return;
      }
      const accepted = deviceId !== undefined ?
        typeof params["token"] === "string" && this.devices?.authorize(deviceId, params["token"]) === true :
        token.length > 0 && params["token"] === token;
      if (
        typeof requestId !== "string" ||
        !accepted ||
        params["protocolVersion"] !== SESSION_PROTOCOL_VERSION
      ) {
        if (!accepted) {
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
      const principalId = deviceId === undefined ? createHash("sha256").update(token).digest("hex") : `device:${deviceId}`;
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
        ...(deviceId === undefined ? {} : { deviceId }),
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
        ...(deviceId === undefined ? {} : { deviceId }),
        sessionId: this.sessionId,
        documentId: this.documentId,
        capabilities: [...SESSION_SERVER_CAPABILITIES],
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
    if (clientInfo.deviceId && !this.devices?.isTrusted(clientInfo.deviceId)) {
      ws.close(4403, "device revoked");return;
    }
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
        case "getSessionInfo": { reply(true, { result: this.sessionInfo() });return; }
        case "requestPreviewMesh": {
          if (!clientInfo.capabilities.includes("binary-preview-v1")) throw coded("NOT_IMPLEMENTED", "client did not negotiate binary-preview-v1");
          if (typeof msg.sessionId !== "string") throw coded("BAD_PARAMS", "requestPreviewMesh requires sessionId");
          const checked = RequestPreviewMeshParamsSchema.safeParse(params);
          if (!checked.success) throw coded("BAD_PARAMS", checked.error.message);
          await this.requestPreviewFrame(clientId, msg.sessionId, checked.data, (header, raw) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const text = JSON.stringify({ requestId, ok: true, result: header });
            if (ws.bufferedAmount + Buffer.byteLength(text) + raw.byteLength > MAX_OUTBOUND_PEER_BYTES) {
              reply(false, { errorCode: "SLOW_CONSUMER", error: "preview output queue exceeds 64 MiB" });
              ws.close(4429, "slow consumer");return;
            }
            ws.send(text);ws.send(raw, { binary: true }, (error?: Error) => {
              if (error && ws.readyState === WebSocket.OPEN) ws.close(1011, "PREVIEW_SEND_FAILED");
            });
          });
          return;
        }
        case "requestMeshLOD": {
          if (!clientInfo.capabilities.includes("binary-mesh-v1")) {
            reply(false, { errorCode: "NOT_IMPLEMENTED", error: "client did not negotiate binary-mesh-v1" });
            return;
          }
          if (typeof msg.sessionId !== "string") {
            reply(false, { errorCode: "BAD_PARAMS", error: "requestMeshLOD requires sessionId" });
            return;
          }
          const checked = RequestMeshLODParamsSchema.safeParse(params);
          if (!checked.success) {
            reply(false, { errorCode: "BAD_PARAMS", error: checked.error.message });
            return;
          }
          await this.requestMeshFrame(clientId, msg.sessionId, checked.data, (header, raw) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const text = JSON.stringify({ requestId, ok: true, result: header });
            if (ws.bufferedAmount + Buffer.byteLength(text) + raw.byteLength > MAX_OUTBOUND_PEER_BYTES) {
              reply(false, { errorCode: "SLOW_CONSUMER", error: "mesh output queue exceeds 64 MiB" });
              ws.close(4429, "slow consumer");
              return;
            }
            // Enqueue both frames before releasing the ordered read. A following
            // mutation cannot overtake this native query result.
            ws.send(text);
            ws.send(raw, { binary: true }, (error?: Error) => {
              if (error && ws.readyState === WebSocket.OPEN) ws.close(1011, "MESH_SEND_FAILED");
            });
          });
          return;
        }
        case "snapshot": {
          const snap = await this.orderedRead(clientId, documentId, () => this.coreSnapshot(documentId));
          reply(true, { ...snap, sessionId: this.sessionId });
          return;
        }
        case "invoke":
        case "command": {
          const named = msg.method === "command";
          const checked = (named ? NamedCommandParamsSchema : InvokeParamsSchema).safeParse(params);
          if (!checked.success) {
            reply(false, { errorCode: "BAD_PARAMS", error: checked.error.message });
            return;
          }
          const commandId = params["commandId"];
          const type = params["type"];
          if (named && (typeof commandId !== "string" || !commandId)) {
            reply(false, { errorCode: "BAD_PARAMS", error: "command needs commandId" });
            return;
          }
          if (!named && (typeof type !== "number" || !Number.isInteger(type))) {
            reply(false, {
              errorCode: "BAD_PARAMS",
              error: "invoke needs an integer core command type",
            });
            return;
          }
          if (!named && (type === 27 || type === 28 || type === 29)) {
            reply(false, {
              errorCode: "BAD_PARAMS",
              error: "use txnBegin, txnCommit, or txnRollback for transaction control",
            });
            return;
          }
          const rawFields = named ? params["parameters"] : params["fields"];
          if (
            rawFields !== undefined &&
            (typeof rawFields !== "object" ||
              rawFields === null ||
              Array.isArray(rawFields))
          ) {
            reply(false, {
              errorCode: "BAD_PARAMS",
              error: "CAD parameters must be an object",
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
          const prepared = named ? commandNativeRequest(commandId as string, fields,
            params["featureId"] ?? (commandCreatesFeature(commandId as string) ? randomUUID() : undefined)) :
            validateLegacyNativeCommand(type as number, fields);
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
          const commandDocumentId = typeof params["documentId"] === "string" && params["documentId"] !== ""
            ? params["documentId"] as string : this.documentId;
          if (prepared.type === 35 || prepared.type === 38) {
            const result = await this.orderedRead(clientId, commandDocumentId, async () => {
              const native = await this.coreInvoke(commandDocumentId, prepared.type, prepared.fields);
              const response = prepared.type === 38 && native["documentId"] === "doc-bootstrap"
                ? { ...native, documentId: commandDocumentId }
                : native;
              if (base !== null && response["revision"] !== base)
                throw coded("NEED_FULL_SNAPSHOT", "query belongs to an older model revision");
              return response;
            });
            // Keep client request correlation; native relay-N identity is private.
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { requestId: _nativeRequestId, protocolVersion: _protocolVersion, ...payload } = result;
            reply(true, payload);
            return;
          }
          const result = await this.runMutation(
            clientId,
            commandDocumentId,
            prepared.type,
            prepared.fields,
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
          const method = msg.method;
          const query = async () => {
            const response = await runSessionQuery(this.queryEnv(), this.selectionRegistry(), clientId, method, params, documentId);
            return { ...response, selection: response.notify
              ? this.selectionStamp(clientId, response.notify["ids"] as string[]) : undefined };
          };
          const direct = ["previewBegin", "previewUpdate", "previewCommit", "previewCancel", "getSelection", "clearSelection", "listCommands", "getCommandSchema", "getCapabilities"].includes(method);
          const { result, selection, lineage } = await (direct ? query() : this.orderedRead(clientId, documentId, query));
          reply(true, { result, ...(lineage ?? {}) });
          if (selection) this.emitSelection(clientId, selection.ids, selection);
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
    if (clientId === "desktop") return this.localConnected;
    return [...this.clients.values()].some(
      (client) => client.logicalClientId === clientId && client.ws.readyState === WebSocket.OPEN &&
        (client.deviceId === undefined || this.devices?.isTrusted(client.deviceId) === true),
    );
  }

  private async currentRevision(): Promise<number> {
    if (this.revisionCache !== null) return this.revisionCache;
    const lineage = this.sessionId, documentId = this.documentId;
    if (!this.revisionPending) {
      const pending = this.coreSnapshot(documentId)
        .then((s) => s.revision)
        .finally(() => {
          if (this.revisionPending === pending) this.revisionPending = null;
        });
      this.revisionPending = pending;
    }
    const rev = await this.revisionPending;
    if (lineage !== this.sessionId || documentId !== this.documentId)
      throw coded("NEED_FULL_SNAPSHOT", "revision lookup crossed a model lineage change");
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
    nativeRequestId?: string,
  ): Promise<Uint8Array> {
    const sidecar = this.sidecar();
    if (!sidecar) throw new Error("geometry engine not running");
    const commandFields = Object.fromEntries(
      Object.entries(fields).filter(([key]) => !CORE_ENVELOPE_FIELDS.has(key)),
    );
    const envelope = {
      protocolVersion: SESSION_PROTOCOL_VERSION,
      requestId: nativeRequestId ?? `relay-${++this.seq}`,
      documentId,
      type,
      transactionId:
        typeof fields["transactionId"] === "string"
          ? (fields["transactionId"] as string)
          : "",
      // Absence means a normal committed request. Emit preview metadata only
      // for true previews; strict native request allowlists reject false too.
      ...(fields["isPreview"] === true ? { isPreview: true } : {}),
      ...commandFields,
    };
    const framed = frameMessage(
      new TextEncoder().encode(JSON.stringify(envelope)),
    );
    return sidecar.invoke(new Uint8Array(framed));
  }

  private async requestMeshFrame(
    clientId: string,
    requestedSessionId: string,
    params: RequestMeshLODParams,
    emit: (header: unknown, raw: Uint8Array) => void,
  ): Promise<void> {
    return this.orderedRead(clientId, params.documentId, async () => {
      const lineage = this.sessionId;
      if (lineage !== requestedSessionId) throw coded("NEED_FULL_SNAPSHOT", "session identity changed before mesh query");
      const snapshot = await this.coreSnapshot(params.documentId);
      if (lineage !== this.sessionId || params.documentId !== this.documentId || snapshot.documentId !== params.documentId) {
        throw coded("NEED_FULL_SNAPSHOT", "document lineage changed before mesh query");
      }
      if (snapshot.revision !== params.expectedRevision) throw coded("NEED_FULL_SNAPSHOT", "mesh request revision is stale");
      const body = snapshot.bodies.find(candidate => candidate.bodyId === params.bodyId);
      if (!body || body.history.length === 0 || body.bodyId !== `body-${body.history[0]}` ||
          body.tip !== body.history.at(-1) || !snapshot.tips.includes(body.tip)) {
        throw coded("NOT_FOUND", "body is missing or has no visible tip");
      }
      const allFeatures = snapshot.features
        .map(asRecord)
        .filter((feature): feature is Record<string, unknown> => feature !== null && typeof feature["featureId"] === "string");
      const isVisible = (feature: Record<string, unknown> | undefined): feature is Record<string, unknown> =>
        !!feature && feature["suppressed"] !== true && feature["state"] !== "suppressed" &&
        feature["status"] !== "suppressed" && feature["visible"] !== false;
      const historyFeatures = snapshot.features
        .map(asRecord)
        .filter((feature): feature is Record<string, unknown> => feature !== null && typeof feature["featureId"] === "string" && body.history.includes(feature["featureId"] as string));
      const tip = historyFeatures.find(feature => feature["featureId"] === body.tip);
      if (!tip || historyFeatures.length !== body.history.length || historyFeatures.some(feature =>
        feature["suppressed"] === true || feature["state"] === "suppressed" || feature["status"] === "suppressed")) {
        throw coded("NOT_FOUND", "body is suppressed or its visible tip is missing");
      }
      if (tip["geometryCurrent"] === false || tip["status"] === "unavailable") {
        throw coded("GEOMETRY_UNAVAILABLE", typeof tip["error"] === "string"
          ? tip["error"] : "body tip geometry is unavailable");
      }

      let nativeFeatureId = body.tip;
      if (params.instanceId !== undefined) {
        const instance = allFeatures.find(feature => feature["featureId"] === params.instanceId);
        const dependencies = instance?.["dependsOn"];
        if (!isVisible(instance) || instance["type"] !== "Instance" || !Array.isArray(dependencies) ||
            dependencies.length !== 1 || typeof dependencies[0] !== "string" || dependencies[0] === params.instanceId) {
          throw coded("NOT_FOUND", "instance is missing, hidden, nested, self-referential, or unsupported");
        }
        const sourceId = dependencies[0];
        const source = allFeatures.find(feature => feature["featureId"] === sourceId);
        if (!body.history.includes(sourceId) || !isVisible(source) || source["type"] === "Instance") {
          throw coded("NOT_FOUND", "instance source does not belong to the requested visible body");
        }
        nativeFeatureId = params.instanceId;
      }

      const expectedNativeRequestId = `relay-${++this.seq}`;
      const raw = await this.coreInvokeRaw(params.documentId, 12, { featureId: nativeFeatureId, lod: params.quality }, expectedNativeRequestId);
      if (raw.byteLength > MAX_BINARY_MESH_BYTES) throw coded("MESH_TOO_LARGE", "native mesh exceeds 64 MiB");
      let mesh;
      try {
        mesh = decodeMeshUpdateFb(raw);
      } catch (error) {
        if (raw[0] === 0x7b) {
          const response = asRecord(JSON.parse(new TextDecoder().decode(raw)));
          if (response?.["status"] === "error") {
            throw coded(
              typeof response["errorCode"] === "string" ? response["errorCode"] : "CORE_FAILED",
              typeof response["errorMessage"] === "string" ? response["errorMessage"] : "native mesh request failed",
            );
          }
        }
        throw coded("INVALID_MESH", this.errorMessage(error));
      }
      if (lineage !== this.sessionId || params.documentId !== this.documentId ||
          mesh.revision !== snapshot.revision) {
        throw coded("NEED_FULL_SNAPSHOT", "mesh result belongs to a stale model lineage");
      }
      if (mesh.requestId !== expectedNativeRequestId || mesh.featureId !== nativeFeatureId ||
          mesh.bodyId !== nativeFeatureId || mesh.lod !== params.quality) {
        throw coded("INVALID_MESH", "native mesh identity does not match the request");
      }
      const header = MeshHeaderSchema.parse({
        nativeRequestId: mesh.requestId,
        sessionId: lineage,
        documentId: params.documentId,
        revision: mesh.revision,
        bodyId: body.bodyId,
        featureId: mesh.featureId,
        tipId: nativeFeatureId,
        ...(params.instanceId !== undefined ? { instanceId: params.instanceId } : {}),
        quality: mesh.lod,
        byteLength: raw.byteLength,
      });
      emit(header, raw);
    });
  }

  private async coreSnapshot(documentId: string): Promise<{
    documentId: string;
    revision: number;
    features: unknown[];
    sketches: unknown[];
    datums: unknown[];
    bodies: SessionBody[];
    tips: string[];
  }> {
    const parsed = await this.coreInvoke(documentId, 26, {});
    if(parsed["datums"] !== undefined && !Array.isArray(parsed["datums"]))throw coded("BAD_MODEL", "native datums must be an array");
    const datums = Array.isArray(parsed["datums"]) ? parsed["datums"] as unknown[] : [];
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
    const snap = normalizeSnapshot(documentId, revision, features, sketches, datums);
    return { documentId, revision, features, sketches, datums: snap.datums ?? [], bodies: snap.bodies, tips: snap.tips };
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
      sessionId: () => this.sessionId,
      previewSketch: async (documentId, featureId, model) => {
        const result = await this.coreInvoke(documentId, 14, { featureId, model, isPreview: true });
        if (result["preview"] !== true || !asRecord(result["sketch"])) throw coded("CORE_FAILED", "native sketch preview is incomplete");
        return result;
      },
      geometry: async (documentId, method, params) => {
        if (method === "RequestSketchProjection") {
          const response = await this.coreInvoke(documentId, 38, params);
          // The native store starts as doc-bootstrap before the relay has
          // opened a named document. Bind that one bootstrap identity to the
          // active logical session id; preserve every other native id so the
          // query layer can reject genuine document mismatches.
          if (response["documentId"] === "doc-bootstrap") {
            return { ...response, documentId };
          }
          return response;
        }
        const response = await this.coreInvoke(documentId, 30, { method, params });
        if (response["result"] === undefined) throw coded("CORE_FAILED", "native query result is missing");
        return response["result"];
      },
      snapshot: async (documentId: string): Promise<SnapshotData> => {
        const snap = await this.coreSnapshot(documentId);
        return normalizeSnapshot(
          snap.documentId,
          snap.revision,
          snap.features,
          snap.sketches,
          snap.datums,
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
        const fields = commandNativeRequest("SetDimension", params).fields;
        const featureId = fields["featureId"] as string;
        const paramName = fields["paramName"] as string;
        const valueMm = (fields["valueMm"] as number | undefined) ?? 0;
        const expression = (fields["expression"] as string | undefined) ?? "";
        const values = this.checkedPreviewValues(params["previewValues"], featureId, paramName);
        const id = `preview-${randomUUID()}`;
        this.assertReadOwner(clientId);
        let release = this.reserve(clientId, this.committedBaseline ? [featureId] : "*");
        try {
          return await this.orderedRead(clientId, docId, async () => {
            if ([...this.previews.values()].filter(p => p.clientId === clientId).length >= MAX_CLIENT_PREVIEWS)
              throw coded("PREVIEW_LIMIT", "at most four active previews per client");
            const lineage = this.sessionId;
            const snapshot = await this.coreSnapshot(docId);
            if (lineage !== this.sessionId || docId !== this.documentId || snapshot.documentId !== docId)
              throw coded("NEED_FULL_SNAPSHOT", "preview snapshot crossed a model lineage change");
            if (params["expectedRevision"] !== undefined &&
                (!Number.isSafeInteger(params["expectedRevision"]) || (params["expectedRevision"] as number) < 0))
              throw coded("BAD_PARAMS", "expectedRevision must be a nonnegative safe integer");
            if (params["expectedRevision"] !== undefined && params["expectedRevision"] !== snapshot.revision)
              throw coded("NEED_FULL_SNAPSHOT", "preview intent belongs to an older model revision");
            if (!this.txn) this.committedBaseline = this.committedSnapshot(snapshot);
            const context = this.previewContext(snapshot, featureId, params);
            const expanded = this.reserve(clientId, [featureId]);release();release = expanded;
            const state: PreviewState = { clientId, sessionId: lineage, documentId: docId,
              featureId, paramName, valueMm, expression, values, baseRevision: snapshot.revision,
              ...context, previewId: id, generation: 0, release, raw: new Uint8Array(), pending: Promise.resolve() };
            const result = await this.runPreview(state);
            if (lineage !== this.sessionId || docId !== this.documentId)
              throw coded("NEED_FULL_SNAPSHOT", "preview result crossed a model lineage change");
            if (!this.isLogicalClientConnected(clientId)) throw coded("CLIENT_DISCONNECTED", "preview client disconnected");
            this.checkPreviewBudget(id, result.raw.byteLength);
            state.raw = result.raw;state.header = result.header;
            this.previews.set(id, state);
            return { previewId: id, generation: 0, ...result.summary };
          });
        } catch (error) { release();throw error; }
      },
      previewUpdate: (clientId, previewId, params) => this.serializePreview(clientId, previewId, () => {
        const state = this.previewState(clientId, previewId);
        const fields = commandNativeRequest("SetDimension", {
          featureId: state.featureId, paramName: state.paramName,
          valueMm: state.valueMm, expression: state.expression,
          ...(Object.hasOwn(params, "valueMm") ? { valueMm: params["valueMm"], expression: "" } : {}),
          ...(Object.hasOwn(params, "expression") ? { expression: params["expression"] } : {}),
        }).fields;
        const values = Object.hasOwn(params, "previewValues")
          ? this.checkedPreviewValues(params["previewValues"], state.featureId, state.paramName) : state.values;
        return this.orderedRead(clientId, state.documentId, async () => {
          this.previewState(clientId, previewId);
          await this.assertPreviewRevision(state);
          if (this.previewState(clientId, previewId) !== state)
            throw coded("NOT_FOUND", "preview was replaced during revision lookup");
          if (state.generation >= Number.MAX_SAFE_INTEGER) throw coded("PREVIEW_LIMIT", "preview generation exhausted");
          const candidate = { ...state, values, generation: state.generation + 1,
            valueMm: (fields["valueMm"] as number | undefined) ?? 0,
            expression: (fields["expression"] as string | undefined) ?? "" };
          const result = await this.runPreview(candidate);
          this.previewState(clientId, previewId);
          this.checkPreviewBudget(previewId, result.raw.byteLength);
          Object.assign(state, candidate, { raw: result.raw, header: result.header });
          return { previewId, generation: state.generation, ...result.summary };
        });
      }),
      previewCommit: (clientId, previewId) => this.serializePreview(clientId, previewId, async () => {
        const state = this.previewState(clientId, previewId);
        const result = await this.runMutation(
          clientId,
          state.documentId,
          6,
          {
            featureId: state.featureId,
            paramName: state.paramName,
            valueMm: state.valueMm,
            ...(Object.keys(state.values).length ? { parameterValues: state.values } : {}),
            ...(state.expression ? { expression: state.expression } : {}),
          },
          state.baseRevision,
        );
        state.release();this.previews.delete(previewId);
        return result;
      }),
      previewCancel: (clientId, previewId) => this.serializePreview(clientId, previewId, () => {
        this.previewState(clientId, previewId).release();
        this.previews.delete(previewId);
        return { previewId, cancelled: true as const };
      }),
    };
  }

  private previewState(clientId: string, previewId: string): PreviewState {
    const state = this.previews.get(previewId);
    if (!state || state.clientId !== clientId) throw coded("NOT_FOUND", "unknown owned preview");
    return state;
  }

  private checkedPreviewValues(raw: unknown, featureId: string, primary: string): Record<string, number> {
    if (raw === undefined) return {};
    const values = asRecord(raw);
    if (!values || Object.keys(values).length > 5 || Object.hasOwn(values, primary))
      throw coded("BAD_PARAMS", "previewValues requires at most five distinct additional parameters");
    const result: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const [paramName, valueMm] of Object.entries(values)) {
      const checked = commandNativeRequest("SetDimension", { featureId, paramName, valueMm });
      result[paramName] = checked.fields["valueMm"] as number;
    }
    return result;
  }

  private previewContext(snapshot: Awaited<ReturnType<SessionRelay["coreSnapshot"]>>, featureId: string, params: Record<string, unknown>): { bodyId: string; targetTipId: string } {
    const features = snapshot.features.map(asRecord).filter((f): f is Record<string, unknown> => f !== null);
    const owner = features.find(f => f["featureId"] === featureId);
    if (!owner || owner["suppressed"] === true) throw coded("NOT_FOUND", "preview owner is missing or suppressed");
    const source = owner["type"] === "Instance" && Array.isArray(owner["dependsOn"]) ? owner["dependsOn"][0] : featureId;
    const body = params["bodyId"] === undefined
      ? snapshot.bodies.find(b => b.history.includes(source as string))
      : snapshot.bodies.find(b => b.bodyId === params["bodyId"]);
    if (!body || !body.history.length || body.bodyId !== `body-${body.history[0]}` ||
        body.tip !== body.history.at(-1) || !snapshot.tips.includes(body.tip))
      throw coded("NOT_FOUND", "preview body has no current visible tip");
    const tip = owner["type"] === "Instance" ? featureId : body.tip;
    if (params["targetTipId"] !== undefined && params["targetTipId"] !== tip)
      throw coded("NOT_FOUND", "preview tip does not match the current body or instance");
    const visited = new Set<string>(), active = new Set<string>();
    const visit = (id: string): void => {
      if (active.has(id)) throw coded("BAD_MODEL", "cyclic preview dependencies");
      if (visited.has(id)) return;
      const f = features.find(f => f["featureId"] === id);
      if (!f || f["suppressed"] === true || f["visible"] === false) throw coded("NOT_FOUND", "preview dependency missing or hidden");
      active.add(id);
      if (Array.isArray(f["dependsOn"])) for (const dep of f["dependsOn"]) {
        if (typeof dep !== "string") throw coded("BAD_MODEL", "invalid preview dependency");
        if (features.some(f => f["featureId"] === dep)) visit(dep);
        else if (!snapshot.sketches.some(s => asRecord(s)?.["featureId"] === dep)) throw coded("NOT_FOUND", "preview dependency missing");
      }
      active.delete(id);visited.add(id);
    };
    visit(tip);
    if (!visited.has(featureId) || (owner["type"] === "Instance" && !body.history.includes(source as string)))
      throw coded("NOT_FOUND", "preview owner is unrelated to requested body tip");
    return { bodyId: body.bodyId, targetTipId: tip };
  }

  private checkPreviewBudget(replacedId: string, size: number): void {
    if (size > MAX_BINARY_MESH_BYTES) throw coded("MESH_TOO_LARGE", "preview exceeds 64 MiB");
    let retained = size;
    for (const [id, state] of this.previews) if (id !== replacedId) retained += state.raw.byteLength;
    if (retained > MAX_RETAINED_PREVIEW_BYTES) throw coded("PREVIEW_LIMIT", "retained previews exceed 256 MiB");
  }

  private async assertPreviewRevision(state: PreviewState): Promise<void> {
    const revision = await this.currentRevision();
    if (state.sessionId !== this.sessionId || state.documentId !== this.documentId ||
        state.baseRevision !== revision)
      throw coded("NEED_FULL_SNAPSHOT", "preview model lineage or base revision changed");
  }

  private requestPreviewFrame(clientId: string, sessionId: string, params: RequestPreviewMeshParams,
    emit: (header: PreviewMeshHeader, raw: Uint8Array) => void): Promise<void> {
    return this.serializePreview(clientId, params.previewId, () => this.orderedRead(clientId, params.documentId, async () => {
      const state = this.previewState(clientId, params.previewId);
      if (sessionId !== state.sessionId || params.documentId !== state.documentId || params.expectedRevision !== state.baseRevision)
        throw coded("NEED_FULL_SNAPSHOT", "preview request belongs to a different model lineage");
      await this.assertPreviewRevision(state);
      if (this.previewState(clientId, params.previewId) !== state)
        throw coded("NOT_FOUND", "preview was replaced during revision lookup");
      if (params.generation !== state.generation) throw coded("STALE_PREVIEW", "preview generation changed");
      if (!state.header || state.raw.byteLength === 0) throw coded("NOT_FOUND", "preview mesh is no longer retained");
      emit(state.header, state.raw);
    }));
  }

  private serializePreview<T>(clientId: string, previewId: string, action: () => T | Promise<T>): Promise<T> {
    const state = this.previewState(clientId, previewId);
    const run = state.pending.then(() => {
      // Prior commit/cancel, disconnect or document replacement can consume it.
      if (this.previewState(clientId, previewId) !== state) throw coded("NOT_FOUND", "preview replaced");
      return action();
    });
    state.pending = run.then(() => {}, () => {});
    return run;
  }

  /** Candidate bytes remain separate from committed model snapshots/deltas. */
  private async runPreview(state: PreviewState): Promise<{ raw: Uint8Array; header: PreviewMeshHeader; summary: Record<string, unknown> }> {
    const expectedNativeRequestId = `relay-${++this.seq}`;
    const raw = await this.coreInvokeRaw(state.documentId, 6, {
      featureId: state.featureId, paramName: state.paramName, valueMm: state.valueMm,
      isPreview: true, previewTipId: state.targetTipId, previewValues: state.values,
      ...(state.expression ? { expression: state.expression } : {}),
    }, expectedNativeRequestId);
    if (raw.byteLength > MAX_BINARY_MESH_BYTES) throw coded("MESH_TOO_LARGE", "preview exceeds 64 MiB");
    let mesh;
    try { mesh = decodeMeshUpdateFb(raw); }
    catch (error) {
      if (raw[0] === 0x7b) {
        const parsed = asRecord(JSON.parse(new TextDecoder().decode(raw)));
        throw coded(typeof parsed?.["errorCode"] === "string" ? parsed["errorCode"] : "PREVIEW_FAILED",
          typeof parsed?.["errorMessage"] === "string" ? parsed["errorMessage"] : "preview failed");
      }
      throw coded("INVALID_MESH", this.errorMessage(error));
    }
    if (state.sessionId !== this.sessionId || state.documentId !== this.documentId || mesh.revision !== state.baseRevision)
      throw coded("NEED_FULL_SNAPSHOT", "preview result belongs to a stale model");
    if (mesh.requestId !== expectedNativeRequestId || mesh.featureId !== state.targetTipId ||
        mesh.bodyId !== state.targetTipId || mesh.lod !== 0) throw coded("INVALID_MESH", "preview identity mismatch");
    const header = PreviewMeshHeaderSchema.parse({ nativeRequestId: mesh.requestId, sessionId: state.sessionId,
      documentId: state.documentId, baseRevision: state.baseRevision, previewId: state.previewId, generation: state.generation,
      featureId: state.featureId, paramName: state.paramName, bodyId: state.bodyId, targetTipId: state.targetTipId,
      quality: 0, byteLength: raw.byteLength });
    return { raw, header, summary: { triangles: mesh.indices.length / 3, volumeMm3: mesh.volumeMm3,
      bboxMm: [...mesh.bboxMm], revision: mesh.revision } };
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
      localGeneration?: number;
    } = {},
  ): Promise<Record<string, unknown>> {
    const lineage = this.sessionId;
    let release: () => void;
    try {
      if (!opts.allowOrphanRollback) {
        if (type === 28 || type === 29) {
          const transactionId = fields["transactionId"];
          if (typeof transactionId !== "string" || !transactionId) throw coded("BAD_PARAMS", "transactionId is required");
          if (!this.txn || this.txn.transactionId !== transactionId) throw coded("NO_TRANSACTION", "no matching session transaction");
          if (this.txn.ownerClientId !== clientId) throw coded("NOT_OWNER", "transaction belongs to another client");
        } else this.assertReadOwner(clientId);
      }
      release = this.reserve(clientId, mutationFeatures(type, fields));
      if (opts.beginTxn) this.pendingTxn = opts.beginTxn;
    } catch (error) { return Promise.reject(error); }
    const run = this.queue.then(async () => {
      if (lineage !== this.sessionId) throw coded("NEED_FULL_SNAPSHOT", "session lineage changed before mutation");
      if (opts.localGeneration !== undefined && opts.localGeneration !== this.localGeneration) throw coded("CLIENT_DISCONNECTED", "Desktop renderer changed");
      if (clientId !== "desktop" && type !== 29 && !this.isLogicalClientConnected(clientId)) {
        throw coded("CLIENT_DISCONNECTED", "mutation client disconnected or its device was revoked");
      }
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
        if (lineage !== this.sessionId) throw coded("NEED_FULL_SNAPSHOT", "core lineage changed during mutation");
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
        if (type === 2 || type === 11) {
          this.clearSharedTargets();
          this.sessionId = randomUUID();
          this.operationReplay.clear();this.requestReplay.clear();this.selections.clear();this.publishedSelections.clear();
          for (const preview of this.previews.values()) preview.release();this.previews.clear();
          for (const end of this.localPreviews.values()) end();this.localPreviews.clear();
          this.clearTransactionTracking();this.committedBaseline = null;
          this.lastSent = null;this.lastBroadcastRevision = null;
          const after = this.committedSnapshot(await this.coreSnapshot(documentId));
          this.revisionCache = after.revision;this.committedBaseline = after;
          this.broadcast(clientId, after, null, new Set(), [], []);
          return { ...result, revision: after.revision };
        }
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
      }
    }).finally(() => {
      release();
      if (opts.beginTxn && this.pendingTxn === opts.beginTxn) this.pendingTxn = null;
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
    localGeneration?: number,
  ): Promise<Record<string, unknown>> {
    if (!transactionId) {
      const err = new Error("transactionId is required") as Error & {
        code?: string;
      };
      err.code = "BAD_PARAMS";
      throw err;
    }
    if (this.txn || this.pendingTxn) {
      const err = new Error(
        `transaction ${(this.txn ?? this.pendingTxn)!.transactionId} already open`,
      ) as Error & { code?: string };
      err.code = "TRANSACTION_BUSY";
      throw err;
    }
    return this.runMutation(clientId, documentId, 27, {
        transactionId,
      },
      null,
      { noBroadcast: true, beginTxn: { ownerClientId: clientId, transactionId }, localGeneration },
    );
  }

  private async txnCommit(
    clientId: string,
    documentId: string,
    transactionId: string,
    localGeneration?: number,
  ): Promise<Record<string, unknown>> {
    try {
      const result = await this.runMutation(
        clientId,
        documentId,
        28,
        { transactionId },
        null,
        { localGeneration },
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
    localGeneration?: number,
  ): Promise<Record<string, unknown>> {
    try {
      const result = await this.runMutation(
        clientId,
        documentId,
        29,
        { transactionId },
        null,
        { localGeneration },
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
      datums: snap.datums,
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
      after.datums,
    );
    const affectedClosure = new Set(affectedIds);
    // Undo/Redo have no featureId in their command. Actual semantic changes,
    // including sketch coordinates, must seed mesh invalidation as well.
    for (const kind of ["features", "sketches", "datums"] as const) {
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
    diffCollection("datum", before.datums, after.datums);
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
      ...idsOf("datum", before.datums),
      ...idsOf("body", before.bodies),
    ]);
    const newIds = new Set([
      ...idsOf("feature", after.features),
      ...idsOf("sketch", after.sketches),
      ...idsOf("datum", after.datums),
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
    // A published reference is stamped at its validated revision. Require
    // explicit republication after an authoritative edit instead of silently
    // promoting potentially changed topology to the new revision.
    this.clearSharedTargets();
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
      datums: after.datums,
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
