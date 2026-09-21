// Phase 10 golden workflows (§10.2): end-to-end models covering Phase 9a
// (expressions), 9c (reference) and 9d (assemblies). 9b (plugins) is covered
// by phase9-plugins.spec.ts. Workflow A also locks the M11 single-undo
// pattern and the post-reopen cut regression (compound-label fix).

import { test, expect } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { HERE, boot, runBar, snapOf, type Snapshot } from "./helpers";

const ICAD_A = path.join(os.tmpdir(), "kreoda-phase10-golden-a.icad");
const STEP_A = path.join(os.tmpdir(), "kreoda-phase10-golden-a.step");
const ICAD_B = path.join(os.tmpdir(), "kreoda-phase10-golden-b.icad");

// Workflow A — parametric bracket: box → hole → pattern (one undo) →
// fillet → expression → early-dimension edit → undo/redo → save/reopen →
// post-reopen cut (exact) → STEP export/import.
test("golden A: parametric bracket with pattern, fillet, expression", async () => {
  const { app, window } = await boot();
  try {
    // 1. Plate 100×60×10.
    await runBar(window, "box 100 60 10");
    await expect
      .poll(async () => ((await snapOf(window)) as Snapshot).bodies.length, {
        timeout: 30000,
      })
      .toBe(1);
    let s = (await snapOf(window)) as Snapshot;
    const boxId = s.bodies[0]!.id;
    expect(s.bodies[0]!.volumeMm3).toBeCloseTo(60000, 3);

    // 2. Centered ⌀8 through-hole at face-local center (50,30).
    await window.getByText(/Box 100×60×10/).first().click();
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
    s = (await window.evaluate(
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
        ).__kreoda_test.makeHole(target, "box.+Z", 50, 30, 8),
      { target: boxId },
    )) as Snapshot;
    expect(s.bodies).toHaveLength(2);
    const hole = s.bodies.find((b) => b.type === "Hole")!;
    expect(hole.volumeMm3).toBeCloseTo(60000 - Math.PI * 16 * 10, 1);

    // 3. Four corner ⌀6 holes: one user action.
    await window.getByText(/Box 100×60×10/).first().click();
    await runBar(window, "holes 6 4 corners 8");
    await expect
      .poll(async () => ((await snapOf(window)) as Snapshot).bodies.length, {
        timeout: 30000,
      })
      .toBe(6);
    s = (await snapOf(window)) as Snapshot;
    const pattern = s.bodies.filter((b) => b.type === "Hole");
    expect(pattern).toHaveLength(5);
    for (const h of pattern.slice(1)) {
      expect(h.volumeMm3).toBeCloseTo(60000 - Math.PI * 9 * 10, 0);
    }

    // 4. M11 proof: ONE Undo removes all four pattern holes (not four).
    await window.locator('button[title^="Undo"]').click();
    await expect
      .poll(async () => ((await snapOf(window)) as Snapshot).bodies.length, {
        timeout: 20000,
      })
      .toBe(2);
    await window.locator('button[title^="Redo"]').click();
    await expect
      .poll(async () => ((await snapOf(window)) as Snapshot).bodies.length, {
        timeout: 20000,
      })
      .toBe(6);

    // 5. R2 fillet on a box edge through the real command path.
    await window.evaluate(
      ({ f }) =>
        (
          window as unknown as {
            __kreoda_test: {
              selectEdge: (id: string, suffix: string) => unknown;
            };
          }
        ).__kreoda_test.selectEdge(f, "edge.lin.box.+X~box.-Z"),
      { f: boxId },
    );
    await runBar(window, "fillet 2");
    await expect
      .poll(async () => ((await snapOf(window)) as Snapshot).bodies.length, {
        timeout: 30000,
      })
      .toBe(7);
    s = (await snapOf(window)) as Snapshot;
    const fillet = s.bodies.find((b) => b.type === "Fillet")!;
    expect(fillet.volumeMm3).toBeGreaterThan(0);

    // 6. Expression: width follows height; then edit the early dimension.
    await window.getByText(/Box 100×60×10/).first().click();
    await runBar(window, "set widthMm =heightMm * 2");
    s = (await snapOf(window)) as Snapshot;
    let box = s.bodies.find((b) => b.id === boxId)!;
    expect(box.paramsMm[0]).toBeCloseTo(120, 6);
    expect(box.expressions["widthMm"]).toBe("heightMm * 2");
    await window.getByText(/Box 120×60×10/).first().click();
    await runBar(window, "set heightMm 100");
    s = (await snapOf(window)) as Snapshot;
    box = s.bodies.find((b) => b.id === boxId)!;
    expect(box.paramsMm[1]).toBeCloseTo(100, 6);
    expect(box.paramsMm[0]).toBeCloseTo(200, 6);
    // Depth-10 through-holes remove the same tool volume after reflow.
    const holeAfter = s.bodies.find(
      (b) => b.type === "Hole" && b.id === hole.id,
    )!;
    expect(holeAfter.volumeMm3).toBeCloseTo(
      200 * 100 * 10 - Math.PI * 16 * 10,
      0,
    );

    // 7. Undo the height edit (width reflows back), redo forward.
    await window.locator('button[title^="Undo"]').click();
    await expect
      .poll(async () => {
        const cur = (await snapOf(window)) as Snapshot;
        return cur.bodies.find((b) => b.id === boxId)!.paramsMm[1];
      }, { timeout: 20000 })
      .toBeCloseTo(60, 6);
    await window.locator('button[title^="Redo"]').click();
    await expect
      .poll(async () => {
        const cur = (await snapOf(window)) as Snapshot;
        return cur.bodies.find((b) => b.id === boxId)!.paramsMm[1];
      }, { timeout: 20000 })
      .toBeCloseTo(100, 6);

    // 8. Save → reopen: ids stable, formula retained.
    await window.evaluate(
      ({ icad }) =>
        (
          window as unknown as {
            __kreoda_test: { saveIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.saveIcad(icad),
      { icad: ICAD_A },
    );
    s = (await window.evaluate(
      ({ icad }) =>
        (
          window as unknown as {
            __kreoda_test: { openIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.openIcad(icad),
      { icad: ICAD_A },
    )) as Snapshot;
    expect(s.bodies).toHaveLength(7);
    const reopenedBox = s.bodies.find((b) => b.id === boxId)!;
    expect(reopenedBox.expressions["widthMm"]).toBe("heightMm * 2");
    expect(reopenedBox.paramsMm[0]).toBeCloseTo(200, 6);

    // 9. Post-reopen cut must be EXACT (compound-label regression guard).
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
    s = (await window.evaluate(
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
        ).__kreoda_test.makeHole(target, "box.+Z", 150, 50, 8),
      { target: boxId },
    )) as Snapshot;
    const fresh = s.bodies[s.bodies.length - 1]!;
    expect(fresh.type).toBe("Hole");
    expect(fresh.volumeMm3).toBeCloseTo(
      200 * 100 * 10 - Math.PI * 16 * 10,
      0,
    );

    // 10. STEP export → file on disk → reimport.
    await window.evaluate(
      ({ step }) =>
        (
          window as unknown as {
            __kreoda_test: { saveIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.saveIcad(step),
      { step: STEP_A },
    );
    expect(fs.existsSync(STEP_A)).toBe(true);
    expect(fs.statSync(STEP_A).size).toBeGreaterThan(1000);
    s = (await window.evaluate(
      ({ step }) =>
        (
          window as unknown as {
            __kreoda_test: { openIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.openIcad(step),
      { step: STEP_A },
    )) as Snapshot;
    expect(s.bodies.length).toBeGreaterThanOrEqual(7);
    for (const b of s.bodies) expect(b.volumeMm3).toBeGreaterThan(0);

    await window.screenshot({ path: path.join(HERE, "phase10-golden-a.png") });
  } finally {
    await app.close();
  }
});

// Workflow B — rigid assembly: source edit reflows the placed instance,
// assembly persists across save/reopen (Phase 9d slice of §10.2).
test("golden B: assembly follows source edits across reopen", async () => {
  const { app, window } = await boot();
  try {
    const snap = (): Promise<Snapshot> => snapOf(window);
    await runBar(window, "box 100 60 10");
    await expect
      .poll(async () => ((await snap()) as Snapshot).bodies.length, {
        timeout: 30000,
      })
      .toBe(1);
    let s = (await snap()) as Snapshot;
    const boxId = s.bodies[0]!.id;

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

    // Widen the source: the instance must reflow to the same volume.
    await window.evaluate(
      ({ id }) =>
        (
          window as unknown as {
            __kreoda_test: {
              setParam: (f: string, p: string, v: number) => Promise<Snapshot>;
            };
          }
        ).__kreoda_test.setParam(id, "widthMm", 150),
      { id: boxId },
    );
    s = (await snap()) as Snapshot;
    const src = s.bodies.find((b) => b.id === boxId)!;
    const inst = s.bodies.find((b) => b.type === "Instance")!;
    expect(src.volumeMm3).toBeCloseTo(150 * 60 * 10, 0);
    expect(inst.volumeMm3).toBeCloseTo(src.volumeMm3, 0);

    await window.evaluate(
      ({ icad }) =>
        (
          window as unknown as {
            __kreoda_test: { saveIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.saveIcad(icad),
      { icad: ICAD_B },
    );
    s = (await window.evaluate(
      ({ icad }) =>
        (
          window as unknown as {
            __kreoda_test: { openIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.openIcad(icad),
      { icad: ICAD_B },
    )) as Snapshot;
    expect(s.bodies).toHaveLength(2);
    const reopened = s.bodies.find((b) => b.type === "Instance")!;
    expect(reopened.volumeMm3).toBeCloseTo(150 * 60 * 10, 0);

    await window.screenshot({ path: path.join(HERE, "phase10-golden-b.png") });
  } finally {
    await app.close();
  }
});

// Workflow C — reference Stage A (adapted): reference planes are
// session-scoped view aids by design (not persisted), so "verify
// calibration" means the calibrated plane survives the session while the
// traced geometry persists across save/reopen.
test("golden C: calibrated reference sizes traced geometry", async () => {
  const { app, window } = await boot();
  try {
    const dataUrl = (await window.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 200;
      c.height = 100;
      const g = c.getContext("2d")!;
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, 200, 100);
      g.fillStyle = "#000000";
      g.fillRect(0, 0, 100, 100);
      return c.toDataURL("image/png");
    })) as string;

    const plane = (await window.evaluate(
      ({ url }) =>
        (
          window as unknown as {
            __kreoda_test: {
              addReference: (u: string, w: number, h: number) => Promise<{
                id: string;
                widthMm: number;
                mmPerPx: number | null;
              }>;
            };
          }
        ).__kreoda_test.addReference(url, 200, 100),
      { url: dataUrl },
    )) as { id: string; widthMm: number; mmPerPx: number | null };
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
              ) => Promise<{
                widthMm: number;
                heightMm: number;
                mmPerPx: number;
              }>;
            };
          }
        ).__kreoda_test.calibrateReference(id, [0, 0], [200, 0], 100),
      { id: plane.id },
    )) as { widthMm: number; heightMm: number; mmPerPx: number };
    // 200 px = 100 mm → 0.5 mm/px, plane 100×50 mm: trace a matching plate.
    expect(calibrated.mmPerPx).toBeCloseTo(0.5, 9);
    await runBar(
      window,
      `box ${calibrated.widthMm} ${calibrated.heightMm} 10`,
    );
    await expect
      .poll(async () => ((await snapOf(window)) as Snapshot).bodies.length, {
        timeout: 30000,
      })
      .toBe(1);
    const s = (await snapOf(window)) as Snapshot;
    expect(s.bodies[0]!.volumeMm3).toBeCloseTo(100 * 50 * 10, 1);

    await window.evaluate(
      ({ icad }) =>
        (
          window as unknown as {
            __kreoda_test: { saveIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.saveIcad(icad),
      { icad: ICAD_A },
    );
    const reopened = (await window.evaluate(
      ({ icad }) =>
        (
          window as unknown as {
            __kreoda_test: { openIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.openIcad(icad),
      { icad: ICAD_A },
    )) as Snapshot;
    expect(reopened.bodies).toHaveLength(1);
    expect(reopened.bodies[0]!.volumeMm3).toBeCloseTo(100 * 50 * 10, 1);

    await window.screenshot({ path: path.join(HERE, "phase10-golden-c.png") });
  } finally {
    await app.close();
  }
});
