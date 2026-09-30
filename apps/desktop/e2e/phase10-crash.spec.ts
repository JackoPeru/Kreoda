// Run alone: these tests terminate Electron or its native child by PID.
import { test, expect, chromium, _electron as electron, type Browser } from "@playwright/test";
import type { SketchModel } from "@kreoda/protocol";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { boot as bootShell, MAIN, openProject, runBar, snapOf, type Snapshot } from "./helpers";

const recoveryDir = path.join(os.tmpdir(), "kreoda-phase10-crash-e2e");
const recoveryFile = path.join(recoveryDir, "autosave.icad");
const explicitSaveFile = path.join(recoveryDir, "recomputed.icad");
const stepFile = path.join(recoveryDir, "import.step");
const barrierDir = path.join(recoveryDir, "barriers");
const env = { ...process.env, KREODA_RECOVERY_DIR: recoveryDir, KREODA_TEST_BARRIER_DIR: barrierDir };
type TestWindow = Awaited<ReturnType<typeof bootShell>>["window"];
const crashTargets = ["renderer", "main", "core"] as const;
type CrashTarget = typeof crashTargets[number];
let debugPort = 0;
const attachedBrowsers: Browser[] = [];

function boot(launchEnv = env) {
  return bootShell(launchEnv, [`--remote-debugging-port=${debugPort}`]);
}

async function sketchModel(window: TestWindow, id: string): Promise<SketchModel> {
  return window.evaluate((featureId) => (window as unknown as {
    __kreoda_test: { sketchModel: (id: string) => Promise<SketchModel> };
  }).__kreoda_test.sketchModel(featureId), id);
}

async function modelAndSave(window: TestWindow) {
  await runBar(window, "box 100 60 10");
  const before = await snapOf(window);
  expect(before.bodies).toHaveLength(1);
  await window.evaluate(() =>
    (globalThis.window as unknown as { __kreoda_test: { autosaveNow: () => Promise<string> } })
      .__kreoda_test.autosaveNow(),
  );
  expect(fs.existsSync(recoveryFile)).toBe(true);
  return before;
}

async function restore(window: TestWindow, before: Snapshot) {
  await expect(window.getByTestId("recovery-banner")).toBeVisible({ timeout: 30000 });
  await window.getByTestId("recovery-restore").click();
  // The live renderer may still show the old summaries during a core restart.
  // Banner dismissal happens only after Open + mesh synchronization succeeds.
  await expect(window.getByTestId("recovery-banner")).toBeHidden({ timeout: 30000 });
  await expect
    .poll(async () => {
      const snapshot = await snapOf(window);
      return [snapshot.bodies.length, snapshot.sketches.length];
    }, { timeout: 30000 })
    .toEqual([before.bodies.length, before.sketches.length]);
  const after = await snapOf(window);
  expect(after.bodies.map(({ id, type }) => ({ id, type }))).toEqual(
    before.bodies.map(({ id, type }) => ({ id, type })),
  );
  for (const [i, body] of before.bodies.entries()) {
    expect(after.bodies[i]!.paramsMm).toHaveLength(body.paramsMm.length);
    for (const [j, value] of body.paramsMm.entries()) {
      expect(after.bodies[i]!.paramsMm[j]).toBeCloseTo(value, 6);
    }
    expect(after.bodies[i]!.volumeMm3).toBeCloseTo(body.volumeMm3, 3);
  }
  expect(after.sketches).toEqual(before.sketches);
}

async function crashRendererAndRestore(
  app: Awaited<ReturnType<typeof electron.launch>>,
  window: TestWindow,
  before: Snapshot,
  releasePointer = false,
) {
  await terminateAndRestore(app, window, before, "renderer", undefined, releasePointer);
}

