// Phase 10 §10.8 scripted beginner-flow smoke. This exercises the real
// Electron + core command path; it is not a human usability audit.

import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, runBar, snapOf, type Snapshot } from "./helpers";

const ICAD = path.join(
  os.tmpdir(),
  `kreoda-phase10-beginner-flow-${process.pid}.icad`,
);
const STEP = path.join(
  os.tmpdir(),
  `kreoda-phase10-beginner-flow-${process.pid}.step`,
);

async function selectFace(
  window: Page,
  featureId: string,
  role: string,
): Promise<void> {
  await window.evaluate(
    ({ id, faceRole }) =>
      (
        window as unknown as {
          __kreoda_test: {
            selectFace: (featureId: string, role: string) => unknown;
          };
        }
      ).__kreoda_test.selectFace(id, faceRole),
    { id: featureId, faceRole: role },
  );
}

async function selectMany(window: Page, ids: string[]): Promise<void> {
  await window.evaluate(
    (selected) =>
      (
        window as unknown as {
          __kreoda_test: { selectMany: (ids: string[]) => unknown };
        }
      ).__kreoda_test.selectMany(selected),
    ids,
  );
}

async function saveIcad(window: Page, filePath: string): Promise<Snapshot> {
  return (await window.evaluate(
    (targetPath) =>
      (
        window as unknown as {
          __kreoda_test: {
            saveIcad: (filePath: string) => Promise<Snapshot>;
          };
        }
      ).__kreoda_test.saveIcad(targetPath),
    filePath,
  )) as Snapshot;
}

async function openIcad(window: Page, filePath: string): Promise<Snapshot> {
  return (await window.evaluate(
    (targetPath) =>
      (
        window as unknown as {
          __kreoda_test: {
            openIcad: (filePath: string) => Promise<Snapshot>;
          };
        }
      ).__kreoda_test.openIcad(targetPath),
    filePath,
  )) as Snapshot;
}

function byType(snapshot: Snapshot, type: string) {
  const body = snapshot.bodies.find((item) => item.type === type);
  expect(body, `expected one ${type} feature`).toBeDefined();
  return body!;
}

