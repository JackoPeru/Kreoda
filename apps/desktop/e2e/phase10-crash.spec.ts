// Phase 10 crash recovery (§10.5): HARD-KILL the geometry sidecar
// mid-session, then prove the app freezes editing honestly, restarts the
// engine, and restores the latest autosaved committed state.
//
// RUN SEPARATELY: pnpm exec playwright test e2e/phase10-crash.spec.ts
// (taskkill targets kreoda-core.exe by image name and must not run while
// other specs hold their own sidecar).

import { test, expect, _electron as electron } from "@playwright/test";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { HERE, MAIN, type Snapshot } from "./helpers";

const RECOVERY_DIR = path.join(os.tmpdir(), "kreoda-phase10-crash-e2e");

test("hard-kill sidecar → banner → restart → autosave restore [solo]", async () => {
  test.skip(
    process.platform !== "win32",
    "sidecar hard-kill uses taskkill (Windows-only)",
  );
  fs.rmSync(RECOVERY_DIR, { recursive: true, force: true });
  const env = { ...process.env, KREODA_RECOVERY_DIR: RECOVERY_DIR };
  const app = await electron.launch({ args: [MAIN, "--no-sandbox", "--lang=en-US"], env });
  try {
    const window = await app.firstWindow({ timeout: 30000 });
    await window.waitForLoadState("domcontentloaded");
    await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({
      timeout: 20000,
    });
    const snap = (): Promise<Snapshot> =>
      window.evaluate(() =>
        (
          window as unknown as {
            __kreoda_test: { snapshot: () => Snapshot };
          }
        ).__kreoda_test.snapshot(),
      ) as Promise<Snapshot>;

    // 1. Model a plate and force an autosave (the committed state to keep).
    const input = window.getByTestId("command-input");
    await input.fill("box 100 60 10");
    await input.press("Enter");
    const preview = window.getByTestId("plan-preview");
    await expect(preview).toBeVisible({ timeout: 5000 });
    await preview.getByRole("button", { name: /Run 1 step/ }).click();
    await expect
      .poll(async () => ((await snap()) as Snapshot).bodies.length, {
        timeout: 30000,
      })
      .toBe(1);
    const before = (await snap()) as Snapshot;
    await window.evaluate(() =>
      (
        window as unknown as {
          __kreoda_test: { autosaveNow: () => Promise<string> };
        }
      ).__kreoda_test.autosaveNow(),
    );
    expect(fs.existsSync(path.join(RECOVERY_DIR, "autosave.icad"))).toBe(
      true,
    );

    // 2. Hard-kill the sidecar: no graceful shutdown, no IPC farewell.
    execSync("taskkill /F /IM kreoda-core.exe", { stdio: "ignore" });

    // 3. Renderer must report the crash (editing frozen, honest banner).
    await expect(window.getByText(/Geometry engine stopped/)).toBeVisible({
      timeout: 20000,
    });

    // 4. Main restarts the engine automatically; the UI reconnects.
    await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({
      timeout: 60000,
    });

    // 5. The restarted engine is empty; the recovery banner offers the
    // autosave → Restore brings the exact plate back.
    const banner = window.getByTestId("recovery-banner");
    await expect(banner).toBeVisible({ timeout: 15000 });
    await window.getByTestId("recovery-restore").click();
    await expect
      .poll(async () => ((await snap()) as Snapshot).bodies.length, {
        timeout: 30000,
      })
      .toBe(1);
    const after = (await snap()) as Snapshot;
    expect(after.bodies[0]!.id).toBe(before.bodies[0]!.id);
    expect(after.bodies[0]!.volumeMm3).toBeCloseTo(
      before.bodies[0]!.volumeMm3,
      3,
    );

    await window.screenshot({ path: path.join(HERE, "phase10-crash.png") });
  } finally {
    await app.close();
  }
});
