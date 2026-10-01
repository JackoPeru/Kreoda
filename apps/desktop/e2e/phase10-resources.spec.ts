// Bounded hosted-Windows viewport session for Phase 10 §10.6. Resource values
// are recorded for review; this test intentionally has no memory ceiling.
import { test, expect, _electron as electron } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, runBar, snapOf, type Snapshot } from "./helpers";
import type { ViewportRenderStats } from "../src/viewport/viewportHandle";
import { gpuMemory, gpuCompletion } from "./gpu-metrics";
import { beginPresentationSample, endPresentationSample } from "./presentation-metrics";
import { CommandType, decodeMeshFrame, frameMessage, PROTOCOL_VERSION } from "@kreoda/protocol";

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

let fixtureRequest = 0;
async function fixtureCommand(window: Awaited<ReturnType<typeof boot>>["window"], type: number, fields: Record<string, unknown>) {
  const requestId = `baseline-${++fixtureRequest}`;
  const bytes = frameMessage(new TextEncoder().encode(JSON.stringify({
    protocolVersion: PROTOCOL_VERSION, requestId, documentId: "phase10-baseline", type, ...fields,
  })));
  const reply = await window.evaluate(encoded => globalThis.window.kreoda.invoke(encoded), Buffer.from(bytes).toString("base64"));
  if (type === CommandType.RequestMesh) {
    const mesh = decodeMeshFrame(Buffer.from(reply, "base64"));
    expect(mesh.faces.every(face => face.persistentFaceId.startsWith(`${fields.featureId}:`))).toBe(true);
    expect(mesh.indices.length).toBeGreaterThan(0);
    return mesh;
  }
  const result = JSON.parse(Buffer.from(reply, "base64").toString("utf8")) as { status: string; requestId: string };
  expect(result.requestId).toBe(requestId);
  expect(result.status).toBe("ok");
}

