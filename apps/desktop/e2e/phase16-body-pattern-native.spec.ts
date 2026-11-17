import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, runBar, snapOf } from "./helpers";

test("body context Linear pattern creates a native pattern body and survives Undo/Redo", async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kreoda-body-pattern-e2e-"));
  const { app, window } = await boot({ KREODA_BACKGROUND_TEST: "1" }, [`--user-data-dir=${profile}`]);
  try {
    await runBar(window, "box 20 10 5");
    await expect.poll(async () => (await snapOf(window)).bodies.length, { timeout: 30000 }).toBe(1);
    const box = (await snapOf(window)).bodies[0]!;
    await window.evaluate(ids => (window as unknown as {
      __kreoda_test: { selectMany: (ids: string[]) => unknown };
    }).__kreoda_test.selectMany(ids), [box.id]);
    const bar = window.getByTestId("context-toolbar");
    const patternAction = bar.getByRole("button", { name: "Linear pattern" });
    await expect(patternAction).toBeVisible({ timeout: 5000 });
    await patternAction.click();
    const dialog = window.getByTestId("body-pattern-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.getByTestId("body-pattern-count").fill("3");
    await dialog.getByTestId("body-pattern-spacing").fill("20");
    await dialog.getByRole("button", { name: "Pattern" }).click();
    await expect(dialog).toBeHidden({ timeout: 60000 });
    await expect.poll(async () => (await snapOf(window)).bodies.some(body => body.type === "BodyPattern"), {
      timeout: 60000,
    }).toBe(true);
    const pattern = (await snapOf(window)).bodies.find(body => body.type === "BodyPattern")!;
    expect(pattern.volumeMm3).toBeCloseTo(3000, 3);

    await window.evaluate(() => (window as unknown as {
      __kreoda_test: { configurationE2E: { undo: () => Promise<void> } };
    }).__kreoda_test.configurationE2E.undo());
    expect((await snapOf(window)).bodies.some(body => body.type === "BodyPattern")).toBe(false);
    await window.evaluate(() => (window as unknown as {
      __kreoda_test: { configurationE2E: { redo: () => Promise<void> } };
    }).__kreoda_test.configurationE2E.redo());
    expect((await snapOf(window)).bodies.some(body => body.type === "BodyPattern")).toBe(true);
  } finally {
    await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