async function terminateAndRestore(
  app: Awaited<ReturnType<typeof electron.launch>>,
  window: TestWindow,
  before: Snapshot,
  target: CrashTarget,
  release?: () => void,
  releasePointer = false,
) {
  const core = await window.evaluate(() => globalThis.window.kreoda.coreInfo());
  expect(core.pid).toBeGreaterThan(0);
  if (target === "renderer") {
    // Playwright permanently marks a crashed Page/CDP session as unusable.
    // Observe the application's own reload in main, then attach a fresh client
    // to the same recovered WebContents. The test never requests a reload.
    await app.evaluate(({ BrowserWindow }) => new Promise<void>((resolve, reject) => {
      const contents = BrowserWindow.getAllWindows()[0]!.webContents;
      const deadline = setTimeout(() => reject(new Error("renderer recovery did not finish loading")), 30000);
      contents.once("did-finish-load", () => { clearTimeout(deadline); resolve(); });
      contents.forcefullyCrashRenderer();
    }));
    // The surviving core may finish its transaction. Let it finish before
    // opening the persisted recovery document; a renderer kill is not rollback.
    release?.();
    const attached = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    attachedBrowsers.push(attached);
    window = attached.contexts()[0]!.pages()[0]!;
    await expect(window.getByTestId("home-screen")).toBeVisible({ timeout: 30000 });
    if (releasePointer) await window.mouse.up();
    await window.getByTestId("home-new-project").click();
  } else if (target === "main") {
    execFileSync("taskkill", ["/F", "/T", "/PID", String(app.process().pid)], { stdio: "ignore" });
    release?.();
    await app.close().catch(() => {});
    ({ app, window } = await boot(env));
  } else {
    execFileSync("taskkill", ["/F", "/PID", String(core.pid)], { stdio: "ignore" });
    release?.();
    if (releasePointer) {
      await expect(window.getByTestId("sketch-canvas")).toBeHidden({ timeout: 30000 });
      await window.mouse.up();
    }
  }
  await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({ timeout: 60000 });
  await restore(window, before);
  const recoveredCore = await window.evaluate(() => globalThis.window.kreoda.coreInfo());
  if (target === "renderer") expect(recoveredCore.pid).toBe(core.pid);
  else expect(recoveredCore.pid).not.toBe(core.pid);
  return { app, window };
}

