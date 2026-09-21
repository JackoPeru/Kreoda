// Phase 5 acceptance E2E (§61 + §62 Scenario A): a beginner creates a
// 100×50×10 block with an 8 mm hole — exact B-Rep solids, editable feature
// tree, save/reopen identical, undo restores.

import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import { HERE, MAIN, type Snapshot } from "./helpers";

const ICAD = path.join(os.tmpdir(), "kreoda-phase5-e2e.icad");

test("beginner block with 8mm hole, undo, reopen identical", async () => {
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

    // 1. Add Box 100×50×10 through the real dialog (no tutorial needed).
    await window.getByRole("button", { name: /Add box/ }).click();
    const dialog = window.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    const inputs = dialog.locator("input");
    await inputs.nth(0).fill("100");
    await inputs.nth(1).fill("50");
    await inputs.nth(2).fill("10");
    await window.getByRole("button", { name: "Create" }).click();
    await expect(window.getByText(/Box 100×50×10/)).toBeVisible({
      timeout: 20000,
    });

    // 2. Select the top face in the viewport (contextual auto mode).
    const s0 = (await snap()) as Snapshot;
    const boxId = s0.bodies[0]!.id;
    await window.getByText(/Box 100×50×10/).click();
    await window.evaluate(
      ({ f }) =>
        (
          window as unknown as {
            __kreoda_test: {
              selectFace: (id: string, role: string) => unknown;
            };
          }
        ).__kreoda_test.selectFace(f, "box.+Z"),
      { f: boxId },
    );
    // Hole dialog works from the face selection; drive the typed path with
    // the persistent face role (same command the dialog invokes).
    const s1 = (await window.evaluate(
      ({ target }) =>
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
        ).__kreoda_test.makeHole(target, "box.+Z", 50, 25, 8),
      { target: boxId },
    )) as Snapshot;
    expect(s1.bodies).toHaveLength(2);
    const hole = s1.bodies.find((b) => b.type === "Hole")!;
    // Exact: 100×50×10 minus the ⌀8 through-cylinder.
    expect(hole.volumeMm3).toBeCloseTo(100 * 50 * 10 - Math.PI * 16 * 10, 2);
    expect(hole.triangles).toBeGreaterThan(12);

    // 3. One Undo step removes the hole (one transaction, §12).
    await window.locator('button[title^="Undo"]').click();
    await expect
      .poll(async () => ((await snap()) as Snapshot).bodies.length, {
        timeout: 20000,
      })
      .toBe(1);

    // 4. Redo + save → reopen identical.
    await window.locator('button[title^="Redo"]').click();
    await expect
      .poll(async () => ((await snap()) as Snapshot).bodies.length, {
        timeout: 20000,
      })
      .toBe(2);
    await window.evaluate(
      ({ icad }) =>
        (
          window as unknown as {
            __kreoda_test: { saveIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.saveIcad(icad),
      { icad: ICAD },
    );
    const s4 = (await window.evaluate(
      ({ icad }) =>
        (
          window as unknown as {
            __kreoda_test: { openIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.openIcad(icad),
      { icad: ICAD },
    )) as Snapshot;
    expect(s4.bodies).toHaveLength(2);
    const reopened = s4.bodies.find((b) => b.type === "Hole")!;
    expect(reopened.volumeMm3).toBeCloseTo(hole.volumeMm3, 4);

    // 5. Blind hole (depth 5) on the original box: exact partial removal.
    const s5 = (await window.evaluate(
      ({ target }) =>
        (
          window as unknown as {
            __kreoda_test: {
              makeHole: (
                t: string,
                role: string,
                x: number,
                y: number,
                d: number,
                mode: "throughAll" | "blind",
                depth: number,
              ) => Promise<Snapshot>;
            };
          }
        ).__kreoda_test.makeHole(target, "box.+Z", 20, 20, 8, "blind", 5),
      { target: boxId },
    )) as Snapshot;
    const blind = s5.bodies.find(
      (b) => b.type === "Hole" && b.id !== hole.id && b.id !== reopened.id,
    )!;
    expect(blind.volumeMm3).toBeCloseTo(100 * 50 * 10 - Math.PI * 16 * 5, 1);

    await window.screenshot({ path: path.join(HERE, "phase5-hole.png") });
  } finally {
    await app.close();
  }
});
