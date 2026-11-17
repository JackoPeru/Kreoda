import { describe, expect, it, vi } from "vitest";
import { createServer } from "node:net";
import { WebSocket } from "ws";
import { SessionRelay } from "../electron/session";
import { SessionVoiceBridge } from "../electron/session-voice";
import type { SidecarManager } from "../electron/sidecar";
import { SessionClient } from "../e2e/ws-test-client";

const TOKEN = "private-voice-token-123456";

function wav(samples = 16, sampleRate = 16000): Buffer {
  const data = Buffer.alloc(samples * 2);
  const bytes = Buffer.alloc(44 + data.length);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVE", 8);
  bytes.write("fmt ", 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(data.length, 40); data.copy(bytes, 44);
  return bytes;
}

function response(value: unknown, status = 200): Response {
  return new Response(typeof value === "string" ? value : JSON.stringify(value), {
    status, headers: { "content-type": "application/json" },
  });
}

const RELAY_TOKEN = "voice-relay-test-token";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject);server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("could not allocate loopback port");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function createHarness(fetch: typeof globalThis.fetch) {
  const state = { revisionCache: null as number | null };
  const sidecar = {
    invoke: vi.fn(async (frame: Uint8Array) => {
      const length = new DataView(frame.buffer, frame.byteOffset, 4).getUint32(0, true);
      const request = JSON.parse(new TextDecoder().decode(frame.subarray(4, 4 + length))) as Record<string, unknown>;
      return new TextEncoder().encode(JSON.stringify({ status: "ok", requestId: request["requestId"],
        documentId: request["documentId"], revision: state.revisionCache ?? 7, features: [], sketches: [], datums: [] }));
    }),
  };
  const relay = new SessionRelay(() => sidecar as unknown as SidecarManager, undefined, undefined, undefined,
    undefined, undefined, undefined, { token: TOKEN, fetch });
  const port = await freePort();
  await relay.enableListener({ port, host: "127.0.0.1", token: RELAY_TOKEN });
  const clients: SessionClient[] = [];
  const connect = async (capabilities: string[] = ["voice-v1"]): Promise<{ client: SessionClient; hello: Record<string, unknown> }> => {
    const client = new SessionClient();clients.push(client);
    const hello = await client.connect(RELAY_TOKEN, port, undefined, capabilities);
    return { client, hello };
  };
  return {
    relay, state, port, connect,
    async close() {
      for (const client of clients) client.closeRaw();
      await relay.disableListener();relay.stop();
    },
  };
}

function metadata(hello: Record<string, unknown>) {
  return { sessionId: hello["sessionId"] as string };
}

function voiceContext(hello: Record<string, unknown>, voiceRequestId: string, revision?: number) {
  return { voiceRequestId, sessionId: hello["sessionId"], documentId: hello["documentId"],
    revision: revision ?? hello["revision"] };
}

async function expectCode(promise: Promise<Record<string, unknown>>, code: string): Promise<Error & { code?: string }> {
  const error = await promise.then(() => new Error("expected session call to fail"), value => value as Error & { code?: string });
  expect(error).toMatchObject({ code });
  return error;
}

async function rejectedError(promise: Promise<unknown>): Promise<Error & {
  code?: string; stage?: string; runId?: string; status?: string; recovery?: unknown; recoveryPersisted?: boolean;
}> {
  let failure: unknown;
  try { await promise; } catch (error) { failure = error; }
  if (!(failure instanceof Error)) throw new Error("expected promise to reject");
  return failure as Error & { code?: string; stage?: string; runId?: string; status?: string; recovery?: unknown; recoveryPersisted?: boolean };
}

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function rawReply(socket: WebSocket, request: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off("message", onMessage);reject(new Error("raw WebSocket reply timed out")); }, 2000);
    const onMessage = (data: WebSocket.RawData): void => {
      let value: Record<string, unknown>;
      try { value = JSON.parse(String(data)) as Record<string, unknown>; }
      catch { return; }
      if (value["requestId"] !== request["requestId"]) return;
      clearTimeout(timer);socket.off("message", onMessage);resolve(value);
    };
    socket.on("message", onMessage);
    socket.send(JSON.stringify(request), error => {
      if (error) { clearTimeout(timer);socket.off("message", onMessage);reject(error); }
    });
  });
}

