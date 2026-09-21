// Phase 7 E2E (§61): deterministic short commands run offline end to end.
// "box 100 60 10" → plate; "holes 6 4 corners 8" → four editable holes;
// gibberish without a provider → honest message; "view front" moves camera.

import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import { HERE, MAIN, type Snapshot } from "./helpers";

test("command bar: plate, corner holes, views, honest fallback", async () => {
  const app = await electron.launch({
    args: [MAIN, "--no-sandbox"],
  });
  try {
    const window = await app.firstWindow({ timeout: 30000 });
    await window.waitForLoadState("domcontentloaded");
    await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({
      timeout: 20000,
    });
    await window.evaluate(() => localStorage.clear());
    await window.reload();
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

    // 1. Plate from short syntax (parsed locally, previewed, committed).
    await input.fill("box 100 60 10");
    await input.press("Enter");
    const preview = window.getByTestId("plan-preview");
    await expect(preview).toBeVisible({ timeout: 5000 });
    await expect(preview).toContainText("Box 100×60×10 mm");
    await preview.getByRole("button", { name: /Run 1 step/ }).click();
    await expect(window.getByText(/Box 100×60×10/).first()).toBeVisible({
      timeout: 20000,
    });

    // 2. Four corner holes through the typed multi-step plan.
    await window.getByText(/Box 100×60×10/).first().click();
    await input.fill("holes 6 4 corners 8");
    await input.press("Enter");
    await expect(preview).toBeVisible({ timeout: 5000 });
    await expect(preview).toContainText("4 ⌀6 holes");
    await preview.getByRole("button", { name: /Run 1 step/ }).click();
    // Slice 5 cumulative HolePattern: Box + ONE pattern tip (2 features,
    // 1 body); the tip is the cumulative cut (base minus ALL four tools).
    await expect
      .poll(async () => ((await snap()) as Snapshot).bodies.length, {
        timeout: 30000,
      })
      .toBe(2);
    const s2 = (await snap()) as Snapshot;
    const holes = s2.bodies.filter((b) => b.type === "HolePattern");
    expect(holes).toHaveLength(1);
    for (const h of holes) {
      expect(h.volumeMm3).toBeCloseTo(100 * 60 * 10 - 4 * Math.PI * 9 * 10, 0);
    }

    // 3. Genuine prose without a provider: honest offline message.
    await input.fill("make me a bracket with four holes");
    await input.press("Enter");
    await expect(window.getByText(/No language model configured/)).toBeVisible({
      timeout: 5000,
    });

    // 4. View preset through the bar.
    await input.fill("view front");
    await input.press("Enter");
    await preview.getByRole("button", { name: /Run 1 step/ }).click();
    const dir = (await window.evaluate(() =>
      (
        window as unknown as {
          __kreoda_test: { viewDir: () => [number, number, number] };
        }
      ).__kreoda_test.viewDir(),
    )) as [number, number, number];
    expect(dir[1]).toBeGreaterThan(0.99);

    await window.screenshot({ path: path.join(HERE, "phase7-nl.png") });
  } finally {
    await app.close();
  }
});
