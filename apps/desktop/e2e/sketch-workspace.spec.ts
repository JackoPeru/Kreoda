// UX-3 E2E: sketch workspace speaks the same UI (simple disclosure) and
// the solver paths still work (live drag solve, Escape cancel, Done).
import { test, expect } from "@playwright/test";
import path from "node:path";
import { HERE, boot, type Snapshot } from "./helpers";

test("sketch workspace: disclosure, live drag, escape cancel", async () => {
  const { app, window } = await boot();
  try {
    await window.evaluate(() =>
      (
        window as unknown as {
          __kreoda_test: {
            createRectSketch: (w: number, h: number) => Promise<Snapshot>;
          };
        }
      ).__kreoda_test.createRectSketch(100, 50),
    );
    const s1 = (await window.evaluate(() =>
      (
        window as unknown as {
          __kreoda_test: { snapshot: () => Snapshot };
        }
      ).__kreoda_test.snapshot(),
    )) as Snapshot;
    const sketchId = s1.sketches[0]!.id;
    await window.evaluate(
      (sk) =>
        (
          window as unknown as {
            __kreoda_test: { openSketch: (id: string) => unknown };
          }
        ).__kreoda_test.openSketch(sk),
      sketchId,
    );

    const canvas = window.getByTestId("sketch-canvas");
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Simple mode: dimensions stay, solver diagnostics hide behind Details.
    await expect(window.getByText("Dimensions")).toBeVisible();
    await expect(window.getByText(/horizontal l0/)).not.toBeVisible();
    await window.getByRole("button", { name: "Details" }).click();
    await expect(window.getByText(/horizontal l0/)).toBeVisible();
    await window.screenshot({ path: path.join(HERE, "sketch-details.png") });
    await window.getByRole("button", { name: "Hide details" }).click();
    await expect(window.getByText(/horizontal l0/)).not.toBeVisible();

    // Live drag: the point label follows the pointer (solver preview).
    const point = window.getByTestId("sk-point-p0");
    const label = window.locator("g", { has: point }).locator("text");
    const before = await label.textContent();
    const at = (await point.boundingBox())!;
    const cx = at.x + at.width / 2;
    const cy = at.y + at.height / 2;
    await window.mouse.move(cx, cy);
    await window.mouse.down();
    await window.mouse.move(cx + 40, cy + 12, { steps: 5 });
    await expect
      .poll(async () => label.textContent(), { timeout: 10000 })
      .not.toBe(before);
    await window.screenshot({ path: path.join(HERE, "sketch-drag.png") });

    // Escape mid-drag restores the pre-drag state (no commit).
    await window.keyboard.press("Escape");
    await expect
      .poll(async () => label.textContent(), { timeout: 5000 })
      .toBe(before);
    await window.mouse.up();

    // Release-with-move commits without errors; Done closes the workspace.
    await window.mouse.move(cx, cy);
    await window.mouse.down();
    await window.mouse.move(cx + 24, cy + 8, { steps: 4 });
    await window.mouse.up();
    await expect(canvas).toBeVisible({ timeout: 5000 });
    await window.getByRole("button", { name: "Done" }).click();
    await expect(canvas).not.toBeVisible({ timeout: 5000 });
  } finally {
    await app.close();
  }
});
