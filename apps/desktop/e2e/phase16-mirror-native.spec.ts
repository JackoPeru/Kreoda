import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, runBar, snapOf } from "./helpers";

test("body context Mirror creates a native mirrored body and survives Undo/Redo", async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kreoda-mirror-e2e-"));
  const { app, window } = await boot({ KREODA_BACKGROUND_TEST: "1" }, [`--user-data-dir=${profile}`]);
  try {
    await runBar(window, "box 100 60 10");
    await expect.poll(async () => (await snapOf(window)).bodies.length, { timeout: 30000 }).toBe(1);
    const before = await snapOf(window);
    const box = before.bodies[0]!;
    await window.evaluate(ids => (window as unknown as {
      __kreoda_test: { selectMany: (ids: string[]) => unknown };
    }).__kreoda_test.selectMany(ids), [box.id]);
    const bar = window.getByTestId("context-toolbar");
    const mirrorAction = bar.getByRole("button", { name: "Mirror" });
    await expect(mirrorAction).toBeVisible({ timeout: 5000 });
    await mirrorAction.click();
    const dialog = window.getByTestId("mirror-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.getByTestId("mirror-plane").selectOption("YZ");
    await dialog.getByRole("button", { name: "Mirror" }).click();
    await expect(dialog).toBeHidden({ timeout: 60000 });
    await expect.poll(async () => (await snapOf(window)).bodies.some(body => body.type === "Mirror"), {
      timeout: 60000,
    }).toBe(true);
    const mirrored = (await snapOf(window)).bodies.find(body => body.type === "Mirror")!;
    expect(mirrored.volumeMm3).toBeCloseTo(box.volumeMm3, 3);

    await window.evaluate(() => (window as unknown as {
      __kreoda_test: { configurationE2E: { undo: () => Promise<void> } };
    }).__kreoda_test.configurationE2E.undo());
    expect((await snapOf(window)).bodies.some(body => body.type === "Mirror")).toBe(false);
    await window.evaluate(() => (window as unknown as {
      __kreoda_test: { configurationE2E: { redo: () => Promise<void> } };
    }).__kreoda_test.configurationE2E.redo());
    expect((await snapOf(window)).bodies.some(body => body.type === "Mirror")).toBe(true);
  } finally {
    await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
