import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, openProject, openProperties, runBar, snapOf } from "./helpers";

test("pattern count: panel, undo, formula and save/reopen preserve authored centers", async () => {
  const { app, window } = await boot();
  const file = path.join(os.tmpdir(), `kreoda-pattern-count-${process.pid}.icad`);
  try {
    await runBar(window, "box 100 60 10");
    const plate = (await snapOf(window)).bodies[0]!;
    await openProject(window);
    await window.getByTestId(`object-tree-${plate.id}`).click();
    await runBar(window, "holes 6 4 corners 8");
    const pattern = (await snapOf(window)).bodies.find(b => b.type === "HolePattern")!;
    expect(pattern.paramsMm).toEqual([6, 0, 4]);
    await window.getByTestId(`object-tree-${pattern.id}`).click();
    await openProperties(window);
    const panel = window.getByTestId("properties");
    const count = panel.getByLabel("Hole count", { exact: true });
    await expect(count).toHaveValue("4");
    await expect(panel.getByLabel(/Depth/)).toHaveCount(0);
    await count.fill("2");
    await count.press("Enter");
    const current = async () => (await snapOf(window)).bodies.find(b => b.id === pattern.id)!;
    await expect.poll(async () => (await current()).paramsMm[2]).toBe(2);
    expect((await current()).volumeMm3).toBeCloseTo(60000 - 2 * Math.PI * 9 * 10, 0);
    await window.locator('button[title^="Undo"]').click();
    await expect.poll(async () => (await current()).paramsMm[2]).toBe(4);
    await window.locator('button[title^="Redo"]').click();
    await expect.poll(async () => (await current()).paramsMm[2]).toBe(2);
    await window.getByTestId(`object-tree-${pattern.id}`).click();
    const countChip = window.getByTestId("dimension-chips").locator('button[data-param="count"]');
    await expect(countChip).toBeVisible();
    await expect(countChip).toHaveText("N 2");
    await countChip.click();
    const chipInput = countChip.locator("input");
    await expect(chipInput).toHaveAttribute("placeholder", "Hole count");
    await chipInput.fill("4");
    await chipInput.press("Enter");
    await expect.poll(async () => (await current()).paramsMm[2]).toBe(4);
    await window.locator('button[title^="Undo"]').click();
    await expect.poll(async () => (await current()).paramsMm[2]).toBe(2);
    await window.getByTestId(`object-tree-${pattern.id}`).click();
    await runBar(window, "set count = 1+2");
    expect((await current()).paramsMm[2]).toBe(3);
    expect((await current()).expressions.count).toBe("1+2");
    await window.evaluate(file => (window as unknown as {
      __kreoda_test: { saveIcad: (file: string) => Promise<unknown> };
    }).__kreoda_test.saveIcad(file), file);
    await window.evaluate(file => (window as unknown as {
      __kreoda_test: { openIcad: (file: string) => Promise<unknown> };
    }).__kreoda_test.openIcad(file), file);
    expect((await current()).paramsMm[2]).toBe(3);
    expect((await current()).expressions.count).toBe("1+2");
    expect((await current()).volumeMm3).toBeCloseTo(60000 - 3 * Math.PI * 9 * 10, 0);
    await window.getByTestId(`object-tree-${pattern.id}`).click();
    if (!(await window.getByTestId("properties-drawer").isVisible())) await openProperties(window);
    await panel.getByLabel("Hole count", { exact: true }).fill("2");
    await panel.getByLabel("Hole count", { exact: true }).press("Enter");
    await expect.poll(async () => (await current()).paramsMm[2]).toBe(2);
    expect((await current()).expressions.count).toBeUndefined();
    await window.locator('button[title^="Undo"]').click();
    await expect.poll(async () => (await current()).paramsMm[2]).toBe(3);
    expect((await current()).expressions.count).toBe("1+2");
  } finally {
    await app.close();
    fs.rmSync(file, { force: true });
  }
});
