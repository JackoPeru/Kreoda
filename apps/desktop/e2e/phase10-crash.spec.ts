// Run alone: these tests terminate Electron or its native child by PID.
import { test, expect, _electron as electron } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { boot, MAIN, runBar, snapOf, type Snapshot } from "./helpers";

const recoveryDir = path.join(os.tmpdir(), "kreoda-phase10-crash-e2e");
const recoveryFile = path.join(recoveryDir, "autosave.icad");
const explicitSaveFile = path.join(recoveryDir, "recomputed.icad");
const stepFile = path.join(recoveryDir, "import.step");
const env = { ...process.env, KREODA_RECOVERY_DIR: recoveryDir };
type TestWindow = Awaited<ReturnType<typeof boot>>["window"];

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
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.webContents.forcefullyCrashRenderer(),
  );
  await expect(window.getByTestId("home-screen")).toBeVisible({ timeout: 30000 });
  if (releasePointer) await window.mouse.up();
  await window.getByTestId("home-new-project").click();
  await restore(window, before);
}

test.beforeEach(() => {
  fs.rmSync(recoveryDir, { recursive: true, force: true });
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

test("renderer crash reloads and restores committed autosave [solo]", async () => {
  const { app, window } = await boot(env);
  try {
    const before = await modelAndSave(window);
    await crashRendererAndRestore(app, window, before);
  } finally {
    await app.close();
  }
});

test("renderer crash during command preview restores the last committed model [solo]", async () => {
  const { app, window } = await boot(env);
  try {
    const before = await modelAndSave(window);
    const input = window.getByTestId("command-input");
    await input.fill("box 20 30 40");
    await input.press("Enter");
    await expect(window.getByTestId("plan-preview")).toBeVisible({ timeout: 5000 });

    // The preview has not called Run, so recovery must contain only the box.
    await crashRendererAndRestore(app, window, before);
  } finally {
    await app.close();
  }
});

test("renderer crash during sketch solve restores the last autosave [solo]", async () => {
  const { app, window } = await boot(env);
  try {
    const before = await modelAndSave(window);
    await window.evaluate(() =>
      (
        window as unknown as {
          __kreoda_test: { createRectSketch: (w: number, h: number) => Promise<Snapshot> };
        }
      ).__kreoda_test.createRectSketch(100, 50),
    );
    const sketch = (await snapOf(window)).sketches[0]!;
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
    await crashRendererAndRestore(app, window, before, true);
  } finally {
    await app.close();
  }
});

test("recompute and completed save survive a later preview crash [solo]", async () => {
  const { app, window } = await boot(env);
  try {
    await modelAndSave(window);
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

// The 500k/1M OCCT tessellation runs synchronously in the sidecar. There is no
// deterministic E2E barrier once BRepMesh starts, so killing by elapsed time
// would race the operation; this suite does not claim an in-flight mesh crash.
