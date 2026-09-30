// Bounded hosted-Windows viewport session for Phase 10 §10.6. Resource values
// are recorded for review; this test intentionally has no memory ceiling.
import { test, expect, _electron as electron } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { boot, runBar, snapOf, type Snapshot } from "./helpers";
import type { ViewportRenderStats } from "../src/viewport/viewportHandle";
import { gpuMemory, gpuCompletion } from "./gpu-metrics";
import { beginPresentationSample, endPresentationSample } from "./presentation-metrics";

type Role = "main" | "renderer" | "native";
type Target = { role: Role; pid: number };
type ProcessMetric = Target & {
  processName: string;
  workingSetBytes: number;
  privateBytes: number;
  handleCount: number;
};
type ProcessSnapshot = { processes: ProcessMetric[]; sidecarPids: number[] };

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function windowsProcessSnapshot(targets: Target[]): ProcessSnapshot {
  const targetList = targets
    .map((target) => `[pscustomobject]@{role='${target.role}';pid=${target.pid}}`)
    .join(",");
  const script = `
$targets = @(${targetList})
$rows = foreach ($target in $targets) {
  $process = Get-Process -Id $target.pid -ErrorAction SilentlyContinue
  if ($null -ne $process) {
    [pscustomobject]@{
      role = $target.role
      pid = $process.Id
      processName = $process.ProcessName
      workingSetBytes = [long]$process.WorkingSet64
      privateBytes = [long]$process.PrivateMemorySize64
      handleCount = [int]$process.HandleCount
    }
  }
}
$sidecars = @(Get-Process -Name 'kreoda-core' -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
[pscustomobject]@{processes=@($rows);sidecarPids=$sidecars} | ConvertTo-Json -Compress -Depth 4
`;
  const output = execFileSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", windowsHide: true },
  ).trim();
  const parsed = JSON.parse(output) as {
    processes?: ProcessMetric | ProcessMetric[] | null;
    sidecarPids?: number | number[] | null;
  };
  return {
    processes: asArray(parsed.processes),
    sidecarPids: asArray(parsed.sidecarPids),
  };
}

function geometry(snapshot: Snapshot) {
  return {
    revision: snapshot.revision,
    bodies: snapshot.bodies,
    sketches: snapshot.sketches,
    tips: snapshot.tips,
  };
}