test.beforeEach(async () => {
  fs.rmSync(recoveryDir, { recursive: true, force: true });
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  debugPort = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test.afterEach(async () => {
  for (const browser of attachedBrowsers.splice(0)) await browser.close().catch(() => {});
});

test("sidecar kill restores committed autosave [solo]", async () => {
  test.skip(process.platform !== "win32", "taskkill requires Windows");
  const { app, window } = await boot(env);
  try {
    const before = await modelAndSave(window);
    const core = await window.evaluate(() => globalThis.window.kreoda.coreInfo());
    expect(core.pid).toBeGreaterThan(0);
    execFileSync("taskkill", ["/F", "/PID", String(core.pid)], { stdio: "ignore" });
    await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({ timeout: 60000 });
    await restore(window, before);
  } finally {
    await app.close();
  }
});

for (const target of crashTargets) {
test(`${target} kill before atomic save publication keeps a complete project file [solo]`, async () => {
  test.skip(process.platform !== "win32", "taskkill requires Windows");
  test.skip(process.env.KREODA_CRASH_TEST_BARRIERS !== "1", "requires the dedicated crash-test core build");
  let { app, window } = await boot(env);
  const stage = path.join(barrierDir, "save-before-publish");
  try {
    const before = await modelAndSave(window);
    await window.evaluate((file) => (window as unknown as { __kreoda_test: { saveIcad: (p: string) => Promise<Snapshot> } }).__kreoda_test.saveIcad(file), explicitSaveFile);
    const digest = () => createHash("sha256").update(fs.readFileSync(explicitSaveFile)).digest("hex");
    const originalHash = digest();
    const committed = await window.evaluate((id) => (window as unknown as { __kreoda_test: { setParam: (id: string, name: string, value: number) => Promise<Snapshot> } }).__kreoda_test.setParam(id, "widthMm", 140), before.bodies[0]!.id);
    expect(committed.bodies[0]!.paramsMm[0]).toBe(140);
    // Pin the recovery snapshot to the latest commit; the 15 s interval can
    // only write the same revision while the explicit save is interrupted.
    await window.evaluate(() => (globalThis.window as unknown as { __kreoda_test: { autosaveNow: () => Promise<string> } }).__kreoda_test.autosaveNow());
    const core = await window.evaluate(() => globalThis.window.kreoda.coreInfo());
    expect(core.pid).toBeGreaterThan(0);
    fs.mkdirSync(barrierDir, { recursive: true });
    fs.writeFileSync(stage + ".arm", "1");
    let settled = false;
    const pending = window.evaluate((file) => (window as unknown as { __kreoda_test: { saveIcad: (p: string) => Promise<Snapshot> } }).__kreoda_test.saveIcad(file), explicitSaveFile)
      .then(() => { settled = true; return "completed"; }, () => { settled = true; return "interrupted"; });
    await expect.poll(() => fs.existsSync(stage + ".ready"), { timeout: 10000 }).toBe(true);
    expect(settled).toBe(false);
    expect(digest()).toBe(originalHash);
    const temp = fs.readdirSync(recoveryDir).find(name => name.startsWith(`recomputed.icad.tmp-${core.pid}-`));
    expect(temp).toBeTruthy();
    expect(fs.statSync(path.join(recoveryDir, temp!)).size).toBeGreaterThan(0);
    ({ app, window } = await terminateAndRestore(app, window, committed, target,
      () => fs.writeFileSync(stage + ".release", "1")));
    expect(await pending).toBe("interrupted");
    // Core/main termination cannot publish. A surviving native process after
    // renderer termination may atomically publish the complete new document.
    if (target === "renderer") {
      await expect.poll(digest, { timeout: 10000 }).not.toBe(originalHash);
    } else expect(digest()).toBe(originalHash);
    const reopened = await window.evaluate((file) => (window as unknown as { __kreoda_test: { openIcad: (p: string) => Promise<Snapshot> } }).__kreoda_test.openIcad(file), explicitSaveFile);
    const width = target === "renderer" ? 140 : 100;
    expect(reopened.bodies[0]!.paramsMm[0]).toBe(width);
    expect(reopened.bodies[0]!.volumeMm3).toBeCloseTo(width * 60 * 10, 3);
  } finally {
    if (fs.existsSync(barrierDir)) fs.writeFileSync(stage + ".release", "1");
    await app.close();
  }
});
}

test("renderer crash reloads and restores committed autosave [solo]", async () => {
  const { app, window } = await boot(env);
  try {
    const before = await modelAndSave(window);
    await crashRendererAndRestore(app, window, before);
  } finally {
    await app.close();
  }
});

for (const target of crashTargets) {
for (const operation of ["recompute", "step-import", "tessellation-500k", "tessellation-1M"] as const) {
  test(`${target} kill during ${operation} restores the committed autosave [solo]`, async () => {
    test.setTimeout(300000);
    test.skip(process.platform !== "win32", "taskkill requires Windows");
    test.skip(process.env.KREODA_CRASH_TEST_BARRIERS !== "1", "requires the dedicated crash-test core build");
    let { app, window } = await boot(env);
    const stageName = {
      recompute: "recompute-before-commit", "step-import": "step-import-before-adoption",
      "tessellation-500k": "tessellation-inside-mesher", "tessellation-1M": "tessellation-inside-mesher",
    }[operation];
    const stage = path.join(barrierDir, stageName);
    try {
      let before = await modelAndSave(window);
      if (operation === "step-import") {
        await window.evaluate((file) => (window as unknown as { __kreoda_test: { saveIcad: (p: string) => Promise<Snapshot> } }).__kreoda_test.saveIcad(file), stepFile);
        expect(fs.statSync(stepFile).size).toBeGreaterThan(1000);
      }
      if (operation.startsWith("tessellation")) {
        // Same 500k/1M native workloads; pause on partial OCCT progress inside
        // BRepMesh::Perform, before the detailed mesh RPC can return.
        const radius = operation === "tessellation-1M" ? 1100 : 600;
        await runBar(window, `sphere ${radius}`);
        before = await snapOf(window);
        expect(before.bodies.find(b => b.type === "Sphere")!.paramsMm[0]).toBe(radius);
        await window.evaluate(() => (globalThis.window as unknown as { __kreoda_test: { autosaveNow: () => Promise<string> } }).__kreoda_test.autosaveNow());
      }
      const core = await window.evaluate(() => globalThis.window.kreoda.coreInfo());
      expect(core.pid).toBeGreaterThan(0);
      fs.mkdirSync(barrierDir, { recursive: true });
      fs.writeFileSync(stage + ".arm", "1");
      let settled = false;
      const pending = window.evaluate(async ({ kind, box, sphere, file }) => {
        const hook = (globalThis.window as unknown as { __kreoda_test: {
          setParam: (id: string, name: string, value: number) => Promise<Snapshot>;
          openIcad: (file: string) => Promise<Snapshot>;
          loadDetailedMesh: (id: string) => Promise<Snapshot>;
        } }).__kreoda_test;
        if (kind === "recompute") return hook.setParam(box, "widthMm", 140);
        if (kind === "step-import") return hook.openIcad(file);
        return hook.loadDetailedMesh(sphere!);
      }, { kind: operation, box: before.bodies[0]!.id, sphere: before.bodies.find(b => b.type === "Sphere")?.id, file: stepFile })
        .then(() => { settled = true; return "completed"; }, () => { settled = true; return "interrupted"; });
      await expect.poll(() => fs.existsSync(stage + ".ready"), { timeout: 180000 }).toBe(true);
      expect(settled).toBe(false);
      ({ app, window } = await terminateAndRestore(app, window, before, target,
        () => fs.writeFileSync(stage + ".release", "1")));
      expect(await pending).toBe("interrupted");
    } finally {
      if (fs.existsSync(barrierDir)) fs.writeFileSync(stage + ".release", "1");
      await app.close();
    }
  });
}
}

for (const target of crashTargets) {
test(`${target} crash during command preview restores the last committed model [solo]`, async () => {
  test.skip(process.platform !== "win32", "taskkill requires Windows");
  let { app, window } = await boot(env);
  try {
    const before = await modelAndSave(window);
    const input = window.getByTestId("command-input");
    await input.fill("box 20 30 40");
    await input.press("Enter");
    await expect(window.getByTestId("plan-preview")).toBeVisible({ timeout: 5000 });

    // The preview has not called Run, so recovery must contain only the box.
    ({ app, window } = await terminateAndRestore(app, window, before, target));
  } finally {
    await app.close();
  }
});

test(`${target} crash with an uncommitted solved sketch drag restores committed coordinates [solo]`, async () => {
  test.skip(process.platform !== "win32", "taskkill requires Windows");
  let { app, window } = await boot(env);
  try {
    await modelAndSave(window);
    await window.evaluate(() =>
      (
        window as unknown as {
          __kreoda_test: { createRectSketch: (w: number, h: number) => Promise<Snapshot> };
        }
      ).__kreoda_test.createRectSketch(100, 50),
    );
    const before = await snapOf(window);
    const sketch = before.sketches[0]!;
    const committedModel = await sketchModel(window, sketch.id);
    await window.evaluate(() => (globalThis.window as unknown as {
      __kreoda_test: { autosaveNow: () => Promise<string> };
    }).__kreoda_test.autosaveNow());
    await window.evaluate(
      (id) =>
        (
          window as unknown as { __kreoda_test: { openSketch: (id: string) => unknown } }
        ).__kreoda_test.openSketch(id),
      sketch.id,
    );

    const canvas = window.getByTestId("sketch-canvas");
    await expect(canvas).toBeVisible({ timeout: 10000 });
    const point = window.getByTestId("sk-point-p0");
    const label = window.locator("g", { has: point }).locator("text");
    await expect(point).toBeVisible();
    await expect(label).toHaveCount(1);
    const beforeLabel = await label.textContent();
    const bounds = (await point.boundingBox())!;
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await window.mouse.move(x, y);
    await window.mouse.down();
    await window.mouse.move(x + 40, y + 12, { steps: 5 });
    await expect.poll(() => label.textContent(), { timeout: 10000 }).not.toBe(beforeLabel);

    // Keep the pointer down: the solver has a transient edit, not a commit.
    ({ app, window } = await terminateAndRestore(app, window, before, target, undefined, true));
    // Counts alone cannot detect an accidentally committed drag. Read the
    // authoritative native coordinates and constraints after recovery.
    expect(await sketchModel(window, sketch.id)).toEqual(committedModel);
  } finally {
    await app.close();
  }
});

test(`${target} kill inside the native sketch solver restores committed coordinates [solo]`, async () => {
  test.skip(process.platform !== "win32", "taskkill requires Windows");
  test.skip(process.env.KREODA_CRASH_TEST_BARRIERS !== "1", "requires the dedicated crash-test core build");
  let { app, window } = await boot(env);
  const stage = path.join(barrierDir, "sketch-solve-after-jacobian");
  try {
    await modelAndSave(window);
    await window.evaluate(() => (window as unknown as { __kreoda_test: {
      createRectSketch: (w: number, h: number) => Promise<Snapshot>;
    } }).__kreoda_test.createRectSketch(100, 50));
    const before = await snapOf(window);
    const sketch = before.sketches[0]!;
    const committedModel = await sketchModel(window, sketch.id);
    await window.evaluate(() => (window as unknown as { __kreoda_test: {
      autosaveNow: () => Promise<string>;
    } }).__kreoda_test.autosaveNow());
    await window.evaluate(id => (window as unknown as { __kreoda_test: {
      openSketch: (id: string) => unknown;
    } }).__kreoda_test.openSketch(id), sketch.id);
    const point = window.getByTestId("sk-point-p0");
    await expect(point).toBeVisible();
    const bounds = (await point.boundingBox())!;
    const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
    fs.mkdirSync(barrierDir, { recursive: true });
    fs.writeFileSync(stage + ".arm", "1");
    await window.mouse.move(x, y);
    await window.mouse.down();
    await window.mouse.move(x + 40, y + 12);
    // Ready is emitted by PlaneGCS after building its residual/Jacobian;
    // the solve still owns temporary parameters and has not replied.
    await expect.poll(() => fs.existsSync(stage + ".ready"), { timeout: 15000 }).toBe(true);
    ({ app, window } = await terminateAndRestore(app, window, before, target,
      () => fs.writeFileSync(stage + ".release", "1"), true));
    expect(await sketchModel(window, sketch.id)).toEqual(committedModel);
  } finally {
    if (fs.existsSync(barrierDir)) fs.writeFileSync(stage + ".release", "1");
    await app.close();
  }
});
}

test("recompute and completed save survive a later preview crash [solo]", async () => {
  const { app, window } = await boot(env);
  try {
    await modelAndSave(window);
    await openProject(window);
    await window.getByText(/Box 100×60×10/).first().click();
    await runBar(window, "set widthMm 140");
    const recomputed = await snapOf(window);
    expect(recomputed.bodies[0]!.paramsMm[0]).toBeCloseTo(140, 6);
    expect(recomputed.bodies[0]!.volumeMm3).toBeCloseTo(84000, 0);

    // saveIcad calls the same typed SaveDocument path without opening a dialog.
    await window.evaluate(
      ({ path }) =>
        (
          window as unknown as {
            __kreoda_test: { saveIcad: (path: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.saveIcad(path),
      { path: explicitSaveFile },
    );
    expect(fs.existsSync(explicitSaveFile)).toBe(true);
    expect(fs.statSync(explicitSaveFile).size).toBeGreaterThan(0);
    await window.evaluate(() =>
      (
        window as unknown as { __kreoda_test: { autosaveNow: () => Promise<string> } }
      ).__kreoda_test.autosaveNow(),
    );

    const input = window.getByTestId("command-input");
    await input.fill("box 5 5 5");
    await input.press("Enter");
    await expect(window.getByTestId("plan-preview")).toBeVisible({ timeout: 5000 });
    await crashRendererAndRestore(app, window, recomputed);
  } finally {
    await app.close();
  }
});

test("renderer crash after STEP import restores the imported solid [solo]", async () => {
  const { app, window } = await boot(env);
  try {
    await modelAndSave(window);
    await openProject(window);
    await window.getByText(/Box 100×60×10/).first().click();
    await runBar(window, "set widthMm 140");
    await window.evaluate(() =>
      (
        window as unknown as { __kreoda_test: { autosaveNow: () => Promise<string> } }
      ).__kreoda_test.autosaveNow(),
    );
    expect(fs.existsSync(recoveryFile)).toBe(true);
    await window.evaluate(
      ({ path }) =>
        (
          window as unknown as {
            __kreoda_test: { saveIcad: (path: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.saveIcad(path),
      { path: stepFile },
    );
    expect(fs.existsSync(stepFile)).toBe(true);
    expect(fs.statSync(stepFile).size).toBeGreaterThan(1000);

    const imported = (await window.evaluate(
      ({ path }) =>
        (
          window as unknown as {
            __kreoda_test: { openIcad: (path: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.openIcad(path),
      { path: stepFile },
    )) as Snapshot;
    expect(imported.bodies).toHaveLength(1);
    expect(imported.bodies[0]!.type).toBe("StepImport");
    expect(imported.bodies[0]!.volumeMm3).toBeCloseTo(84000, 0);

    // The recompute autosave is revision two; STEP import resets the document
    // to revision one, so this call must write the imported state.
    const autosaved = await window.evaluate(() =>
      (
        window as unknown as { __kreoda_test: { autosaveNow: () => Promise<string> } }
      ).__kreoda_test.autosaveNow(),
    );
    expect(autosaved).toBe("saved");
    await crashRendererAndRestore(app, window, imported);
  } finally {
    await app.close();
  }
});

test("main process kill relaunches and restores committed autosave [solo]", async () => {
  test.skip(process.platform !== "win32", "taskkill requires Windows");
  const { app, window } = await boot(env);
  const before = await modelAndSave(window);
  execFileSync("taskkill", ["/F", "/T", "/PID", String(app.process().pid)], { stdio: "ignore" });
  await app.close().catch(() => {});

  const relaunched = await electron.launch({ args: [MAIN, "--no-sandbox", "--lang=en-US"], env });
  try {
    const recovered = await relaunched.firstWindow({ timeout: 30000 });
    await expect(recovered.getByTestId("home-screen")).toBeVisible({ timeout: 30000 });
    await recovered.getByTestId("home-new-project").click();
    await expect(recovered.getByText(/core 0\.1\.0/)).toBeVisible({ timeout: 30000 });
    await restore(recovered, before);
  } finally {
    await relaunched.close();
  }
});

// Dedicated test cores pause inside PlaneGCS and BRepMesh::Perform. Production
// compiles both barriers out; packaging rejects the opt-in crash build.
