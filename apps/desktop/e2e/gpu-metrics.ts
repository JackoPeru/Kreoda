import type { ElectronApplication, Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";

interface GpuSample {
  adapter: number;
  vendorId: number;
  deviceId: number;
  software: boolean;
  segmentGroup: "local" | "nonlocal";
  status: number;
  usageBytes: number | null;
  budgetBytes: number | null;
}

export async function gpuMemory(app: ElectronApplication) {
  const pids = await app.evaluate(({ app }) =>
    app.getAppMetrics().filter(row => row.type === "GPU").map(row => row.pid),
  );
  const executable = path.resolve(import.meta.dirname,
    "../../../native/diagnostics/gpu-memory/build/Release/kreoda-gpu-memory.exe");
  const processes = pids.map(pid => {
    const row = JSON.parse(execFileSync(executable, [String(pid)], {
      encoding: "utf8", windowsHide: true,
    })) as { pid: number; samples: GpuSample[] };
    if (row.pid !== pid) throw new Error("GPU probe PID mismatch");
    return row;
  });
  return { available: processes.some(row => row.samples.some(sample => sample.status >= 0)), processes };
}

/** Queue completion after prior viewport GL commands; excludes compositor/presentation. */
export async function gpuCompletion(window: Page) {
  return window.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="viewport"] canvas');
    const gl = canvas?.getContext("webgl2");
    if (!gl || gl.isContextLost()) throw new Error("Viewport WebGL2 context unavailable");
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    const started = performance.now();
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) throw new Error("GPU fence creation failed");
    try {
      gl.flush();
      // WebGL syncs may signal only after returning to the browser event loop.
      for (;;) {
        await new Promise(resolve => setTimeout(resolve, 1));
        const status = gl.clientWaitSync(fence, 0, 0);
        if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
          return { renderer, queueCompletionMs: performance.now() - started };
        }
        if (status === gl.WAIT_FAILED || performance.now() - started >= 10_000) {
          throw new Error("GPU command completion failed or exceeded 10 seconds");
        }
      }
    } finally { gl.deleteSync(fence); }
  });
}
