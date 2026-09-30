import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, openProject, runBar, snapOf } from "./helpers";

test("upstream hole: history action rebuilds the original tip, undo and reopen", async ({}, testInfo) => {
  const { app, window } = await boot();
  const childProcess = app.process();
  let stderr = "";
  const collect = (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-200_000); };
  childProcess.stderr?.on("data", collect);
  const file = path.join(os.tmpdir(), `kreoda-upstream-${childProcess.pid}.icad`);
  try {
    await runBar(window, "box 100 60 10");
    const plate = (await snapOf(window)).bodies[0]!;
    await window.evaluate(id => (window as unknown as {
      __kreoda_test: { selectEdge: (id: string, role: string) => unknown };
    }).__kreoda_test.selectEdge(id, "edge.lin.box.+X~box.+Z"), plate.id);
    await runBar(window, "fillet 1");
    const rounded = (await snapOf(window)).bodies.find(b => b.type === "Fillet")!;
    await openProject(window);
    await window.getByTestId(`insert-hole-after-${plate.id}`).click();
    const dialog = window.getByRole("dialog", { name: "Make hole" });
    await expect(dialog.getByRole("checkbox")).toBeChecked();
    await expect(dialog).toContainText("Insert before Fillet");
    await dialog.getByRole("button", { name: "Cut hole", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    let snapshot = await snapOf(window);
    const hole = snapshot.bodies.find(b => b.type === "Hole")!;
    expect(snapshot.treeBodies![0]!.history).toEqual([plate.id, hole.id, rounded.id]);
    await expect(window.getByTestId("object-tree-history")).toHaveText("Box → Hole → Fillet");
    expect(snapshot.tips).toEqual([rounded.id]);
    expect(snapshot.bodies.find(b => b.id === rounded.id)!.volumeMm3)
      .toBeCloseTo(rounded.volumeMm3 - Math.PI * 16 * 10, 0);
    await window.locator('button[title^="Undo"]').click();
    await expect.poll(async () => (await snapOf(window)).bodies.length).toBe(2);
    await window.locator('button[title^="Redo"]').click();
    await expect.poll(async () => (await snapOf(window)).bodies.length).toBe(3);
    await window.evaluate(file => (window as unknown as {
      __kreoda_test: { saveIcad: (file: string) => Promise<unknown> };
    }).__kreoda_test.saveIcad(file), file);
    await window.evaluate(file => (window as unknown as {
      __kreoda_test: { openIcad: (file: string) => Promise<unknown> };
    }).__kreoda_test.openIcad(file), file);
    snapshot = await snapOf(window);
    expect(snapshot.treeBodies![0]!.history).toEqual([plate.id, hole.id, rounded.id]);
    await expect(window.getByTestId("object-tree-history")).toHaveText("Box → Hole → Fillet");
    expect(snapshot.tips).toEqual([rounded.id]);
    // Another insertion after reopen fetches the historical face mesh lazily.
    await window.getByTestId(`insert-hole-after-${plate.id}`).click();
    await dialog.getByLabel("X on face (mm)").fill("20");
    await dialog.getByLabel("Y on face (mm)").fill("20");
    await dialog.getByRole("button", { name: "Cut hole", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    snapshot = await snapOf(window);
    expect(snapshot.treeBodies![0]!.history).toHaveLength(4);
    expect(snapshot.tips).toEqual([rounded.id]);
  } finally {
    await app.close();
    childProcess.stderr?.off("data", collect);
    await testInfo.attach("upstream-sidecar-stderr", { body: Buffer.from(stderr), contentType: "text/plain" });
    fs.rmSync(file, { force: true });
  }
});
