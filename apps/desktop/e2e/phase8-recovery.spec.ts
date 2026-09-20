// Phase 8 E2E (§51/§61): crash recovery via autosave snapshots.
// Session 1 models + autosaves, then goes away without saving (crash and
// quit-without-save are indistinguishable by design). Session 2 offers the
// recovery banner → Restore brings the exact body back. Session 3 proves
// Discard clears the prompt and starts empty.

import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const HERE = import.meta.dirname;
const MAIN = path.join(HERE, "..", ".vite", "build", "main.cjs");
const RECOVERY_DIR = path.join(os.tmpdir(), "intentcad-phase8-recovery-e2e");

interface BodySnapshot {
  id: string;
  type: string;
  volumeMm3: number;
}
interface Snapshot {
  revision: number;
  bodies: BodySnapshot[];
}

async function boot(env: Record<string, string>) {
  const app = await electron.launch({ args: [MAIN, "--no-sandbox"], env });
  const window = await app.firstWindow({ timeout: 30000 });
  await window.waitForLoadState("domcontentloaded");
  await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({
    timeout: 20000,
  });
  return { app, window };
}

test("crash recovery: autosave → restore → discard", async () => {
  fs.rmSync(RECOVERY_DIR, { recursive: true, force: true });
  const env = { ...process.env, INTENTCAD_RECOVERY_DIR: RECOVERY_DIR };

  // Session 1: model a plate, autosave, vanish without saving.
  {
    const { app, window } = await boot(env);
    try {
      const input = window.getByTestId("command-input");
      await input.fill("box 100 60 10");
      await input.press("Enter");
      const preview = window.getByTestId("plan-preview");
      await expect(preview).toBeVisible({ timeout: 5000 });
      await preview.getByRole("button", { name: /Run 1 step/ }).click();
      await expect
        .poll(
          async () =>
            (
              (await window.evaluate(() =>
                (
                  window as unknown as {
                    __intentcad_test: { snapshot: () => Snapshot };
                  }
                ).__intentcad_test.snapshot(),
              )) as Snapshot
            ).bodies.length,
          { timeout: 30000 },
        )
        .toBe(1);
      await window.evaluate(() =>
        (
          window as unknown as {
            __intentcad_test: { autosaveNow: () => Promise<string> };
          }
        ).__intentcad_test.autosaveNow(),
      );
      expect(
        fs.existsSync(path.join(RECOVERY_DIR, "autosave.icad")),
      ).toBe(true);
    } finally {
      await app.close();
    }
  }

  // Session 2: banner offers the snapshot → Restore recovers the plate.
  {
    const { app, window } = await boot(env);
    try {
      const banner = window.getByTestId("recovery-banner");
      await expect(banner).toBeVisible({ timeout: 10000 });
      await window.getByTestId("recovery-restore").click();
      await expect
        .poll(
          async () =>
            (
              (await window.evaluate(() =>
                (
                  window as unknown as {
                    __intentcad_test: { snapshot: () => Snapshot };
                  }
                ).__intentcad_test.snapshot(),
              )) as Snapshot
            ).bodies.length,
          { timeout: 30000 },
        )
        .toBe(1);
      const snap = (await window.evaluate(() =>
        (
          window as unknown as {
            __intentcad_test: { snapshot: () => Snapshot };
          }
        ).__intentcad_test.snapshot(),
      )) as Snapshot;
      expect(snap.bodies[0]!.type).toBe("Box");
      expect(snap.bodies[0]!.volumeMm3).toBeCloseTo(60000, 3);
      await expect(banner).toBeHidden({ timeout: 5000 });
    } finally {
      await app.close();
    }
  }

  // Session 3: restoring kept the file → Discard clears it, doc stays empty.
  {
    const { app, window } = await boot(env);
    try {
      await expect(window.getByTestId("recovery-banner")).toBeVisible({
        timeout: 10000,
      });
      await window.getByTestId("recovery-discard").click();
      await expect(window.getByTestId("recovery-banner")).toBeHidden({
        timeout: 5000,
      });
      const snap = (await window.evaluate(() =>
        (
          window as unknown as {
            __intentcad_test: { snapshot: () => Snapshot };
          }
        ).__intentcad_test.snapshot(),
      )) as Snapshot;
      expect(snap.bodies).toHaveLength(0);
      expect(
        fs.existsSync(path.join(RECOVERY_DIR, "autosave.icad")),
      ).toBe(false);
    } finally {
      await app.close();
    }
  }
  fs.rmSync(RECOVERY_DIR, { recursive: true, force: true });
});