// Reuse the native §10.7 fixtures through the existing framed preload API;
// fixture creation is preparation, while the measured load is the real UI path.
for (const scenario of ["high-feature-41", "many-body-128", "large-step-1024"] as const) {
  test(`project viewport baseline: ${scenario}`, async () => {
    test.skip(process.platform !== "win32", "resource sampling uses Windows process metrics");
    test.setTimeout(600_000);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kreoda-project-baseline-"));
    const project = path.join(directory, "project.icad");
    const step = path.join(directory, "project.step");
    let session: Awaited<ReturnType<typeof boot>> | undefined;
    try {
      session = await boot();
      const { app, window } = session;
      await fixtureCommand(window, CommandType.CreateDocument, {});
      const highFeatures = scenario === "high-feature-41";
      const count = highFeatures ? 1 : scenario === "many-body-128" ? 128 : 1024;
      const featureCount = highFeatures ? 41 : count;
      let expectedVolume = 0;
      for (let i = 0; i < count; ++i) {
        const widthMm = highFeatures ? 500 : 10 + i * 0.125;
        const heightMm = highFeatures ? 400 : 10 + (i % 7) * 0.25;
        const depthMm = highFeatures ? 20 : 10 + (i % 5) * 0.5;
        await fixtureCommand(window, CommandType.CreateBox, { featureId: `baseline-box-${i}`, widthMm, heightMm, depthMm });
        expectedVolume += widthMm * heightMm * depthMm;
      }
      if (highFeatures) {
        let targetId = "baseline-box-0";
        for (let i = 0; i < 40; ++i) {
          const featureId = `baseline-hole-${i}`;
          await fixtureCommand(window, CommandType.CreateHole, { featureId, targetId, faceRole: "box.+Z",
            xMm: 40 + (i % 8) * 55, yMm: 40 + Math.floor(i / 8) * 65, diameterMm: 7, depthMode: "throughAll", depthMm: 0 });
          targetId = featureId;
        }
        expectedVolume -= 40 * Math.PI * 3.5 ** 2 * 20;
      }
      await fixtureCommand(window, CommandType.SaveDocument, { path: project });
      if (scenario === "large-step-1024") {
        await fixtureCommand(window, CommandType.SaveDocument, { path: step });
        expect(fs.statSync(step).size).toBeGreaterThan(10 * 1024 * 1024);
      }
      const input = scenario === "large-step-1024" ? step : project;
      const inputBytes = fs.statSync(input).size;
      const started = Date.now();
      const loaded = await window.evaluate(file => (window as unknown as { __kreoda_test: {
        openIcad: (p: string) => Promise<Snapshot>;
      } }).__kreoda_test.openIcad(file), input);
      const loadAndUiSyncMs = Date.now() - started;
      expect(loaded.bodies).toHaveLength(featureCount);
      expect(loaded.treeBodies).toHaveLength(count);
      const volume = (snapshot: Snapshot) => snapshot.bodies.filter(body => snapshot.tips!.includes(body.id))
        .reduce((sum, body) => sum + body.volumeMm3, 0);
      expect(Math.abs(volume(loaded) - expectedVolume)).toBeLessThan(1);
      await expect.poll(async () => window.evaluate(() =>
        (window as unknown as { __kreoda_test: { viewportRenderStats: () => ViewportRenderStats | null } })
          .__kreoda_test.viewportRenderStats()?.triangles ?? 0)).toBeGreaterThan(0);
      // First nonzero CAD draw after all meshes are synchronized, then a GPU
      // fence; this does not require every tip to be inside the camera frustum.
      const loadGpuCompletion = await gpuCompletion(window);
      const loadToGpuReadyMs = Date.now() - started;
      const core = await window.evaluate(() => globalThis.window.kreoda.coreInfo());
      expect(core.pid).toBeGreaterThan(0);
      const pids = await app.evaluate(({ BrowserWindow }) => ({ main: process.pid,
        renderer: BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId() }));
      const resources = windowsProcessSnapshot([{ role: "main", pid: pids.main },
        { role: "renderer", pid: pids.renderer }, { role: "native", pid: core.pid! }]);
      const memory = await gpuMemory(app);
      const meshStarted = Date.now();
      let lod2Triangles = 0;
      for (const featureId of loaded.tips!) {
        const mesh = await fixtureCommand(window, CommandType.RequestMesh, { featureId, lod: 2 });
        lod2Triangles += mesh!.indices.length / 3;
      }
      const lod2MeshRpcDecodeTotalMs = Date.now() - meshStarted;
      const canvas = window.getByTestId("viewport").locator("canvas");
      await canvas.press("Home");
      const bounds = (await canvas.boundingBox())!;
      const x = bounds.x + bounds.width * 0.08, y = bounds.y + bounds.height * 0.5;
      const viewDirection = () => window.evaluate(() =>
        (window as unknown as { __kreoda_test: { viewDir: () => number[] } }).__kreoda_test.viewDir());
      const beforeOrbit = await viewDirection();
      await beginPresentationSample(app);
      for (let i = 0; i < 20; ++i) {
        await window.mouse.move(x, y);
        await window.mouse.down();
        await window.mouse.move(x + 12, y + 6, { steps: 3 });
        await window.mouse.up();
        await window.mouse.wheel(0, i % 2 ? -30 : 30);
      }
      const presentation = await endPresentationSample(app);
      expect(await viewDirection()).not.toEqual(beforeOrbit);
      expect(geometry(await snapOf(window))).toEqual(geometry(loaded));
      const selectStarted = Date.now();
      await window.mouse.click(bounds.x + bounds.width * 0.5, y);
      await expect.poll(async () => (await snapOf(window)).selectedIds.some(id =>
        loaded.tips!.some(tip => id.startsWith(`${tip}:`)))).toBe(true);
      await expect(window.getByTestId("context-toolbar")).toBeVisible();
      const selectionToToolbarMs = Date.now() - selectStarted;
      let recomputeAndUiSyncMs: number | null = null;
      // STEP solids are imported geometry, without an authored width parameter.
      if (scenario !== "large-step-1024") {
        const recomputeStarted = Date.now();
        const changed = await window.evaluate(({ id, width }) => (window as unknown as { __kreoda_test: {
          setParam: (id: string, name: string, value: number) => Promise<Snapshot>;
        } }).__kreoda_test.setParam(id, "widthMm", width), { id: "baseline-box-0", width: highFeatures ? 520 : 10.25 });
        recomputeAndUiSyncMs = Date.now() - recomputeStarted;
        expect(changed.bodies).toHaveLength(featureCount);
        expect(Math.abs(volume(changed) - expectedVolume - (highFeatures ? 160000 : 25))).toBeLessThan(1);
      }
      const saveStarted = Date.now();
      await window.evaluate(file => (window as unknown as { __kreoda_test: {
        saveIcad: (p: string) => Promise<Snapshot>;
      } }).__kreoda_test.saveIcad(file), project);
      const saveMs = Date.now() - saveStarted;
      expect((await window.evaluate(() => globalThis.window.kreoda.coreInfo())).pid).toBe(core.pid);
      console.log(`PHASE10_PROJECT_VIEWPORT ${JSON.stringify({ scenario, body_count: count, feature_count: featureCount,
        input_bytes: inputBytes, load_and_ui_sync_ms: loadAndUiSyncMs, load_to_gpu_ready_ms: loadToGpuReadyMs,
        lod2_mesh_rpc_decode_total_ms: lod2MeshRpcDecodeTotalMs, lod2_triangles: lod2Triangles,
        lod2_meshes_measured: count, viewport_lod: 1,
        presentation, pick_to_toolbar_ms: selectionToToolbarMs,
        recompute_and_ui_sync_ms: recomputeAndUiSyncMs,
        recompute_unavailable_reason: scenario === "large-step-1024" ? "Imported STEP solids have no authored width parameter" : null,
        save_icad_ms: saveMs, icad_bytes: fs.statSync(project).size, resources, memory, loadGpuCompletion })}`);
    } finally {
      try {
        await session?.app.close();
      } finally {
        removeBenchmarkDirectory(directory);
      }
    }
  });
}

