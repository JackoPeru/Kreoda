// @vitest-environment node
import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import { installRendererRecovery } from "../electron/renderer-recovery";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("recovers a twice-confirmed missing PID without an exit event, coalesces events and bounds reloads", () => {
  vi.useFakeTimers();
  const probe = vi.spyOn(process, "kill").mockImplementation(() => true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const contents = Object.assign(new EventEmitter(), {
    getOSProcessId: () => 123456, isDestroyed: () => false,
    isLoadingMainFrame: () => false, reload: vi.fn(),
  });
  const window = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false });
  const reasons: string[] = [];
  contents.on("kreoda-renderer-recovery", ({ reason }) => reasons.push(reason));
  const replaceWindow = vi.fn();
  const disconnected = vi.fn();
  installRendererRecovery(window as unknown as BrowserWindow, replaceWindow, disconnected);
  vi.advanceTimersByTime(3000);
  expect(contents.reload).not.toHaveBeenCalled();
  probe.mockImplementation(() => { throw Object.assign(new Error("denied"), { code: "EPERM" }); });
  vi.advanceTimersByTime(2000);
  expect(contents.reload).not.toHaveBeenCalled();
  probe.mockImplementation(() => { throw Object.assign(new Error("missing"), { code: "ESRCH" }); });
  vi.advanceTimersByTime(1000);
  expect(contents.reload).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  expect(reasons).toEqual(["dead-pid"]);
  expect(replaceWindow).toHaveBeenCalledTimes(1);
  expect(disconnected).toHaveBeenCalledTimes(1);
  contents.emit("render-process-gone", {}, { reason: "killed" });
  vi.advanceTimersByTime(5000);
  expect(contents.reload).not.toHaveBeenCalled();
  window.emit("closed");
  expect(vi.getTimerCount()).toBe(0);
  const nextContents = Object.assign(new EventEmitter(), {
    getOSProcessId: () => 123457, isDestroyed: () => false,
    isLoadingMainFrame: () => false, reload: vi.fn(),
  });
  const nextWindow = Object.assign(new EventEmitter(), { webContents: nextContents, isDestroyed: () => false });
  installRendererRecovery(nextWindow as unknown as BrowserWindow, vi.fn(), disconnected);
  nextContents.emit("render-process-gone", {}, { reason: "killed" });
  expect(nextContents.reload).toHaveBeenCalledTimes(1);
  nextContents.emit("did-finish-load");
  nextContents.emit("render-process-gone", {}, { reason: "killed" });
  vi.advanceTimersByTime(5000);
  expect(nextContents.reload).toHaveBeenCalledTimes(1);
  nextWindow.emit("closed");
  expect(disconnected).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
  expect(probe.mock.calls.every(([, signal]) => signal === 0)).toBe(true);
});
