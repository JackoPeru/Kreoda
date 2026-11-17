import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, openMore, openProperties, runBar, snapOf } from "./helpers";

const TASK_TEMP = os.tmpdir();

test("direct face history uses a real viewport pick and survives save/open", async () => {
  test.setTimeout(120_000);
  const profile = fs.mkdtempSync(path.join(TASK_TEMP, "kreoda-direct-face-"));
  const saved = path.join(profile, "direct-face-history.icad");
  const { app, window } = await boot({
    KREODA_BACKGROUND_TEST: "1",
    KREODA_AUTOMATIC_LOOPBACK_TEST: "0",
    KREODA_SESSION_PORT: "",
    KREODA_SESSION_TOKEN: "",
  }, [`--user-data-dir=${profile}`]);
  try {
    await runBar(window, "box 20 20 20");
    const source = (await snapOf(window)).bodies.find(body => body.type === "Box")!;
    expect(source).toBeTruthy();
    const point = await window.evaluate(featureId => (window as unknown as {
      __kreoda_test: { faceScreenPoint: (id: string, role: string) => { x: number; y: number } | null };
    }).__kreoda_test.faceScreenPoint(featureId, "box.+Z"), source.id);
    expect(point, "read-only face anchor must resolve").toBeTruthy();
    await window.mouse.click(point!.x, point!.y);
    await expect.poll(async () => (await snapOf(window)).selectedIds)
      .toContain(`${source.id}:box.+Z`);

    await openProperties(window);
    const panel = window.getByTestId("direct-face-history-panel");
    await expect(panel).toBeVisible();
    await panel.getByTestId("direct-source-capture").click();
    await expect.poll(async () => {
      const owner = await panel.getByTestId("direct-source-owner").textContent();
      return owner === source.id || (await panel.getByRole("alert").count()) > 0;
    }).toBe(true);
    const captureError = await panel.getByRole("alert").allTextContents();
    await expect(panel.getByTestId("direct-source-owner"), `capture error: ${captureError.join(" | ")}`)
      .toHaveText(source.id);
    await panel.getByTestId("direct-translation-z").fill("1");
    const before = await snapOf(window);
    await panel.getByTestId("direct-apply").click();
    await expect.poll(async () => (await snapOf(window)).bodies.some(body => body.type === "MoveFace"))
      .toBe(true);
    const committed = await snapOf(window);
    const moved = committed.bodies.find(body => body.type === "MoveFace")!;
    expect(committed.revision).toBe(before.revision + 1);
    expect(moved.paramsMm.slice(0, 6)).toEqual([0, 0, 1, 0, 0, 0]);

    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = new Proxy(dialog.showSaveDialog, {
        apply: async () => ({ canceled: false, filePath: file }),
      });
      dialog.showOpenDialog = new Proxy(dialog.showOpenDialog, {
        apply: async () => ({ canceled: false, filePaths: [file] }),
      });
    }, saved);
    await window.getByTestId("workspace-actions").getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => fs.existsSync(saved)).toBe(true);
    await window.getByTestId("workspace-actions").getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await snapOf(window)).bodies.some(body => body.type === "MoveFace"))
      .toBe(false);

    await openMore(window);
    await window.getByTestId("more-menu").getByRole("button", { name: "Open", exact: true }).click();
    await expect.poll(async () => (await snapOf(window)).bodies.some(body => body.type === "MoveFace"))
      .toBe(true);
    expect((await snapOf(window)).bodies.find(body => body.type === "MoveFace")?.paramsMm)
      .toEqual(moved.paramsMm);
  } finally {
    await app.close();
  }
});
