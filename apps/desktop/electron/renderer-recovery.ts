import type { BrowserWindow } from "electron";

let crashWindowStart = 0;
let crashesInWindow = 0;

/** Recover a dead renderer even when Chromium misses render-process-gone. */
export function installRendererRecovery(window: BrowserWindow, replaceWindow: () => void): void {
  const contents = window.webContents;
  let pending = false;
  let missingPid = 0;
  const recover = (reason: string) => {
    if (window.isDestroyed() || pending) return;
    const now = Date.now();
    if (now - crashWindowStart > 60_000) {
      crashWindowStart = now;
      crashesInWindow = 0;
    }
    if (++crashesInWindow > 2) {
      console.error("[main] renderer crashed repeatedly; reload stopped");
      clearInterval(timer);
      return;
    }
    pending = true;
    console.error(`[main] renderer unavailable (${reason}); reloading`);
    contents.emit("kreoda-renderer-recovery", { reason, rendererPid: contents.getOSProcessId() });
    // A missed native exit leaves Chromium's old process host unusable: reload
    // alone hangs. A new BrowserWindow owns a fresh host, with the same core.
    if (reason === "dead-pid") replaceWindow();
    else contents.reload();
  };
  contents.on("did-finish-load", () => { pending = false; missingPid = 0; });
  contents.on("render-process-gone", (_event, details) => {
    if (details.reason !== "clean-exit") recover(details.reason);
  });
  const timer = setInterval(() => {
    if (window.isDestroyed() || contents.isDestroyed() || pending || contents.isLoadingMainFrame()) {
      missingPid = 0;
      return;
    }
    const pid = contents.getOSProcessId();
    if (pid <= 0 || pid === process.pid) { missingPid = 0; return; }
    try {
      process.kill(pid, 0); // Probe only; never terminate the renderer.
      missingPid = 0;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") { missingPid = 0; return; }
      // Two consecutive observations avoid reacting to a navigation transition.
      if (missingPid === pid) recover("dead-pid");
      else missingPid = pid;
    }
  }, 1000);
  timer.unref();
  window.once("closed", () => clearInterval(timer));
}
