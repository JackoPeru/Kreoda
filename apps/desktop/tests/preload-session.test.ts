import { expect, test, vi } from "vitest";

const { invoke, expose } = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  expose: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcRenderer: { invoke },
  contextBridge: { exposeInMainWorld: expose },
}));

test("session recovery and preview cancellation use narrow IPC entries", async () => {
  await import("../electron/preload");
  const api = expose.mock.calls[0]![1] as {
    sessionSnapshot: () => Promise<unknown>;
    sessionCancelEdit: (id: string) => Promise<void>;
    agentStatus: (sessionId: string) => Promise<unknown>;
    agentTurn: (request: unknown) => Promise<unknown>;
    agentCancel: (sessionId: string, request: unknown) => Promise<unknown>;
  };
  await api.sessionCancelEdit("box");
  expect(invoke).toHaveBeenLastCalledWith("kreoda:session-cancel-edit", "box");
  await api.sessionSnapshot();
  expect(invoke).toHaveBeenLastCalledWith("kreoda:session-snapshot");

  invoke.mockClear();
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const request = { voiceRequestId: "22222222-2222-4222-8222-222222222222", documentId: "doc-a",
    expectedRevision: 7, text: "Create a box", context: { voiceRequestId: "22222222-2222-4222-8222-222222222222",
      sessionId, documentId: "doc-a", revision: 7 } };
  const cancel = { documentId: "doc-a", voiceRequestId: request.voiceRequestId };
  await api.agentStatus(sessionId);
  await api.agentTurn(request);
  await api.agentCancel(sessionId, cancel);
  expect(invoke.mock.calls).toEqual([
    ["kreoda:agent-status", sessionId],
    ["kreoda:agent-turn", request],
    ["kreoda:agent-cancel", sessionId, cancel],
  ]);
  expect(api).not.toHaveProperty("agentInvoke");
});
