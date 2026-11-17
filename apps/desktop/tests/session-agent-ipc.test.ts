import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron";
import type { SessionRelay } from "../electron/session";

const SESSION = "11111111-1111-4111-8111-111111111111";
const FLOW = "22222222-2222-4222-8222-222222222222";
const DOCUMENT = "doc-agent";
type Handler = (event: unknown, ...args: unknown[]) => unknown;

async function loadInstaller() {
  const module = await import("../electron/session-agent").catch(() => null);
  expect(module?.installSessionAgentIpc).toBeTypeOf("function");
  return module?.installSessionAgentIpc;
}

function turnRequest() {
  return { voiceRequestId: FLOW, documentId: DOCUMENT, expectedRevision: 7, text: "Create a box",
    context: { voiceRequestId: FLOW, sessionId: SESSION, documentId: DOCUMENT, revision: 7 } };
}

function setup(options: {
  url?: string; expectedUrl?: string; missingWindow?: boolean; missingFrame?: boolean;
  destroyed?: boolean; webContentsDestroyed?: boolean;
} = {}) {
  const handlers = new Map<string, Handler>();
  const frame = { url: options.url ?? "http://127.0.0.1:5173/" };
  const webContents = {
    mainFrame: options.missingFrame ? null : frame,
    getURL: () => options.url ?? "http://127.0.0.1:5173/",
    isDestroyed: () => options.destroyed ?? options.webContentsDestroyed ?? false,
  };
  const window = { webContents, isDestroyed: () => options.destroyed ?? false };
  const relay = {
    localAgentStatus: vi.fn(async (sessionId: string) => ({ sessionId, documentId: DOCUMENT, revision: 7, configured: true, reachable: true })),
    localAgentTurn: vi.fn(async () => ({ sessionId: SESSION, documentId: DOCUMENT, revision: 7, voiceRequestId: FLOW,
      reply: { text: "Hermes reply", runId: "run_1" } })),
    localAgentCancel: vi.fn(async (_sessionId: string, request: { documentId: string; voiceRequestId: string }) => ({
      sessionId: SESSION, documentId: request.documentId, revision: 7, voiceRequestId: request.voiceRequestId, status: "notActive" as const,
    })),
  };
  const ipc = { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); } } as unknown as Pick<IpcMain, "handle">;
  const getWindow = () => options.missingWindow ? null : window as unknown as BrowserWindow;
  const getRelay = () => relay as unknown as SessionRelay;
  const event = { sender: webContents, senderFrame: options.missingFrame ? null : frame } as unknown as IpcMainInvokeEvent;
  return { handlers, ipc, window, webContents, frame, relay, getWindow, getRelay, event,
    expectedUrl: options.expectedUrl ?? "http://127.0.0.1:5173/" };
}

async function install(harness: ReturnType<typeof setup>) {
  const installer = await loadInstaller();
  if (!installer) throw new Error("session agent IPC installer missing");
  installer(harness.ipc, harness.getWindow, harness.getRelay, harness.expectedUrl);
}

async function invoke(harness: ReturnType<typeof setup>, channel: string, event: unknown, ...args: unknown[]) {
  const handler = harness.handlers.get(channel);
  if (!handler) throw new Error(`handler not registered: ${channel}`);
  return await handler(event, ...args);
}

