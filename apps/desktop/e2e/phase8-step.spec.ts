// Phase 8 E2E (§61): STEP AP214 export/import round-trip through the UI.
// Box → export .step → import replaces the doc with StepImport bodies at
// identical volume → .icad save/reopen proves imported bodies persist.

import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import { HERE, MAIN, type Snapshot } from "./helpers";

const STEP = path.join(os.tmpdir(), "kreoda-phase8-e2e.step");
const ICAD = path.join(os.tmpdir(), "kreoda-phase8-e2e.icad");

test("STEP export → import → persist", async () => {
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

    // 1. Parametric plate.
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

    // 2. Export STEP (same Save path the toolbar uses — extension branches).
    await window.evaluate(
      ({ step }) =>
        (
          window as unknown as {
            __kreoda_test: { saveIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.saveIcad(step),
      { step: STEP },
    );

    // 3. Import replaces the doc with non-parametric StepImport bodies.
    const imported = (await window.evaluate(
      ({ step }) =>
        (
          window as unknown as {
            __kreoda_test: { openIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.openIcad(step),
      { step: STEP },
    )) as Snapshot;
    expect(imported.bodies).toHaveLength(1);
    expect(imported.bodies[0]!.type).toBe("StepImport");
    expect(imported.bodies[0]!.volumeMm3).toBeCloseTo(60000, 0);
    expect(imported.bodies[0]!.triangles).toBeGreaterThan(0);

    // 4. Imported bodies persist through the native container.
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
    expect(reopened.bodies[0]!.type).toBe("StepImport");
    expect(reopened.bodies[0]!.volumeMm3).toBeCloseTo(60000, 0);

    // 5. Hole on the imported face (§63.11): role resolves, centroid-mapped
    // center hits, volume drops by exactly one ⌀8 through-hole.
    const target = reopened.bodies[0]!.id;
    await window.evaluate(
      ({ id }) =>
        (
          window as unknown as {
            __kreoda_test: {
              selectFace: (f: string, role: string) => unknown;
            };
          }
        ).__kreoda_test.selectFace(id, "box.+Z"),
      { id: target },
    );
    await window.evaluate(
      ({ id }) =>
        (
          window as unknown as {
            __kreoda_test: {
              makeHole: (
                t: string,
                role: string,
                x: number,
                y: number,
                d: number,
              ) => Promise<Snapshot>;
            };
          }
        ).__kreoda_test.makeHole(id, "box.+Z", 50, 30, 8),
      { id: target },
    );
    const holed = (await window.evaluate(
      () =>
        (
          window as unknown as {
            __kreoda_test: { snapshot: () => Snapshot };
          }
        ).__kreoda_test.snapshot(),
    )) as Snapshot;
    expect(holed.bodies).toHaveLength(2);
    const hole = holed.bodies.find((b) => b.type === "Hole");
    expect(hole).toBeDefined();
    // 60000 − π·16·10 ≈ 59497.35.
    expect(hole!.volumeMm3).toBeCloseTo(59497.35, 0);

    await window.screenshot({ path: path.join(HERE, "phase8-step.png") });
  } finally {
    await app.close();
  }
});
