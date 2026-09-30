import type { ElectronApplication } from "@playwright/test";

type FrameSample = {
  started: number;
  times: number[];
  visible: boolean;
  offscreen: boolean;
  frameRateCap: number | null;
};
type SampledWindow = Electron.BrowserWindow & { phase10Frames?: FrameSample };

/** Electron presentation callbacks, with capture overhead; not monitor scanout. */
export async function beginPresentationSample(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0] as SampledWindow;
    if (win.phase10Frames) throw new Error("Presentation sample already active");
    const sample: FrameSample = {
      started: performance.now(), times: [], visible: win.isVisible(),
      offscreen: win.webContents.isOffscreen(),
      frameRateCap: win.webContents.isOffscreen() ? win.webContents.getFrameRate() : null,
    };
    win.phase10Frames = sample;
    win.webContents.beginFrameSubscription(true, () => sample.times.push(performance.now()));
  });
}

export async function endPresentationSample(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0] as SampledWindow;
    win.webContents.endFrameSubscription();
    const sample = win.phase10Frames;
    delete win.phase10Frames;
    if (!sample || sample.times.length < 2) throw new Error("No presentation frame cadence observed");
    const elapsedMs = performance.now() - sample.started;
    const intervals = sample.times.slice(1).map((time, i) => time - sample.times[i]!).sort((a, b) => a - b);
    return {
      source: "electron.beginFrameSubscription", scope: "whole-window capture during orbit/zoom",
      includesCaptureOverhead: true, monitorScanoutMeasured: false,
      visible: sample.visible, offscreen: sample.offscreen, frameRateCap: sample.frameRateCap,
      frames: sample.times.length, elapsedMs, captureFps: sample.times.length * 1000 / elapsedMs,
      firstCaptureMs: sample.times[0]! - sample.started,
      medianIntervalMs: intervals[Math.floor(intervals.length / 2)],
      p95IntervalMs: intervals[Math.ceil(intervals.length * 0.95) - 1],
    };
  });
}
