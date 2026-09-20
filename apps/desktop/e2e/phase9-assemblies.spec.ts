// Phase 9d E2E: rigid instances end to end.
// Box → place instance at +50 X via dialog → move via dimension edit →
// reopen persists the assembly. Rotation math is covered in ctest.

import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import os from "node:os";

const HERE = import.meta.dirname;
const MAIN = path.join(HERE, "..", ".vite", "build", "main.cjs");
const ICAD = path.join(os.tmpdir(), "kreoda-phase9-inst-e2e.icad");

interface BodySnapshot {
  id: string;
  type: string;
  paramsMm: number[];
  volumeMm3: number;
}
interface Snapshot {
  revision: number;
  bodies: BodySnapshot[];
}

test("instances: place, move, persist", async () => {
  const app = await electron.launch({
    args: [MAIN, "--no-sandbox"],
  });
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
      );
    const input = window.getByTestId("command-input");

    // 1. Source plate.
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

    // 2. Place instance +50 X through the dialog.
    await window.getByText(/Box 100×60×10/).first().click();
    await window.getByRole("button", { name: /Copy placed/ }).click();
    const dialog = window.getByTestId("instance-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.locator("input").nth(0).fill("50");
    await dialog.getByRole("button", { name: /Place instance/ }).click();
    await expect
      .poll(async () => ((await snap()) as Snapshot).bodies.length, {
        timeout: 30000,
      })
      .toBe(2);
    let s = (await snap()) as Snapshot;
    const inst = s.bodies.find((b) => b.type === "Instance");
    expect(inst).toBeDefined();
    expect(inst!.volumeMm3).toBeCloseTo(60000, 0);
    expect(inst!.paramsMm[0]).toBeCloseTo(50, 6);

    // 3. Move the instance with a dimension edit (txMm 50 → 25).
    await window.evaluate(
      ({ id }) =>
        (
          window as unknown as {
            __kreoda_test: {
              setParam: (f: string, p: string, v: number) => Promise<Snapshot>;
            };
          }
        ).__kreoda_test.setParam(id, "txMm", 25),
      { id: inst!.id },
    );
    s = (await snap()) as Snapshot;
    expect(
      s.bodies.find((b) => b.id === inst!.id)!.paramsMm[0],
    ).toBeCloseTo(25, 6);

    // 4. Save → reopen keeps the assembly (instance + source).
    await window.evaluate(
      ({ icad }) =>
        (
          window as unknown as {
            __kreoda_test: { saveIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.saveIcad(icad),
      { icad: ICAD },
    );
    const reopened = (await window.evaluate(
      ({ icad }) =>
        (
          window as unknown as {
            __kreoda_test: { openIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.openIcad(icad),
      { icad: ICAD },
    )) as Snapshot;
    expect(reopened.bodies).toHaveLength(2);
    expect(
      reopened.bodies.filter((b) => b.type === "Instance"),
    ).toHaveLength(1);

    await window.screenshot({ path: path.join(HERE, "phase9-assemblies.png") });
  } finally {
    await app.close();
  }
});
