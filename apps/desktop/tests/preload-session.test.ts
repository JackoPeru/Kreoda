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
  };
  await api.sessionCancelEdit("box");
  expect(invoke).toHaveBeenLastCalledWith("kreoda:session-cancel-edit", "box");
  await api.sessionSnapshot();
  expect(invoke).toHaveBeenLastCalledWith("kreoda:session-snapshot");
});
