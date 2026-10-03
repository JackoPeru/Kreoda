import { expect, test, vi } from "vitest";

const { invoke, expose } = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  expose: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcRenderer: { invoke },
  contextBridge: { exposeInMainWorld: expose },
}));

test("session notes preserve absent snapshots and explicit empty documents", async () => {
  await import("../electron/preload");
  const api = expose.mock.calls[0]![1] as {
    sessionSnapshot: () => Promise<unknown>;
    sessionNote: (id: string, revision: number, features?: unknown[], sketches?: unknown[]) => Promise<void>;
  };
  await api.sessionNote("doc", 1);
  expect(invoke).toHaveBeenLastCalledWith("kreoda:session-note", "doc", 1, undefined, undefined);
  await api.sessionNote("doc", 2, [], []);
  expect(invoke).toHaveBeenLastCalledWith("kreoda:session-note", "doc", 2, [], []);
  await api.sessionSnapshot();
  expect(invoke).toHaveBeenLastCalledWith("kreoda:session-snapshot");
});
