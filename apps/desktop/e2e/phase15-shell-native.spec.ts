import { test, expect } from "@playwright/test";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { boot, runBar, snapOf } from "./helpers";

test("face context Shell dialog hollows the native solid and Undo restores it", async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kreoda-shell-profile-"));
  const { app, window } = await boot({ KREODA_BACKGROUND_TEST: "1" }, [`--user-data-dir=${profile}`]);
  try {
    await runBar(window, "box 100 60 10");
    await expect.poll(async () => (await snapOf(window)).bodies.length, { timeout: 30000 }).toBe(1);
    const before = await snapOf(window);
    const box = before.bodies[0]!;
    const face = box.faces.find(id => id.endsWith(":box.+Z"));
    expect(face).toBeTruthy();
    await window.evaluate(({ f, r }) => (window as unknown as {
      __kreoda_test: { selectFace: (id: string, role: string) => unknown };
    }).__kreoda_test.selectFace(f, r), { f: box.id, r: face!.slice(face!.indexOf(":") + 1) });

    const bar = window.getByTestId("context-toolbar");
    const shellAction = bar.getByRole("button", { name: "Shell" });
    await expect(shellAction).toBeVisible({ timeout: 5000 });
    await shellAction.click();

    const thickness = window.getByLabel("Wall thickness (mm)");
    await expect(thickness).toBeVisible({ timeout: 5000 });
    await thickness.fill("2");
    await window.getByRole("button", { name: "Hollow" }).click();
    await expect(window.getByRole("dialog")).toBeHidden({ timeout: 60000 });
    await expect.poll(async () => (await snapOf(window)).bodies.some(body => body.type === "Shell"), {
      timeout: 60000,
    }).toBe(true);

    const after = await snapOf(window);
    const shell = after.bodies.find(body => body.type === "Shell");
    expect(shell).toBeTruthy();
    expect(Math.abs(shell!.volumeMm3 - 16992)).toBeLessThan(100);
    expect(shell!.paramsMm).toEqual([2]);
    expect(after.revision).toBeGreaterThan(before.revision);

    await window.evaluate(() => (window as unknown as {
      __kreoda_test: { configurationE2E: { undo: () => Promise<void> } };
    }).__kreoda_test.configurationE2E.undo());
    expect((await snapOf(window)).bodies.some(body => body.type === "Shell")).toBe(false);
    await window.evaluate(() => (window as unknown as {
      __kreoda_test: { configurationE2E: { redo: () => Promise<void> } };
    }).__kreoda_test.configurationE2E.redo());
    expect((await snapOf(window)).bodies.some(body => body.type === "Shell")).toBe(true);
  } finally {
    await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