describe("Session agent IPC adapter", () => {
  it("registers exactly three local typed agent channels and returns typed success", async () => {
    const harness = setup();
    await install(harness);
    expect([...harness.handlers.keys()]).toEqual(["kreoda:agent-status", "kreoda:agent-turn", "kreoda:agent-cancel"]);
    const status = await invoke(harness, "kreoda:agent-status", harness.event, SESSION);
    expect(status).toEqual({ ok: true, result: { sessionId: SESSION, documentId: DOCUMENT,
      revision: 7, configured: true, reachable: true } });
    const turn = await invoke(harness, "kreoda:agent-turn", harness.event, turnRequest());
    expect(turn).toMatchObject({ ok: true, result: { reply: { text: "Hermes reply", runId: "run_1" } } });
    const cancel = await invoke(harness, "kreoda:agent-cancel", harness.event, SESSION,
      { documentId: DOCUMENT, voiceRequestId: FLOW });
    expect(cancel).toMatchObject({ ok: true, result: { status: "notActive", voiceRequestId: FLOW } });
  });

  it("rejects foreign, subframe, navigated, missing, or destroyed renderers before relay access", async () => {
    const harness = setup();
    await install(harness);
    const cases: unknown[] = [
      { sender: {}, senderFrame: harness.frame },
      { sender: harness.webContents, senderFrame: { url: "http://127.0.0.1:5173/child" } },
    ];
    for (const event of cases) {
      const result = await invoke(harness, "kreoda:agent-status", event, SESSION) as Record<string, unknown>;
      expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    }
    expect(harness.relay.localAgentStatus).not.toHaveBeenCalled();

    const navigated = setup({ url: "https://attacker.invalid/" });
    await install(navigated);
    expect(await invoke(navigated, "kreoda:agent-status", navigated.event, SESSION))
      .toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    const missingFrame = setup({ missingFrame: true });
    await install(missingFrame);
    expect(await invoke(missingFrame, "kreoda:agent-status", missingFrame.event, SESSION)).toMatchObject({ ok: false });

    const missing = setup({ missingWindow: true });
    await install(missing);
    expect(await invoke(missing, "kreoda:agent-status", missing.event, SESSION)).toMatchObject({ ok: false });
    const destroyed = setup({ destroyed: true });
    await install(destroyed);
    expect(await invoke(destroyed, "kreoda:agent-status", destroyed.event, SESSION)).toMatchObject({ ok: false });
    const destroyedContents = setup({ webContentsDestroyed: true });
    await install(destroyedContents);
    expect(await invoke(destroyedContents, "kreoda:agent-status", destroyedContents.event, SESSION)).toMatchObject({ ok: false });
    expect(missing.relay.localAgentStatus).not.toHaveBeenCalled();
    expect(destroyed.relay.localAgentStatus).not.toHaveBeenCalled();
    expect(navigated.relay.localAgentStatus).not.toHaveBeenCalled();
    expect(missingFrame.relay.localAgentStatus).not.toHaveBeenCalled();
    expect(destroyedContents.relay.localAgentStatus).not.toHaveBeenCalled();
  });

  it("allows packaged main file with hash but rejects another file or dev origin", async () => {
    const expectedUrl = "file:///C:/Kreoda%20App/dist/index.html";
    const file = setup({ url: `${expectedUrl}#/home`, expectedUrl });
    await install(file);
    expect(await invoke(file, "kreoda:agent-status", file.event, SESSION)).toMatchObject({ ok: true });
    const other = setup({ url: "file:///C:/Kreoda%20App/dist/other.html", expectedUrl });
    await install(other);
    expect(await invoke(other, "kreoda:agent-status", other.event, SESSION)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    const wrongOrigin = setup({ url: "http://127.0.0.1:5174/", expectedUrl: "http://127.0.0.1:5173/" });
    await install(wrongOrigin);
    expect(await invoke(wrongOrigin, "kreoda:agent-status", wrongOrigin.event, SESSION)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("rejects malformed payloads before relay fetch and sanitizes unknown errors", async () => {
    const harness = setup();
    await install(harness);
    expect(await invoke(harness, "kreoda:agent-status", harness.event, "not-a-session"))
      .toMatchObject({ ok: false, error: { code: "BAD_PARAMS" } });
    expect(await invoke(harness, "kreoda:agent-turn", harness.event, { ...turnRequest(), voiceRequestId: "bad" }))
      .toMatchObject({ ok: false, error: { code: "BAD_PARAMS" } });
    expect(await invoke(harness, "kreoda:agent-cancel", harness.event, "not-a-session",
      { documentId: DOCUMENT, voiceRequestId: FLOW })).toMatchObject({ ok: false, error: { code: "BAD_PARAMS" } });
    expect(harness.relay.localAgentStatus).not.toHaveBeenCalled();
    expect(harness.relay.localAgentTurn).not.toHaveBeenCalled();
    expect(harness.relay.localAgentCancel).not.toHaveBeenCalled();

    harness.relay.localAgentTurn.mockRejectedValueOnce(new Error("Bearer private-secret https://secret.invalid/token"));
    const failure = await invoke(harness, "kreoda:agent-turn", harness.event, turnRequest());
    expect(failure).toEqual({ ok: false, error: { code: "VOICE_FAILED", message: "Voice bridge request failed" } });
    expect(JSON.stringify(failure)).not.toContain("private-secret");
    expect(JSON.stringify(failure)).not.toContain("secret.invalid");
  });

  it("preserves validated rollback run and recovery metadata", async () => {
    const harness = setup();
    await install(harness);
    const recovery = { requestId: FLOW, transactionId: "44444444-4444-4444-8444-444444444444",
      sessionId: SESSION, documentId: DOCUMENT, baseRevision: 7, ownerClientId: null, causeCode: "NEED_FULL_SNAPSHOT" };
    const { SessionVoiceError } = await import("../electron/session-voice");
    harness.relay.localAgentTurn.mockRejectedValueOnce(new SessionVoiceError("Rollback uncertain", "ROLLBACK_UNCONFIRMED",
      "cad", "run_rollback", "uncertain", recovery, true));
    const failure = await invoke(harness, "kreoda:agent-turn", harness.event, turnRequest());
    expect(failure).toEqual({ ok: false, error: { code: "ROLLBACK_UNCONFIRMED",
      message: "CAD recovery status is uncertain", stage: "cad", runId: "run_rollback", status: "uncertain", recovery, recoveryPersisted: true } });
  });
});
