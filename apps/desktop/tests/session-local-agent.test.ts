import { createServer } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { frameMessage } from "@kreoda/protocol";
import type { VoiceTurnParams } from "@kreoda/protocol";
import { SessionRelay } from "../electron/session";
import type { SidecarManager } from "../electron/sidecar";
import { SessionClient } from "../e2e/ws-test-client";

const VOICE_TOKEN = "private-local-agent-token-123";
const RELAY_TOKEN = "local-agent-relay-token";
const FLOW = "22222222-2222-4222-8222-222222222222";

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject);server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("could not allocate loopback port");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for local agent state");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function makeTurn(snapshot: { sessionId: string; documentId: string; revision: number }, voiceRequestId = FLOW, text = "Create a box"): VoiceTurnParams {
  return {
    voiceRequestId, documentId: snapshot.documentId, expectedRevision: snapshot.revision, text,
    context: { voiceRequestId, sessionId: snapshot.sessionId, documentId: snapshot.documentId, revision: snapshot.revision },
  };
}

async function createHarness(fetch: typeof globalThis.fetch, options: { listen?: boolean; revision?: number } = {}) {
  const state = { revision: options.revision ?? 7 };
  const sidecar = {
    invoke: vi.fn(async (frame: Uint8Array) => {
      const length = new DataView(frame.buffer, frame.byteOffset, 4).getUint32(0, true);
      const request = JSON.parse(new TextDecoder().decode(frame.subarray(4, 4 + length))) as Record<string, unknown>;
      return new TextEncoder().encode(JSON.stringify({ status: "ok", requestId: request["requestId"],
        documentId: request["documentId"] ?? "doc-phase1", revision: state.revision,
        features: [], sketches: [], datums: [] }));
    }),
  };
  const relay = new SessionRelay(() => sidecar as unknown as SidecarManager, undefined, undefined, undefined,
    undefined, undefined, undefined, { token: VOICE_TOKEN, fetch });
  const clients: SessionClient[] = [];
  let port = 0;
  if (options.listen) {
    port = await freePort();
    await relay.enableListener({ port, host: "127.0.0.1", token: RELAY_TOKEN });
  }
  return {
    relay, state, port,
    async connect() {
      const client = new SessionClient();clients.push(client);
      const hello = await client.connect(RELAY_TOKEN, port, undefined, ["voice-v1"]);
      return { client, hello };
    },
    async close() {
      for (const client of clients) client.closeRaw();
      await relay.disableListener();relay.stop();
    },
  };
}

