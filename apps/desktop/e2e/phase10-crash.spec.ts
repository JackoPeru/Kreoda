// Run alone: these tests terminate Electron or its native child by PID.
import { test, expect, _electron as electron } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { boot, MAIN, runBar, snapOf, type Snapshot } from "./helpers";

const recoveryDir = path.join(os.tmpdir(), "kreoda-phase10-crash-e2e");
const recoveryFile = path.join(recoveryDir, "autosave.icad");
const env = { ...process.env, KREODA_RECOVERY_DIR: recoveryDir };

async function modelAndSave(window: Awaited<ReturnType<typeof boot>>["window"]) {
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

async function restore(window: Awaited<ReturnType<typeof boot>>["window"], before: Snapshot) {
  await expect(window.getByTestId("recovery-banner")).toBeVisible({ timeout: 30000 });
  await window.getByTestId("recovery-restore").click();
  await expect.poll(async () => (await snapOf(window)).bodies.length, { timeout: 30000 }).toBe(1);
  const after = await snapOf(window);
  expect(after.bodies[0]!.id).toBe(before.bodies[0]!.id);
  expect(after.bodies[0]!.volumeMm3).toBeCloseTo(before.bodies[0]!.volumeMm3, 3);
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
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.forcefullyCrashRenderer(),
    );
    await expect(window.getByTestId("home-screen")).toBeVisible({ timeout: 30000 });
    await window.getByTestId("home-new-project").click();
    await restore(window, before);
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
