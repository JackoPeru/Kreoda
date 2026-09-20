// Phase 4 acceptance E2E (§61): dimensioned plate with holes TTW — here the
// vertical slice: sketch (100×50 rect) → extrude 20 → exact 100000 solid;
// sketch width edit → downstream solid recomputes (150000); face reference
// survives; save → reopen identical.

import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import os from "node:os";

const HERE = import.meta.dirname;
const MAIN = path.join(HERE, "..", ".vite", "build", "main.cjs");
const ICAD = path.join(os.tmpdir(), "intentcad-phase4-e2e.icad");

interface BodySnapshot {
  id: string;
  type: string;
  paramsMm: number[];
  volumeMm3: number;
  triangles: number;
  faces: string[];
}
interface SketchSnapshot {
  id: string;
  planeKind: string;
  points: number;
  constraints: number;
}
interface Snapshot {
  revision: number;
  bodies: BodySnapshot[];
  sketches: SketchSnapshot[];
}

test("sketch plate extruded to exact solid, downstream update, reopen", async () => {
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
            __intentcad_test: { snapshot: () => Snapshot };
          }
        ).__intentcad_test.snapshot(),
      );

    // 1. Dimensioned sketch (100×50) through the real solver path.
    const s1 = (await window.evaluate(
      ({ w, h }) =>
        (
          window as unknown as {
            __intentcad_test: {
              createRectSketch: (w: number, h: number) => Promise<Snapshot>;
            };
          }
        ).__intentcad_test.createRectSketch(w, h),
      { w: 100, h: 50 },
    )) as Snapshot;
    expect(s1.sketches).toHaveLength(1);
    expect(s1.sketches[0]!.points).toBe(4);
    expect(s1.sketches[0]!.constraints).toBe(6);
    const sketchId = s1.sketches[0]!.id;

    // 2. Extrude 20 → exact plate volume.
    const s2 = (await window.evaluate(
      ({ sk }) =>
        (
          window as unknown as {
            __intentcad_test: {
              extrudeSketch: (sk: string, d: number) => Promise<Snapshot>;
            };
          }
        ).__intentcad_test.extrudeSketch(sk, 20),
      { sk: sketchId },
    )) as Snapshot;
    expect(s2.bodies).toHaveLength(1);
    expect(s2.bodies[0]!.volumeMm3).toBeCloseTo(100000, 3);
    expect(s2.bodies[0]!.triangles).toBeGreaterThanOrEqual(12);
    const solidId = s2.bodies[0]!.id;
    // Extrude caps carry extrude.* roles (stable across distance edits, §4).
    expect(s2.bodies[0]!.faces).toContain(`${solidId}:extrude.+Z`);

    // 3. Sketch width edit → downstream solid recomputes, same face ref.
    await window.evaluate(
      ({ sk }) =>
        (
          window as unknown as {
            __intentcad_test: { openSketch: (id: string) => unknown };
          }
        ).__intentcad_test.openSketch(sk),
      { sk: sketchId },
    );
    const canvas = window.getByTestId("sketch-canvas");
    await expect(canvas).toBeVisible({ timeout: 10000 });
    // Change the width dimension 100 → 150 via the dimension row.
    const widthInput = canvas
      .locator("..")
      .locator("label", { hasText: "dist p0" })
      .locator("input")
      .first();
    await widthInput.fill("150");
    await widthInput.press("Enter");
    await expect
      .poll(async () => ((await snap()) as Snapshot).bodies[0]!.volumeMm3, {
        timeout: 20000,
      })
      .toBeCloseTo(150000, 2);
    const s3 = (await snap()) as Snapshot;
    expect(s3.bodies[0]!.faces).toContain(`${solidId}:extrude.+Z`);
    // Close the editor through its Done button (keyboard Esc is reserved
    // for canceling in-progress drags, not for closing panels).
    await window.getByRole("button", { name: "Done" }).click();
    await expect(canvas).not.toBeVisible({ timeout: 5000 });

    // 4. Save → reopen identical (sketch + solid).
    await window.evaluate(
      ({ icad }) =>
        (
          window as unknown as {
            __intentcad_test: { saveIcad: (p: string) => Promise<Snapshot> };
          }
        ).__intentcad_test.saveIcad(icad),
      { icad: ICAD },
    );
    const s4 = (await window.evaluate(
      ({ icad }) =>
        (
          window as unknown as {
            __intentcad_test: { openIcad: (p: string) => Promise<Snapshot> };
          }
        ).__intentcad_test.openIcad(icad),
      { icad: ICAD },
    )) as Snapshot;
    expect(s4.sketches).toHaveLength(1);
    expect(s4.bodies).toHaveLength(1);
    expect(s4.bodies[0]!.id).toBe(solidId);
    expect(s4.bodies[0]!.volumeMm3).toBeCloseTo(150000, 6);

    await window.screenshot({ path: path.join(HERE, "phase4-sketch.png") });
  } finally {
    await app.close();
  }
});