test("phase 10 beginner flow: block, centered hole, four R3 rounds, edit and export", async () => {
  test.slow();
  const started = Date.now();
  const dialogs: string[] = [];
  const { app, window } = await boot();

  try {
    fs.rmSync(ICAD, { force: true });
    fs.rmSync(STEP, { force: true });

    // 100×60×10 block through the command bar.
    await runBar(window, "box 100 60 10");
    await expect
      .poll(async () => (await snapOf(window)).bodies.length, {
        timeout: 30000,
      })
      .toBe(1);
    let snapshot = await snapOf(window);
    const box = byType(snapshot, "Box");
    const boxId = box.id;
    expect(box.paramsMm.slice(0, 3)).toEqual([100, 60, 10]);
    expect(box.volumeMm3).toBeCloseTo(60000, 3);

    // The preview exposes the actual default face center. The native core
    // then creates a through-hole of Ø8 at those visible coordinates.
    await selectFace(window, boxId, "box.+Z");
    const toolbar = window.getByTestId("context-toolbar");
    await toolbar.getByRole("button", { name: "Hole" }).click();
    const holeDialog = window.getByRole("dialog");
    await expect(holeDialog.getByRole("heading", { name: "Make hole" })).toBeVisible();
    await expect(holeDialog.getByText(/position defaults to face center/)).toBeVisible();
    dialogs.push("Make hole");
    await holeDialog.getByLabel("Diameter (mm)").fill("8");
    const xOnFace = holeDialog.getByLabel("X on face (mm)");
    const yOnFace = holeDialog.getByLabel("Y on face (mm)");
    await expect(holeDialog.getByTestId("hole-placement-preview")).toBeVisible();
    await expect(xOnFace).toHaveValue("50");
    await expect(yOnFace).toHaveValue("30");
    await holeDialog.getByRole("button", { name: "Cut hole" }).click();
    await expect(holeDialog).toBeHidden({ timeout: 30000 });
    await expect
      .poll(async () => (await snapOf(window)).bodies.length, {
        timeout: 30000,
      })
      .toBe(2);
    snapshot = await snapOf(window);
    const hole = byType(snapshot, "Hole");
    expect(hole.paramsMm[0]).toBeCloseTo(8, 6);
    expect(hole.volumeMm3).toBeCloseTo(60000 - Math.PI * 16 * 10, 0);

    // Four vertical corner edges retain box axis-face roles in the Hole
    // shape. The existing additive-selection hook feeds the normal context
    // toolbar and typed core command; the dialog itself confirms four edges.
    const cornerEdges = [
      "edge.lin.box.+X~box.+Y",
      "edge.lin.box.+X~box.-Y",
      "edge.lin.box.+Y~box.-X",
      "edge.lin.box.-X~box.-Y",
    ].map((role) => `${hole.id}:${role}`);
    await selectMany(window, cornerEdges);
    await toolbar.getByRole("button", { name: "Round" }).click();
    const roundDialog = window.getByRole("dialog");
    await expect(roundDialog.getByRole("heading", { name: "Round edge" })).toBeVisible();
    await expect(roundDialog.getByText("4 edges selected.")).toBeVisible();
    dialogs.push("Round edge (4 edges)");
    await expect(roundDialog.getByLabel("Radius (mm)")).toHaveValue("3");
    await roundDialog.getByRole("button", { name: "Round" }).click();
    await expect(roundDialog).toBeHidden({ timeout: 30000 });
    await expect
      .poll(async () => (await snapOf(window)).bodies.length, {
        timeout: 30000,
      })
      .toBe(3);
    snapshot = await snapOf(window);
    let fillet = byType(snapshot, "Fillet");
    expect(fillet.paramsMm[0]).toBeCloseTo(3, 6);
    const expectedAtWidth100 =
      60000 -
      Math.PI * 16 * 10 -
      4 * (1 - Math.PI / 4) * 3 * 3 * 10;
    expect(fillet.volumeMm3).toBeCloseTo(expectedAtWidth100, 0);
    expect(snapshot.tips).toEqual([fillet.id]);

    // Select the source box and edit its width through the typed command.
    await selectMany(window, [boxId]);
    await runBar(window, "set widthMm 120");
    snapshot = await snapOf(window);
    expect(byType(snapshot, "Box").paramsMm[0]).toBeCloseTo(120, 6);
    expect(byType(snapshot, "Box").volumeMm3).toBeCloseTo(72000, 0);
    expect(byType(snapshot, "Hole").volumeMm3).toBeCloseTo(
      72000 - Math.PI * 16 * 10,
      0,
    );
    fillet = byType(snapshot, "Fillet");
    const expectedAtWidth120 =
      72000 -
      Math.PI * 16 * 10 -
      4 * (1 - Math.PI / 4) * 3 * 3 * 10;
    expect(fillet.volumeMm3).toBeCloseTo(expectedAtWidth120, 0);

    // Undo and redo the width edit; downstream hole and four-edge fillet
    // must recompute with the source dimension each time.
    const actions = window.getByTestId("workspace-actions");
    await actions.getByRole("button", { name: "Undo" }).click();
    await expect
      .poll(async () => (await snapOf(window)).bodies.find((b) => b.id === boxId)!.paramsMm[0], {
        timeout: 20000,
      })
      .toBeCloseTo(100, 6);
    snapshot = await snapOf(window);
    expect(byType(snapshot, "Hole").volumeMm3).toBeCloseTo(
      60000 - Math.PI * 16 * 10,
      0,
    );
    expect(byType(snapshot, "Fillet").volumeMm3).toBeCloseTo(
      expectedAtWidth100,
      0,
    );

    await actions.getByRole("button", { name: "Redo" }).click();
    await expect
      .poll(async () => (await snapOf(window)).bodies.find((b) => b.id === boxId)!.paramsMm[0], {
        timeout: 20000,
      })
      .toBeCloseTo(120, 6);
    snapshot = await snapOf(window);
    expect(byType(snapshot, "Fillet").volumeMm3).toBeCloseTo(
      expectedAtWidth120,
      0,
    );

    // Save and STEP export use the existing real coreClient.saveDocument
    // test hook with explicit paths, so the native file picker is not opened.
    const saved = await saveIcad(window, ICAD);
    expect(fs.existsSync(ICAD)).toBe(true);
    expect(fs.statSync(ICAD).size).toBeGreaterThan(0);
    expect(byType(saved, "Box").paramsMm[0]).toBeCloseTo(120, 6);

    const reopened = await openIcad(window, ICAD);
    expect(byType(reopened, "Box").paramsMm[0]).toBeCloseTo(120, 6);
    expect(byType(reopened, "Hole").volumeMm3).toBeCloseTo(
      72000 - Math.PI * 16 * 10,
      0,
    );
    expect(byType(reopened, "Fillet").volumeMm3).toBeCloseTo(
      expectedAtWidth120,
      0,
    );

    const beforeExport = reopened.bodies.map((body) => body.volumeMm3);
    await saveIcad(window, STEP);
    expect(fs.existsSync(STEP)).toBe(true);
    expect(fs.statSync(STEP).size).toBeGreaterThan(1000);
    expect((await snapOf(window)).bodies.map((body) => body.volumeMm3)).toEqual(
      beforeExport,
    );
  } finally {
    // eslint-disable-next-line no-console
    console.log(
      `PHASE10_BEGINNER_FLOW ${JSON.stringify({ elapsed_ms: Date.now() - started, dialogs })}`,
    );
    await app.close();
  }
});
