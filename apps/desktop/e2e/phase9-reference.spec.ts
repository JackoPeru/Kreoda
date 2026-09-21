// Phase 9c E2E (§29 Stage A): reference image planes end to end.
// A generated test image becomes a plane, two-click calibration sizes it
// to the real distance, and the calibrated plane renders in the viewport.

import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import { HERE, MAIN, openMore } from "./helpers";

interface RefPlane {
  id: string;
  name: string;
  imageW: number;
  imageH: number;
  widthMm: number;
  heightMm: number;
  mmPerPx: number | null;
}

test("reference image: inject, calibrate, render", async () => {
  const app = await electron.launch({
    args: [MAIN, "--no-sandbox"],
  });
  try {
    const window = await app.firstWindow({ timeout: 30000 });
    await window.waitForLoadState("domcontentloaded");
    await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({
      timeout: 20000,
    });

    // 200×100 px checkerboard generated in-page (no native dialog needed).
    const dataUrl = (await window.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 200;
      c.height = 100;
      const g = c.getContext("2d")!;
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, 200, 100);
      g.fillStyle = "#000000";
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 20; x++) {
          if ((x + y) % 2 === 0) g.fillRect(x * 10, y * 10, 10, 10);
        }
      }
      return c.toDataURL("image/png");
    })) as string;
    expect(dataUrl.startsWith("data:image/png")).toBe(true);

    const plane = (await window.evaluate(
      ({ url }) =>
        (
          window as unknown as {
            __kreoda_test: {
              addReference: (
                u: string,
                w: number,
                h: number,
              ) => Promise<RefPlane>;
            };
          }
        ).__kreoda_test.addReference(url, 200, 100),
      { url: dataUrl },
    )) as RefPlane;
    expect(plane.widthMm).toBe(200);
    expect(plane.mmPerPx).toBeNull();

    // Two clicks 50 px apart declared as 25 mm → 0.5 mm/px, 100×50 mm.
    const calibrated = (await window.evaluate(
      ({ id }) =>
        (
          window as unknown as {
            __kreoda_test: {
              calibrateReference: (
                rid: string,
                p1: [number, number],
                p2: [number, number],
                real: number,
              ) => Promise<RefPlane>;
            };
          }
        ).__kreoda_test.calibrateReference(id, [10, 10], [60, 10], 25),
      { id: plane.id },
    )) as RefPlane;
    expect(calibrated.mmPerPx).toBeCloseTo(0.5, 9);
    expect(calibrated.widthMm).toBeCloseTo(100, 9);
    expect(calibrated.heightMm).toBeCloseTo(50, 9);

    // The dialog surfaces the calibrated size; the viewport renders it.
    await openMore(window);
    await window.getByTestId("reference-button").click();
    await expect(window.getByTestId("reference-dialog")).toBeVisible({
      timeout: 5000,
    });
    await expect(window.getByText(/100\.0×50\.0 mm/)).toBeVisible({
      timeout: 5000,
    });
    await window.screenshot({ path: path.join(HERE, "phase9-reference.png") });
  } finally {
    await app.close();
  }
});