// Only directories returned by mkdtemp for this test are passed here.
function removeBenchmarkDirectory(directory: string) {
  if (path.dirname(path.resolve(directory)).toLowerCase() !== path.resolve(os.tmpdir()).toLowerCase()) {
    throw new Error("Unexpected benchmark cleanup directory");
  }
  fs.rmSync(directory, { recursive: true, force: true });
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

for (const [radius, minimumTriangles] of [[200, 100_000], [600, 500_000], [1100, 1_000_000]] as const) {
  test(`large viewport: ${minimumTriangles} real OCCT triangles, orbit, zoom and picking`, async () => {
    test.skip(process.platform !== "win32", "resource sampling uses Windows process metrics");
    test.setTimeout(600_000);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kreoda-mesh-baseline-"));
    const project = path.join(directory, "project.icad");
    let session: Awaited<ReturnType<typeof boot>> | undefined;
    try {
      session = await boot();
      const { app, window } = session;
      const stats = () => window.evaluate(() =>
        (globalThis.window as unknown as { __kreoda_test: { viewportRenderStats: () => ViewportRenderStats | null } }).__kreoda_test.viewportRenderStats(),
      );
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
      let detailed = await window.evaluate((featureId) =>
        (globalThis.window as unknown as { __kreoda_test: { loadDetailedMesh: (id: string) => Promise<Snapshot> } }).__kreoda_test.loadDetailedMesh(featureId), id,
      );
      expect(detailed.bodies[0]!.triangles).toBeGreaterThanOrEqual(minimumTriangles);
      expect(detailed.bodies[0]!.volumeMm3).toBeCloseTo(4 / 3 * Math.PI * radius ** 3, 2);
      // Renderer counts submitted primitives, including culled triangles.
      await expect.poll(async () => (await stats())?.triangles ?? 0, { timeout: 30_000 }).toBeGreaterThanOrEqual(minimumTriangles);
      const meshRpcToRendererSubmissionMs = Date.now() - meshStarted;
      const afterMeshGpuCompletion = await gpuCompletion(window);
      const afterMeshGpuMemory = await gpuMemory(app);
      // Same workload through the actual persistence/parameter paths. Values
      // include IPC and UI synchronization; they are not native-only timings.
      const saveStarted = Date.now();
      await window.evaluate(file => (window as unknown as { __kreoda_test: {
        saveIcad: (p: string) => Promise<Snapshot>;
      } }).__kreoda_test.saveIcad(file), project);
      const saveMs = Date.now() - saveStarted;
      const projectBytes = fs.statSync(project).size;
      expect(projectBytes).toBeGreaterThan(0);
      const recomputeStarted = Date.now();
      const changed = await window.evaluate(({ id, radius }) => (window as unknown as { __kreoda_test: {
        setParam: (id: string, name: string, value: number) => Promise<Snapshot>;
      } }).__kreoda_test.setParam(id, "radiusMm", radius * 1.05), { id, radius });
      const recomputeAndUiSyncMs = Date.now() - recomputeStarted;
      expect(changed.bodies[0]!.volumeMm3).toBeCloseTo(4 / 3 * Math.PI * (radius * 1.05) ** 3, 2);
      const loadStarted = Date.now();
      const reopened = await window.evaluate(file => (window as unknown as { __kreoda_test: {
        openIcad: (p: string) => Promise<Snapshot>;
      } }).__kreoda_test.openIcad(file), project);
      const openAndLod1UiSyncMs = Date.now() - loadStarted;
      expect(reopened.bodies).toHaveLength(1);
      expect(reopened.bodies[0]!.id).toBe(id);
      expect(reopened.bodies[0]!.volumeMm3).toBeCloseTo(4 / 3 * Math.PI * radius ** 3, 2);
      detailed = await window.evaluate(featureId => (window as unknown as { __kreoda_test: {
        loadDetailedMesh: (id: string) => Promise<Snapshot>;
      } }).__kreoda_test.loadDetailedMesh(featureId), id);
      await expect.poll(async () => (await stats())?.triangles ?? 0, { timeout: 30_000 }).toBeGreaterThanOrEqual(minimumTriangles);
      await gpuCompletion(window);
      // Actual submitted viewport GL work completed, followed by input below;
      // this milestone still excludes monitor scanout/compositor latency.
      const openToDetailedGpuReadyMs = Date.now() - loadStarted;
      const canvas = window.getByTestId("viewport").locator("canvas");
      await canvas.press("Home");
      const bounds = (await canvas.boundingBox())!;
      const x = bounds.x + bounds.width * 0.5;
      const y = bounds.y + bounds.height * 0.5;
      await window.mouse.move(x, y);
      await window.mouse.wheel(0, 2000); // Move outside the 1100 mm sphere.
      await window.waitForTimeout(200);
      const first = (await stats())!;
      const viewDirection = () => window.evaluate(() =>
        (window as unknown as { __kreoda_test: { viewDir: () => number[] } }).__kreoda_test.viewDir());
      const beforeOrbit = await viewDirection();
      const orbitX = bounds.x + bounds.width * 0.08; // Drag background, not a body handle.
      const interactionStarted = Date.now();
      await beginPresentationSample(app);
      const cycles = 20;
      for (let i = 0; i < cycles; ++i) {
        await window.mouse.move(orbitX, y);
        await window.mouse.down();
        await window.mouse.move(orbitX + 12, y + 6, { steps: 3 });
        await window.mouse.up();
        await window.mouse.wheel(0, i % 2 ? -30 : 30);
      }
      await expect.poll(async () => (await stats())?.renderedFrames ?? 0).toBeGreaterThan(first.renderedFrames);
      const interactionMs = Date.now() - interactionStarted;
      const presentation = await endPresentationSample(app);
      const last = (await stats())!;
      expect(await viewDirection()).not.toEqual(beforeOrbit);
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
        save_icad_ms: saveMs, icad_bytes: projectBytes, recompute_and_ui_sync_ms: recomputeAndUiSyncMs,
        open_and_lod1_ui_sync_ms: openAndLod1UiSyncMs, open_to_detailed_gpu_ready_ms: openToDetailedGpuReadyMs,
        presentation,
        renderer_submissions_per_second_during_input: (last.renderedFrames - first.renderedFrames) * 1000 / interactionMs,
        render_cpu_ms_during_input: last.renderCpuTotalMs - first.renderCpuTotalMs, pick_to_toolbar_ms: pickToToolbarMs,
        first, last, before_mesh: beforeMesh, final,
        beforeGpuMemory, afterMeshGpuMemory, finalGpuMemory, afterMeshGpuCompletion, finalGpuCompletion,
        // GPU budget usage and GL queue completion still exclude displayed FPS.
      })}`);
    } finally {
      try {
        await session?.app.close();
      } finally {
        removeBenchmarkDirectory(directory);
      }
    }
  });
}