describe("Desktop voice bridge", () => {
  it("uses only fixed loopback health and reports configured independently", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({ service: "kreoda-hermes-bridge", mcp: true, voiceConfigured: true }));
    const bridge = new SessionVoiceBridge({ token: TOKEN, fetch });
    expect(bridge.configured).toBe(true);
    expect(await bridge.reachable()).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:9843/health");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).not.toHaveProperty("Authorization");

    const wrongService = new SessionVoiceBridge({ token: TOKEN,
      fetch: vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({ service: "other", mcp: true })) });
    await expect(wrongService.reachable()).resolves.toBe(false);
  });

  it("posts validated raw WAV, with the private bearer only on the fixed transcription route", async () => {
    const audio = wav();
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({ text: "Dettato" }));
    const bridge = new SessionVoiceBridge({ token: TOKEN, fetch });
    await expect(bridge.transcribe(audio.toString("base64"))).resolves.toBe("Dettato");
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:9843/voice/transcribe");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(init?.redirect).toBe("manual");
    expect(Buffer.from(init?.body as Uint8Array)).toEqual(audio);
  });

  it("rejects noncanonical base64 and invalid or overlong WAV before fetch", async () => {
    const fetch = vi.fn(async () => response({ text: "unexpected" }));
    const bridge = new SessionVoiceBridge({ token: TOKEN, fetch });
    await expect(bridge.transcribe("AA A")).rejects.toMatchObject({ code: "BAD_PARAMS" });
    await expect(bridge.transcribe(Buffer.alloc(44).toString("base64"))).rejects.toMatchObject({ code: "BAD_PARAMS" });
    await expect(bridge.transcribe(wav(16000 * 31).toString("base64"))).rejects.toMatchObject({ code: "BAD_PARAMS" });
    await expect(bridge.transcribe(Buffer.alloc(1024 * 1024 + 1).toString("base64"))).rejects.toMatchObject({ code: "BAD_PARAMS" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps turn context intact and rejects redirects without following them", async () => {
    const context = { voiceRequestId: "flow", sessionId: "cad-session", documentId: "doc", revision: 3, extra: "kept" };
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({ text: "Fatto", sessionId: "hermes-session", runId: "run_1" }));
    const bridge = new SessionVoiceBridge({ token: TOKEN, fetch });
    await expect(bridge.turn("Crea un box", context)).resolves.toMatchObject({ runId: "run_1" });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:9843/voice/turn");
    expect(JSON.parse(String(init?.body))).toEqual({ text: "Crea un box", context });

    const redirectFetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://private.invalid" } }));
    await expect(new SessionVoiceBridge({ token: TOKEN, fetch: redirectFetch }).turn("Pronto", context))
      .rejects.toMatchObject({ code: "VOICE_FAILED" });
    expect(redirectFetch).toHaveBeenCalledOnce();

    const malformed = new SessionVoiceBridge({ token: TOKEN,
      fetch: vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{", { status: 200 })) });
    await expect(malformed.turn("Pronto", context)).rejects.toMatchObject({ code: "VOICE_FAILED", stage: "turn" });
    const invalidIdentity = new SessionVoiceBridge({ token: TOKEN,
      fetch: vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({ text: "ok", runId: "bad run" })) });
    await expect(invalidIdentity.turn("Pronto", context)).rejects.toMatchObject({ code: "VOICE_FAILED", stage: "turn" });
  });

  it("bounds upstream errors and forwards only safe stage and valid runId", async () => {
    const fetch = vi.fn(async () => response({ error: `token=${TOKEN}`, stage: "hermes", runId: "run_1" }, 502));
    const bridge = new SessionVoiceBridge({ token: TOKEN, fetch });
    const error = await rejectedError(bridge.turn("Pronto", {}));
    expect(error).toMatchObject({ code: "VOICE_FAILED", stage: "hermes", runId: "run_1" });
    expect(error.message).not.toContain(TOKEN);
    expect(error.message.length).toBeLessThanOrEqual(512);

    const oversized = new SessionVoiceBridge({
      token: TOKEN,
      fetch: vi.fn(async () => new Response(new Uint8Array(65537), { status: 502 })),
    });
    await expect(oversized.turn("Pronto", {})).rejects.toMatchObject({ code: "VOICE_FAILED" });
  });

  it("preserves uncertain rollback code while dropping malformed recovery details", async () => {
    const recovery = {
      requestId: "11111111-1111-4111-8111-111111111111", transactionId: "22222222-2222-4222-8222-222222222222",
      sessionId: "33333333-3333-4333-8333-333333333333", documentId: "doc-phase-voice", baseRevision: 7,
      ownerClientId: "client-44444444-4444-4444-8444-444444444444", causeCode: "NEED_FULL_SNAPSHOT",
    };
    const bridge = new SessionVoiceBridge({ token: TOKEN, fetch: vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({ error: `Rollback uncertain ${TOKEN}`,
      stage: "cad", status: "uncertain", errorCode: "ROLLBACK_UNCONFIRMED", recovery, recoveryPersisted: true }, 502)) });
    const error = await rejectedError(bridge.turn("Pronto", {}));
    expect(error).toMatchObject({ code: "ROLLBACK_UNCONFIRMED", stage: "cad", status: "uncertain", recovery, recoveryPersisted: true });
    expect(error.message).not.toContain(TOKEN);

    const malformed = new SessionVoiceBridge({ token: TOKEN, fetch: vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({ error: "rollback uncertain",
      stage: "cad", errorCode: "ROLLBACK_UNCONFIRMED", status: "uncertain", recovery: { ...recovery, token: TOKEN },
      recoveryPersisted: false }, 502)) });
    const invalid = await rejectedError(malformed.turn("Pronto", {}));
    expect(invalid).toMatchObject({ code: "ROLLBACK_UNCONFIRMED", status: "uncertain", recoveryPersisted: false });
    expect(invalid.recovery).toBeUndefined();
    expect(invalid.message).not.toContain(TOKEN);
  });

  it("validates synthesized WAV and refuses actions without configured credentials", async () => {
    const audio = wav();
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(Uint8Array.from(audio).buffer, { headers: { "content-type": "audio/wav" } }));
    const bridge = new SessionVoiceBridge({ token: TOKEN, fetch });
    await expect(bridge.synthesize("Pronto")).resolves.toBe(audio.toString("base64"));
    expect(fetch.mock.calls[0]?.[0]).toBe("http://127.0.0.1:9843/voice/speech");
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ text: "Pronto", context: {} });

    const tooLong = wav(16000 * 121);
    const overDuration = new SessionVoiceBridge({ token: TOKEN,
      fetch: vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(Uint8Array.from(tooLong).buffer)) });
    await expect(overDuration.synthesize("Pronto")).rejects.toMatchObject({ code: "BAD_PARAMS" });
    const oversizedAudio = new SessionVoiceBridge({ token: TOKEN,
      fetch: vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(new Uint8Array(4 * 1024 * 1024 + 1))) });
    await expect(oversizedAudio.synthesize("Pronto")).rejects.toMatchObject({ code: "VOICE_FAILED" });

    const unconfiguredFetch = vi.fn(async () => response({}));
    const unconfigured = new SessionVoiceBridge({ fetch: unconfiguredFetch });
    expect(unconfigured.configured).toBe(false);
    await expect(unconfigured.transcribe(audio.toString("base64"))).rejects.toMatchObject({ code: "VOICE_UNAVAILABLE" });
    expect(unconfiguredFetch).not.toHaveBeenCalled();
  });

  it("rejects missing auth context, capability, document, revision, operation replay, and mismatched context before upstream", async () => {
    const fetch = vi.fn(async () => response({ text: "unexpected" }));
    const harness = await createHarness(fetch as typeof globalThis.fetch);
    try {
      const unauthenticated = new WebSocket(`ws://127.0.0.1:${harness.port}`);
      await new Promise<void>((resolve, reject) => { unauthenticated.once("open", resolve);unauthenticated.once("error", reject); });
      const unauthenticatedReply = await rawReply(unauthenticated, { requestId: "unauth", method: "getVoiceStatus", params: {} });
      expect(unauthenticatedReply).toMatchObject({ ok: false, errorCode: "NOT_AUTHED" });
      unauthenticated.close();
      const peer = await harness.connect();
      const noCapability = await harness.connect([]);
      await expectCode(noCapability.client.call("getVoiceStatus", {}, metadata(noCapability.hello)), "NOT_IMPLEMENTED");
      await expectCode(peer.client.call("getVoiceStatus", {}), "BAD_PARAMS");
      await expectCode(peer.client.call("getVoiceStatus", {}, { sessionId: "33333333-3333-4333-8333-333333333333" }), "NEED_FULL_SNAPSHOT");

      const flow = "22222222-2222-4222-8222-222222222222";
      const audio = wav().toString("base64");
      await expectCode(peer.client.call("transcribeVoice", {
        voiceRequestId: flow, documentId: "other-document", expectedRevision: peer.hello["revision"], wavBase64: audio,
      }, metadata(peer.hello)), "NEED_FULL_SNAPSHOT");
      await expectCode(peer.client.call("transcribeVoice", {
        voiceRequestId: flow, documentId: peer.hello["documentId"], expectedRevision: 6, wavBase64: audio,
      }, metadata(peer.hello)), "NEED_FULL_SNAPSHOT");
      await expectCode(peer.client.call("transcribeVoice", {
        voiceRequestId: flow, documentId: peer.hello["documentId"], expectedRevision: peer.hello["revision"], wavBase64: audio,
      }, { ...metadata(peer.hello), operationId: "44444444-4444-4444-8444-444444444444" }), "BAD_PARAMS");
      const goodContext = voiceContext(peer.hello, flow);
      for (const context of [
        { ...goodContext, voiceRequestId: "33333333-3333-4333-8333-333333333333" },
        { ...goodContext, sessionId: "33333333-3333-4333-8333-333333333333" },
        { ...goodContext, documentId: "other-document" },
        { ...goodContext, revision: Number(peer.hello["revision"]) + 1 },
      ]) await expectCode(peer.client.call("voiceTurn", {
        voiceRequestId: flow, documentId: peer.hello["documentId"], expectedRevision: peer.hello["revision"], text: "Pronto", context,
      }, metadata(peer.hello)), "BAD_PARAMS");
      expect(fetch).not.toHaveBeenCalled();
    } finally { await harness.close(); }
  });

  it("returns safe health status with current CAD identity and no private endpoint or token", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({ service: "kreoda-hermes-bridge", mcp: true, voiceConfigured: true }));
    const harness = await createHarness(fetch as typeof globalThis.fetch);
    try {
      const peer = await harness.connect();
      const result = await peer.client.call("getVoiceStatus", {}, metadata(peer.hello));
      expect(result["result"]).toEqual({ sessionId: peer.hello["sessionId"], documentId: peer.hello["documentId"],
        revision: peer.hello["revision"], configured: true, reachable: true });
      expect(JSON.stringify(result)).not.toContain(TOKEN);
      expect(JSON.stringify(result)).not.toContain("127.0.0.1");
      expect(fetch.mock.calls[0]?.[0]).toBe("http://127.0.0.1:9843/health");
      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).has("authorization")).toBe(false);
    } finally { await harness.close(); }
  });

  it("rejects stale transcription revision but allows a voice turn's CAD revision advance", async () => {
    let setRelayRevision = (_revision: number): void => {};
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/voice/transcribe")) {
        setRelayRevision(8);
        return response({ text: "Dettato" });
      }
      setRelayRevision(9);
      return response({ text: "Creato", sessionId: "hermes-conversation", runId: "run_1" });
    });
    const harness = await createHarness(fetch as typeof globalThis.fetch);
    setRelayRevision = revision => { (harness.relay as unknown as { revisionCache: number | null }).revisionCache = revision; };
    try {
      const peer = await harness.connect();
      const flow = "22222222-2222-4222-8222-222222222222";
      await expectCode(peer.client.call("transcribeVoice", {
        voiceRequestId: flow, documentId: peer.hello["documentId"], expectedRevision: peer.hello["revision"], wavBase64: wav().toString("base64"),
      }, metadata(peer.hello)), "NEED_FULL_SNAPSHOT");
      const result = await peer.client.call("voiceTurn", {
        voiceRequestId: flow, documentId: peer.hello["documentId"], expectedRevision: 8, text: "Crea un box",
        context: voiceContext(peer.hello, flow, 8),
      }, metadata(peer.hello));
      const payload = result["result"] as Record<string, unknown>;
      expect(payload["sessionId"]).toBe(peer.hello["sessionId"]);
      expect(payload["documentId"]).toBe(peer.hello["documentId"]);
      expect(payload["revision"]).toBe(9);
      expect((payload["reply"] as Record<string, unknown>)["sessionId"]).toBe("hermes-conversation");
    } finally { await harness.close(); }
  });

  it("enforces one active flow per socket and same-socket cancellation", async () => {
    let signal: AbortSignal | undefined;
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = init?.signal as AbortSignal;
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const harness = await createHarness(fetch as typeof globalThis.fetch);
    try {
      const peer = await harness.connect();
      const flow = "22222222-2222-4222-8222-222222222222";
      const inFlight = peer.client.call("transcribeVoice", {
        voiceRequestId: flow, documentId: peer.hello["documentId"], expectedRevision: peer.hello["revision"], wavBase64: wav().toString("base64"),
      }, metadata(peer.hello)).catch(error => error as Error & { code?: string });
      await until(() => signal !== undefined);
      await expectCode(peer.client.call("getVoiceStatus", {}, metadata(peer.hello)), "BUSY");
      const cancelled = await peer.client.call("cancelVoice", {
        voiceRequestId: flow, documentId: peer.hello["documentId"],
      }, metadata(peer.hello));
      expect((cancelled["result"] as Record<string, unknown>)["status"]).toBe("cancelRequested");
      expect(await inFlight).toMatchObject({ code: "CANCELLED" });
    } finally { await harness.close(); }
  });

  it("keeps cancellation peer-scoped and aborts pending upstream work on socket close", async () => {
    let resolveFetch!: (value: Response) => void;
    let signal: AbortSignal | undefined;
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>(resolve => {
      resolveFetch = resolve;signal = init?.signal as AbortSignal;
    }));
    const harness = await createHarness(fetch as typeof globalThis.fetch);
    try {
      const first = await harness.connect(), second = await harness.connect();
      const flow = "22222222-2222-4222-8222-222222222222";
      const inFlight = first.client.call("transcribeVoice", {
        voiceRequestId: flow, documentId: first.hello["documentId"], expectedRevision: first.hello["revision"], wavBase64: wav().toString("base64"),
      }, metadata(first.hello)).catch(error => error as Error & { code?: string });
      await until(() => signal !== undefined);
      const otherCancel = await second.client.call("cancelVoice", {
        voiceRequestId: flow, documentId: second.hello["documentId"],
      }, metadata(second.hello));
      expect((otherCancel["result"] as Record<string, unknown>)["status"]).toBe("notActive");
      expect(signal?.aborted).toBe(false);
      resolveFetch(response({ text: "Dettato" }));
      expect(await inFlight).toMatchObject({ ok: true });

      const closeFlow = "33333333-3333-4333-8333-333333333333";
      const closing = first.client.call("transcribeVoice", {
        voiceRequestId: closeFlow, documentId: first.hello["documentId"], expectedRevision: first.hello["revision"], wavBase64: wav().toString("base64"),
      }, metadata(first.hello)).catch(error => error as Error & { code?: string });
      await until(() => Boolean(signal?.aborted) || fetch.mock.calls.length >= 2);
      first.client.closeRaw();
      await until(() => Boolean(signal?.aborted));
      expect(await closing).toMatchObject({ message: "socket closed before reply" });
    } finally { await harness.close(); }
  });

  it("aborts a voice operation when core lineage changes during upstream work", async () => {
    let relay: SessionRelay | undefined;
    const fetch = vi.fn(async () => {
      relay?.onSidecarCrashed();
      return response({ text: "Dettato" });
    });
    const harness = await createHarness(fetch as typeof globalThis.fetch);relay = harness.relay;
    try {
      const peer = await harness.connect();
      const flow = "22222222-2222-4222-8222-222222222222";
      await expectCode(peer.client.call("transcribeVoice", {
        voiceRequestId: flow, documentId: peer.hello["documentId"], expectedRevision: peer.hello["revision"], wavBase64: wav().toString("base64"),
      }, metadata(peer.hello)), "NEED_FULL_SNAPSHOT");
      expect(fetch).toHaveBeenCalledOnce();
    } finally { await harness.close(); }
  });

  it("preserves full rollback recovery identity over WebSocket without replaying", async () => {
    let recovery: Record<string, unknown> = {};
    const fetch = vi.fn(async () => response({ error: `Rollback uncertain token=${TOKEN}`, stage: "cad", status: "uncertain",
      errorCode: "ROLLBACK_UNCONFIRMED", recovery, recoveryPersisted: true, gatewayUrl: "http://secret.invalid" }, 502));
    const harness = await createHarness(fetch as typeof globalThis.fetch);
    const socket = new WebSocket(`ws://127.0.0.1:${harness.port}`);
    try {
      await new Promise<void>((resolve, reject) => { socket.once("open", resolve);socket.once("error", reject); });
      const hello = await rawReply(socket, { requestId: "hello", method: "hello", params: {
        token: RELAY_TOKEN, protocolVersion: 1, capabilities: ["voice-v1"],
      } });
      recovery = { requestId: "11111111-1111-4111-8111-111111111111", transactionId: "22222222-2222-4222-8222-222222222222",
        sessionId: hello["sessionId"], documentId: hello["documentId"], baseRevision: hello["revision"],
        ownerClientId: hello["clientId"], causeCode: "NEED_FULL_SNAPSHOT" };
      const flow = "55555555-5555-4555-8555-555555555555";
      const params = { voiceRequestId: flow, documentId: hello["documentId"], expectedRevision: hello["revision"],
        text: "Pronto", context: voiceContext(hello, flow) };
      const first = await rawReply(socket, { requestId: "turn-1", method: "voiceTurn", sessionId: hello["sessionId"], params });
      expect(first).toMatchObject({ ok: false, errorCode: "ROLLBACK_UNCONFIRMED", stage: "cad", status: "uncertain",
        recovery, recoveryPersisted: true });
      expect(String(first["error"])).not.toContain(TOKEN);
      expect(first).not.toHaveProperty("gatewayUrl");

      const second = await rawReply(socket, { requestId: "turn-2", method: "voiceTurn", sessionId: hello["sessionId"], params });
      expect(second).toMatchObject({ ok: false, errorCode: "ROLLBACK_UNCONFIRMED", status: "uncertain", recovery });
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally { socket.close();await harness.close(); }
  });

  it("preserves prior-turn recovery for the same session and document without retrying", async () => {
    let recovery: Record<string, unknown> = {};
    const fetch = vi.fn(async () => response({ error: `Rollback uncertain token=${TOKEN}`, stage: "cad", status: "uncertain",
      errorCode: "ROLLBACK_UNCONFIRMED", recovery, recoveryPersisted: true }, 502));
    const harness = await createHarness(fetch as typeof globalThis.fetch);
    const socket = new WebSocket(`ws://127.0.0.1:${harness.port}`);
    try {
      await new Promise<void>((resolve, reject) => { socket.once("open", resolve);socket.once("error", reject); });
      const hello = await rawReply(socket, { requestId: "hello", method: "hello", params: {
        token: RELAY_TOKEN, protocolVersion: 1, capabilities: ["voice-v1"],
      } });
      const micRevision = hello["revision"] as number;
      expect(micRevision).toBeGreaterThan(0);
      recovery = { requestId: "11111111-1111-4111-8111-111111111111", transactionId: "22222222-2222-4222-8222-222222222222",
        sessionId: hello["sessionId"], documentId: hello["documentId"], baseRevision: micRevision - 1,
        ownerClientId: hello["clientId"], causeCode: "HttpRequestException" };
      const flow = "55555555-5555-4555-8555-555555555555";
      const params = { voiceRequestId: flow, documentId: hello["documentId"], expectedRevision: micRevision,
        text: "Pronto", context: voiceContext(hello, flow, micRevision) };
      const result = await rawReply(socket, { requestId: "turn-historical", method: "voiceTurn", sessionId: hello["sessionId"], params });
      expect(result).toMatchObject({ ok: false, errorCode: "ROLLBACK_UNCONFIRMED", stage: "cad", status: "uncertain",
        recovery, recoveryPersisted: true });
      expect(Object.keys(result["recovery"] as Record<string, unknown>).sort()).toEqual([
        "baseRevision", "causeCode", "documentId", "ownerClientId", "requestId", "sessionId", "transactionId",
      ]);
      expect(fetch).toHaveBeenCalledOnce();
    } finally { socket.close();await harness.close(); }
  });

  it("drops recovery payloads from another session or document", async () => {
    let recovery: Record<string, unknown> = {};
    const fetch = vi.fn(async () => response({ error: `Rollback uncertain token=${TOKEN}`, stage: "cad", status: "uncertain",
      errorCode: "ROLLBACK_UNCONFIRMED", recovery, recoveryPersisted: true }, 502));
    const harness = await createHarness(fetch as typeof globalThis.fetch);
    const socket = new WebSocket(`ws://127.0.0.1:${harness.port}`);
    try {
      await new Promise<void>((resolve, reject) => { socket.once("open", resolve);socket.once("error", reject); });
      const hello = await rawReply(socket, { requestId: "hello", method: "hello", params: {
        token: RELAY_TOKEN, protocolVersion: 1, capabilities: ["voice-v1"],
      } });
      const revision = hello["revision"] as number;
      const identity = { requestId: "11111111-1111-4111-8111-111111111111", transactionId: "22222222-2222-4222-8222-222222222222",
        sessionId: hello["sessionId"], documentId: hello["documentId"], baseRevision: revision - 1,
        ownerClientId: hello["clientId"], causeCode: "HttpRequestException" };
      const foreignIdentities = [
        { sessionId: "66666666-6666-4666-8666-666666666666" },
        { documentId: "doc-other" },
      ];
      for (const [index, foreign] of foreignIdentities.entries()) {
        recovery = { ...identity, ...foreign };
        const flow = index === 0 ? "77777777-7777-4777-8777-777777777777" : "88888888-8888-4888-8888-888888888888";
        const params = { voiceRequestId: flow, documentId: hello["documentId"], expectedRevision: revision,
          text: "Pronto", context: voiceContext(hello, flow, revision) };
        const result = await rawReply(socket, { requestId: `turn-foreign-${index}`, method: "voiceTurn", sessionId: hello["sessionId"], params });
        expect(result).toMatchObject({ ok: false, errorCode: "ROLLBACK_UNCONFIRMED", stage: "cad", status: "uncertain",
          recoveryPersisted: true });
        expect(result).not.toHaveProperty("recovery");
      }
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally { socket.close();await harness.close(); }
  });
});