test("resource sample: 21-body orbit and zoom session", async () => {
  test.skip(process.platform !== "win32", "resource sampling uses Windows process metrics");
  test.setTimeout(300_000);

  const baselineSidecars = windowsProcessSnapshot([]).sidecarPids.sort((a, b) => a - b);
  const bootStarted = Date.now();
  const { app, window } = await boot();
  try {
    const canvas = window.getByTestId("viewport").locator("canvas");
    await expect(canvas).toHaveCount(1);
    await expect(canvas).toBeVisible();
    // Canvas visibility is a stable DOM milestone, not a GPU-presented frame.
    const canvasVisibleMs = Date.now() - bootStarted;

    await runBar(window, "box 100 60 10");
    for (let i = 0; i < 20; i++) await runBar(window, "box 10 10 10");

    const initialModel = await snapOf(window);
    expect(initialModel.bodies).toHaveLength(21);
    expect(initialModel.bodies[0]!.volumeMm3).toBeCloseTo(60000, 3);
    expect(initialModel.bodies.slice(1).every((body) => body.type === "Box")).toBe(true);
    expect(initialModel.bodies.slice(1).every((body) => Math.abs(body.volumeMm3 - 1000) < 1e-3)).toBe(true);
    expect(initialModel.sketches).toHaveLength(0);

    const core = await window.evaluate(() => globalThis.window.kreoda.coreInfo());
    await expect(window.getByText(/core 0\.1\.0(?!-stub)/i)).toBeVisible();
    if (core.pid === undefined || core.pid <= 0) {
      throw new Error("geometry sidecar PID is unavailable");
    }
    const corePid = core.pid;
    const pids = await app.evaluate(({ BrowserWindow }) => ({
      main: process.pid,
      renderer: BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId(),
    }));
    const targets: Target[] = [
      { role: "main", pid: pids.main },
      { role: "renderer", pid: pids.renderer },
      { role: "native", pid: corePid },
    ];
    const first = windowsProcessSnapshot(targets);
    const firstGpuMemory = await gpuMemory(app);
    expect(first.processes.map((metric) => metric.role).sort()).toEqual([
      "main",
      "native",
      "renderer",
    ]);
    expect(first.processes.find((metric) => metric.role === "native")!.processName).toMatch(
      /^kreoda-core$/i,
    );
    expect(
      first.sidecarPids.filter((pid) => !baselineSidecars.includes(pid)).sort((a, b) => a - b),
    ).toEqual([corePid]);

    const bounds = (await canvas.boundingBox())!;
    const x = bounds.x + bounds.width * 0.08;
    const y = bounds.y + bounds.height * 0.5;
    const viewportState = await window.evaluate(() =>
      (globalThis.window as unknown as { __kreoda_test: { viewDir: () => number[] } })
        .__kreoda_test.viewDir(),
    );

    const cycles = 80;
    await beginPresentationSample(app);
    let orbitZoomActionMs = 0;
    for (let i = 0; i < cycles; i++) {
      const actionStarted = Date.now();
      await window.mouse.move(x, y);
      await window.mouse.down();
      await window.mouse.move(x + 18, y + 10, { steps: 3 });
      await window.mouse.up();
      await window.mouse.wheel(0, i % 2 === 0 ? 60 : -60);
      orbitZoomActionMs += Date.now() - actionStarted;
      if ((i + 1) % 20 === 0) {
        const liveSidecars = windowsProcessSnapshot([]).sidecarPids
          .filter((pid) => !baselineSidecars.includes(pid))
          .sort((a, b) => a - b);
        expect(liveSidecars).toEqual([corePid]);
      }
    }
    await window.waitForTimeout(500);
    const presentation = await endPresentationSample(app);

    const finalModel = await snapOf(window);
    expect(geometry(finalModel)).toEqual(geometry(initialModel));
    const finalViewDir = await window.evaluate(() =>
      (globalThis.window as unknown as { __kreoda_test: { viewDir: () => number[] } })
        .__kreoda_test.viewDir(),
    );
    expect(finalViewDir).not.toEqual(viewportState);

    const selectionStarted = Date.now();
    await window.evaluate(
      ({ id }) =>
        (
          globalThis.window as unknown as {
            __kreoda_test: {
              selectFace: (featureId: string, role: string) => unknown;
            };
          }
        ).__kreoda_test.selectFace(id, "box.+Z"),
      { id: initialModel.bodies[0]!.id },
    );
    await expect(
      window
        .getByTestId("context-toolbar")
        .getByRole("button", { name: "Hole" }),
    ).toBeVisible();
    const selectionToolbarMs = Date.now() - selectionStarted;

    const final = windowsProcessSnapshot(targets);
    const finalGpuMemory = await gpuMemory(app);
    const finalGpuCompletion = await gpuCompletion(window);
    expect(final.processes.map((metric) => metric.role).sort()).toEqual([
      "main",
      "native",
      "renderer",
    ]);
    expect(final.sidecarPids.filter((pid) => !baselineSidecars.includes(pid))).toEqual([
      corePid,
    ]);
    const finalByRole = new Map(final.processes.map((metric) => [metric.role, metric]));
    const deltas = first.processes.map((before) => {
      const after = finalByRole.get(before.role)!;
      expect(after.pid).toBe(before.pid);
      return {
        role: before.role,
        workingSetDeltaBytes: after.workingSetBytes - before.workingSetBytes,
        privateBytesDelta: after.privateBytes - before.privateBytes,
        handleCountDelta: after.handleCount - before.handleCount,
      };
    });
    console.log(
      `PHASE10_RESOURCES ${JSON.stringify({
        startup_to_canvas_visible_ms: canvasVisibleMs,
        orbit_zoom_action_ms_total: orbitZoomActionMs,
        orbit_zoom_cycles: cycles,
        presentation,
        testhook_face_selection_to_context_toolbar_ms: selectionToolbarMs,
        firstGpuMemory, finalGpuMemory, finalGpuCompletion,
        first,
        final,
        deltas,
      })}`,
    );
  } finally {
    await app.close();
  }

  const spawnedSidecars = () =>
    windowsProcessSnapshot([]).sidecarPids
      .filter((pid) => !baselineSidecars.includes(pid))
      .sort((a, b) => a - b);
  await expect
    .poll(spawnedSidecars, { timeout: 20_000 })
    .toEqual([]);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  expect(spawnedSidecars()).toEqual([]);
});

