// Phase 9a E2E (§22): parametric expressions end to end.
// Box → width =height*2 → height edit reflows width → reopen keeps the
// formula → cyclic formula rejected honestly.

import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import { HERE, MAIN, type Snapshot } from "./helpers";

const ICAD = path.join(os.tmpdir(), "kreoda-phase9-expr-e2e.icad");

test("expressions: set, reflow, persist, reject cycles", async () => {
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
    const preview = window.getByTestId("plan-preview");

    // 1. Plate.
    await input.fill("box 100 60 10");
    await input.press("Enter");
    await expect(preview).toBeVisible({ timeout: 5000 });
    await preview.getByRole("button", { name: /Run 1 step/ }).click();
    await expect
      .poll(async () => ((await snap()) as Snapshot).bodies.length, {
        timeout: 30000,
      })
      .toBe(1);

    // 2. Formula: width follows height.
    await window.getByText(/Box 100×60×10/).first().click();
    await input.fill("set widthMm =heightMm * 2");
    await input.press("Enter");
    await expect(preview).toBeVisible({ timeout: 5000 });
    await expect(preview).toContainText("formula");
    await preview.getByRole("button", { name: /Run 1 step/ }).click();
    await expect
      .poll(
        async () => ((await snap()) as Snapshot).bodies[0]!.paramsMm[0],
        { timeout: 30000 },
      )
      .toBe(120);
    let s = (await snap()) as Snapshot;
    expect(s.bodies[0]!.volumeMm3).toBeCloseTo(72000, 0);
    expect(s.bodies[0]!.expressions["widthMm"]).toBe("heightMm * 2");

    // 3. Editing the source reflows the dependent.
    await input.fill("set heightMm 100");
    await input.press("Enter");
    await expect(preview).toBeVisible({ timeout: 5000 });
    await preview.getByRole("button", { name: /Run 1 step/ }).click();
    await expect
      .poll(
        async () => ((await snap()) as Snapshot).bodies[0]!.paramsMm[0],
        { timeout: 30000 },
      )
      .toBe(200);
    s = (await snap()) as Snapshot;
    expect(s.bodies[0]!.volumeMm3).toBeCloseTo(200000, 0);

    // 4. Save → reopen keeps formula AND value.
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
    expect(reopened.bodies).toHaveLength(1);
    expect(reopened.bodies[0]!.paramsMm[0]).toBe(200);
    expect(reopened.bodies[0]!.expressions["widthMm"]).toBe("heightMm * 2");

    // 5. Cyclic formula rejected honestly (no commit, stale value kept).
    await window.getByText(/Box 200×100×10/).first().click();
    await input.fill("set widthMm =widthMm * 2");
    await input.press("Enter");
    await expect(preview).toBeVisible({ timeout: 5000 });
    await preview.getByRole("button", { name: /Run 1 step/ }).click();
    await expect(window.getByText(/Stopped after 0 steps/)).toBeVisible({
      timeout: 20000,
    });
    s = (await snap()) as Snapshot;
    expect(s.bodies[0]!.paramsMm[0]).toBe(200);

    await window.screenshot({ path: path.join(HERE, "phase9-expressions.png") });
  } finally {
    await app.close();
  }
});