describe("SessionRelay local Hermes owner", () => {
  it("exposes local status, turn, and cancellation methods", async () => {
    const harness = await createHarness(vi.fn(async () => response({ text: "Done", runId: "run_local" })) as typeof fetch);
    try {
      expect(typeof harness.relay.localAgentStatus).toBe("function");
      expect(typeof harness.relay.localAgentTurn).toBe("function");
      expect(typeof harness.relay.localAgentCancel).toBe("function");
    } finally { await harness.close(); }
  });

  it("returns typed local status and the real Hermes reply through the private Bridge", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/health")
        ? response({ service: "kreoda-hermes-bridge", mcp: true })
        : response({ text: "Created", runId: "run_desktop_1", sessionId: "hermes-conversation" }));
    const harness = await createHarness(fetch as typeof globalThis.fetch);
    try {
      const snapshot = await harness.relay.localSnapshot();
      const status = await harness.relay.localAgentStatus(snapshot.sessionId);
      expect(status).toEqual({ sessionId: snapshot.sessionId, documentId: snapshot.documentId,
        revision: snapshot.revision, configured: true, reachable: true });
      const request = makeTurn(snapshot);
      const result = await harness.relay.localAgentTurn(request);
      expect(result).toEqual({ sessionId: snapshot.sessionId, documentId: snapshot.documentId,
        revision: snapshot.revision, voiceRequestId: FLOW,
        reply: { text: "Created", runId: "run_desktop_1", sessionId: "hermes-conversation" } });
      const turnCall = fetch.mock.calls.find(([input]) => String(input).endsWith("/voice/turn"));
      expect(turnCall).toBeDefined();
      expect(turnCall?.[1]?.headers).toMatchObject({ authorization: `Bearer ${VOICE_TOKEN}` });
      expect(JSON.parse(String(turnCall?.[1]?.body))).toEqual({ text: request.text, context: request.context });
    } finally { await harness.close(); }
  });

  it("rejects stale session, document, and revision before Bridge I/O", async () => {
    const fetch = vi.fn(async () => response({ text: "Must not run", runId: "run_no" }));
    const harness = await createHarness(fetch as typeof globalThis.fetch);
    try {
      const snapshot = await harness.relay.localSnapshot();
      await expect(harness.relay.localAgentTurn({ ...makeTurn(snapshot),
        expectedRevision: snapshot.revision - 1,
        context: { ...makeTurn(snapshot).context, revision: snapshot.revision - 1 },
      })).rejects.toMatchObject({ code: "NEED_FULL_SNAPSHOT" });
      await expect(harness.relay.localAgentTurn({ ...makeTurn(snapshot),
        context: { ...makeTurn(snapshot).context, sessionId: "33333333-3333-4333-8333-333333333333" },
      })).rejects.toMatchObject({ code: "NEED_FULL_SNAPSHOT" });
      const staleDocument = makeTurn(snapshot);
      staleDocument.documentId = "other-document";
      staleDocument.context = { ...staleDocument.context, documentId: "other-document" };
      await expect(harness.relay.localAgentTurn(staleDocument))
        .rejects.toMatchObject({ code: "NEED_FULL_SNAPSHOT" });
      await expect(harness.relay.localAgentStatus("33333333-3333-4333-8333-333333333333"))
        .rejects.toMatchObject({ code: "NEED_FULL_SNAPSHOT" });
      expect(fetch).not.toHaveBeenCalled();
    } finally { await harness.close(); }
  });

  it("allows Hermes turn revision advance and preserves uncertain rollback identity", async () => {
    let relay: SessionRelay | undefined;
    let recovery: Record<string, unknown> = {};
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { text: string };
      if (body.text === "advance") {
        (relay as unknown as { revisionCache: number | null }).revisionCache = 8;
        return response({ text: "Advanced", runId: "run_advance" });
      }
      return response({ error: "Rollback uncertain", stage: "cad", status: "uncertain",
        errorCode: "ROLLBACK_UNCONFIRMED", runId: "run_rollback", recovery, recoveryPersisted: true }, 502);
    });
    const harness = await createHarness(fetch as typeof globalThis.fetch);
    relay = harness.relay;
    try {
      const snapshot = await relay.localSnapshot();
      const advanced = await relay.localAgentTurn(makeTurn(snapshot, FLOW, "advance"));
      expect(advanced.revision).toBe(8);
      recovery = { requestId: FLOW, transactionId: "44444444-4444-4444-8444-444444444444",
        sessionId: snapshot.sessionId, documentId: snapshot.documentId, baseRevision: snapshot.revision,
        ownerClientId: null, causeCode: "NEED_FULL_SNAPSHOT" };
      const failure = await relay.localAgentTurn(makeTurn({ ...snapshot, revision: 8 },
        "55555555-5555-4555-8555-555555555555", "rollback")).then(() => null, error => error);
      expect(failure).toMatchObject({ code: "ROLLBACK_UNCONFIRMED", stage: "cad", runId: "run_rollback",
        status: "uncertain", recovery, recoveryPersisted: true });
    } finally { await harness.close(); }
  });

  it("isolates local and Quest request owners during cancellation, even for copied IDs", async () => {
    const signals = new Map<string, AbortSignal>();
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { text: string };
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal;
        signals.set(body.text, signal);
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    const harness = await createHarness(fetch as typeof globalThis.fetch, { listen: true });
    try {
      const snapshot = await harness.relay.localSnapshot();
      const peer = await harness.connect();
      const local = harness.relay.localAgentTurn(makeTurn(snapshot, FLOW, "local" )).then(() => null, error => error);
      const questRequest = makeTurn({ sessionId: String(peer.hello["sessionId"]),
        documentId: String(peer.hello["documentId"]), revision: Number(peer.hello["revision"]) }, FLOW, "quest-one");
      const questOne = peer.client.call("voiceTurn", questRequest as unknown as Record<string, unknown>,
        { sessionId: peer.hello["sessionId"] }).then(() => null, error => error);
      await until(() => signals.has("local") && signals.has("quest-one"));
      await expect(harness.relay.localAgentStatus(snapshot.sessionId)).rejects.toMatchObject({ code: "BUSY" });
      const unrelatedCancel = await harness.relay.localAgentCancel(snapshot.sessionId,
        { documentId: snapshot.documentId, voiceRequestId: "33333333-3333-4333-8333-333333333333" });
      expect(unrelatedCancel.status).toBe("notActive");
      expect(signals.get("local")?.aborted).toBe(false);

      const questCancel = await peer.client.call("cancelVoice", { documentId: snapshot.documentId, voiceRequestId: FLOW },
        { sessionId: peer.hello["sessionId"] });
      expect((questCancel["result"] as Record<string, unknown>)["status"]).toBe("cancelRequested");
      expect(signals.get("quest-one")?.aborted).toBe(true);
      expect(signals.get("local")?.aborted).toBe(false);
      expect(await questOne).toMatchObject({ code: "CANCELLED" });

      const questTwoRequest = { ...questRequest, text: "quest-two" };
      const questTwo = peer.client.call("voiceTurn", questTwoRequest as unknown as Record<string, unknown>,
        { sessionId: peer.hello["sessionId"] }).then(() => null, error => error);
      await until(() => signals.has("quest-two"));
      const localCancel = await harness.relay.localAgentCancel(snapshot.sessionId,
        { documentId: snapshot.documentId, voiceRequestId: FLOW });
      expect(localCancel.status).toBe("cancelRequested");
      expect(signals.get("local")?.aborted).toBe(true);
      expect(signals.get("quest-two")?.aborted).toBe(false);
      expect(await local).toMatchObject({ code: "CANCELLED" });
      await peer.client.call("cancelVoice", { documentId: snapshot.documentId, voiceRequestId: FLOW },
        { sessionId: peer.hello["sessionId"] });
      expect(await questTwo).toMatchObject({ code: "CANCELLED" });
    } finally { await harness.close(); }
  });

  it("aborts on renderer generation change, refuses late reply, and reconnects cleanly", async () => {
    let resolveFetch!: (value: Response) => void;
    let signal: AbortSignal | undefined;
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (signal) return Promise.resolve(response({ service: "kreoda-hermes-bridge", mcp: true }));
      signal = init?.signal as AbortSignal;
      return new Promise<Response>(resolve => { resolveFetch = resolve; });
    });
    const harness = await createHarness(fetch as typeof globalThis.fetch);
    try {
      const snapshot = await harness.relay.localSnapshot();
      const late = harness.relay.localAgentTurn(makeTurn(snapshot)).then(() => null, error => error);
      await until(() => signal !== undefined);
      harness.relay.onRendererDisconnected();
      expect(signal?.aborted).toBe(true);
      resolveFetch(response({ text: "late", runId: "run_late" }));
      expect(await late).toMatchObject({ code: "CLIENT_DISCONNECTED" });
      await expect(harness.relay.localAgentStatus(snapshot.sessionId)).rejects.toMatchObject({ code: "CLIENT_DISCONNECTED" });
      harness.relay.onRendererConnected();
      expect((await harness.relay.localAgentStatus(snapshot.sessionId)).reachable).toBe(true);
    } finally { await harness.close(); }
  });

  it("rejects late turns after core or document lineage rotation", async () => {
    let resolveFetch!: (value: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(resolve => { resolveFetch = resolve; }));
    const harness = await createHarness(fetch as typeof globalThis.fetch);
    try {
      const snapshot = await harness.relay.localSnapshot();
      const afterCoreCrash = harness.relay.localAgentTurn(makeTurn(snapshot)).then(() => null, error => error);
      await until(() => resolveFetch !== undefined);
      harness.relay.onSidecarCrashed();
      resolveFetch(response({ text: "stale core", runId: "run_core" }));
      expect(await afterCoreCrash).toMatchObject({ code: "NEED_FULL_SNAPSHOT" });

      const current = await harness.relay.localSnapshot();
      const afterDocumentOpen = harness.relay.localAgentTurn(makeTurn(current, "66666666-6666-4666-8666-666666666666"))
        .then(() => null, error => error);
      await until(() => fetch.mock.calls.length === 2);
      const frame = frameMessage(new TextEncoder().encode(JSON.stringify({ protocolVersion: 1,
        requestId: "open-local-document", documentId: "doc-opened", type: 11, path: "sandbox.kreoda" })));
      await harness.relay.invokeLocal(frame);
      resolveFetch(response({ text: "stale document", runId: "run_document" }));
      expect(await afterDocumentOpen).toMatchObject({ code: "NEED_FULL_SNAPSHOT" });
    } finally { await harness.close(); }
  });
});