for (const [radius, minimumTriangles] of [[600, 500_000], [1100, 1_000_000]] as const) {
  test(`large viewport: ${minimumTriangles} real OCCT triangles, orbit, zoom and picking`, async () => {
    test.skip(process.platform !== "win32", "resource sampling uses Windows process metrics");
    test.setTimeout(600_000);
    const { app, window } = await boot();
    const stats = () => window.evaluate(() =>
      (globalThis.window as unknown as { __kreoda_test: { viewportRenderStats: () => ViewportRenderStats | null } }).__kreoda_test.viewportRenderStats(),
    );
    try {
      await runBar(window, `sphere ${radius}`);
      const initial = await snapOf(window);
      expect(initial.bodies).toHaveLength(1);
      const id = initial.bodies[0]!.id;
      const core = await window.evaluate(() => globalThis.window.kreoda.coreInfo());
      expect(core.pid).toBeGreaterThan(0);
      const pids = await app.evaluate(({ BrowserWindow }) => ({ main: process.pid, renderer: BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId() }));
      const targets: Target[] = [{ role: "main", pid: pids.main }, { role: "renderer", pid: pids.renderer }, { role: "native", pid: core.pid! }];
      const beforeMesh = windowsProcessSnapshot(targets);
      const beforeGpuMemory = await gpuMemory(app);
      const meshStarted = Date.now();
      const detailed = await window.evaluate((featureId) =>
        (globalThis.window as unknown as { __kreoda_test: { loadDetailedMesh: (id: string) => Promise<Snapshot> } }).__kreoda_test.loadDetailedMesh(featureId), id,
      );
      expect(detailed.bodies[0]!.triangles).toBeGreaterThanOrEqual(minimumTriangles);
      expect(detailed.bodies[0]!.volumeMm3).toBeCloseTo(4 / 3 * Math.PI * radius ** 3, 2);
      // Renderer counts submitted primitives, including culled triangles.
      await expect.poll(async () => (await stats())?.triangles ?? 0, { timeout: 30_000 }).toBeGreaterThanOrEqual(minimumTriangles);
      const meshRpcToRendererSubmissionMs = Date.now() - meshStarted;
      const afterMeshGpuCompletion = await gpuCompletion(window);
      const afterMeshGpuMemory = await gpuMemory(app);
      const canvas = window.getByTestId("viewport").locator("canvas");
      await canvas.press("Home");
      const bounds = (await canvas.boundingBox())!;
      const x = bounds.x + bounds.width * 0.5;
      const y = bounds.y + bounds.height * 0.5;
      await window.mouse.move(x, y);
      await window.mouse.wheel(0, 2000); // Move outside the 1100 mm sphere.
      await window.waitForTimeout(200);
      const first = (await stats())!;
      const interactionStarted = Date.now();
      await beginPresentationSample(app);
      const cycles = 20;
      for (let i = 0; i < cycles; ++i) {
        await window.mouse.move(x, y);
        await window.mouse.down();
        await window.mouse.move(x + 12, y + 6, { steps: 3 });
        await window.mouse.up();
        await window.mouse.wheel(0, i % 2 ? -30 : 30);
      }
      await expect.poll(async () => (await stats())?.renderedFrames ?? 0).toBeGreaterThan(first.renderedFrames);
      const interactionMs = Date.now() - interactionStarted;
      const presentation = await endPresentationSample(app);
      const last = (await stats())!;
      const selectionStarted = Date.now();
      await window.mouse.click(x, y);
      await expect.poll(async () => (await snapOf(window)).selectedIds.some(face => face.startsWith(`${id}:`)), { timeout: 10_000 }).toBe(true);
      await expect(window.getByTestId("context-toolbar")).toBeVisible();
      const pickToToolbarMs = Date.now() - selectionStarted;
      expect(geometry(await snapOf(window))).toEqual(geometry(detailed));
      expect((await window.evaluate(() => globalThis.window.kreoda.coreInfo())).pid).toBe(core.pid);
      const final = windowsProcessSnapshot(targets);
      const finalGpuMemory = await gpuMemory(app);
      const finalGpuCompletion = await gpuCompletion(window);
      expect(final.processes.map(row => row.role).sort()).toEqual(["main", "native", "renderer"]);
      console.log(`PHASE10_LARGE_VIEWPORT ${JSON.stringify({ radius_mm: radius, triangles: detailed.bodies[0]!.triangles,
        mesh_rpc_to_renderer_submission_ms: meshRpcToRendererSubmissionMs, interaction_ms: interactionMs, orbit_zoom_cycles: cycles,
        presentation,
        renderer_submissions_per_second_during_input: (last.renderedFrames - first.renderedFrames) * 1000 / interactionMs,
        render_cpu_ms_during_input: last.renderCpuTotalMs - first.renderCpuTotalMs, pick_to_toolbar_ms: pickToToolbarMs,
        first, last, before_mesh: beforeMesh, final,
        beforeGpuMemory, afterMeshGpuMemory, finalGpuMemory, afterMeshGpuCompletion, finalGpuCompletion,
        // GPU budget usage and GL queue completion still exclude displayed FPS.
      })}`);
    } finally {
      await app.close();
    }
  });
}
