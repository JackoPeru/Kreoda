import { test, expect } from "@playwright/test";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { boot, openMore, snapOf } from "./helpers";

test("reference detection proposes an editable sketch from lines and circles", async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kreoda-reference-vision-"));
  const { app, window } = await boot({ KREODA_BACKGROUND_TEST: "1" }, [`--user-data-dir=${profile}`]);
  try {
    const dataUrl = (await window.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 200;
      canvas.height = 120;
      const g = canvas.getContext("2d")!;
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, 200, 120);
      g.fillStyle = "#000000";
      g.strokeStyle = "#000000";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(20, 40);
      g.lineTo(180, 40);
      g.stroke();
      g.beginPath();
      g.moveTo(100, 20);
      g.lineTo(100, 100);
      g.stroke();
      g.beginPath();
      g.arc(150, 70, 20, 0, 2 * Math.PI);
      g.stroke();
      return canvas.toDataURL("image/png");
    })) as string;
    expect(dataUrl.startsWith("data:image/png")).toBe(true);

    const plane = (await window.evaluate(
      ({ url }) => (window as unknown as {
        __kreoda_test: { addReference: (u: string, w: number, h: number) => Promise<{ id: string }> };
      }).__kreoda_test.addReference(url, 200, 120),
      { url: dataUrl },
    )) as { id: string };
    await window.evaluate(
      ({ id }) => (window as unknown as {
        __kreoda_test: {
          calibrateReference: (rid: string, p1: [number, number], p2: [number, number], real: number) => Promise<unknown>;
        };
      }).__kreoda_test.calibrateReference(id, [0, 0], [200, 0], 100),
      { id: plane.id },
    );

    await openMore(window);
    await window.getByTestId("reference-button").click();
    await expect(window.getByTestId("reference-dialog")).toBeVisible({ timeout: 5000 });
    await window.getByTestId("reference-detect").click();
    const detection = window.getByTestId("reference-detection");
    await expect(detection).toBeVisible({ timeout: 30000 });
    await expect(detection).toContainText(/\d+ lines, \d+ circles/);
    await window.getByTestId("reference-create-sketch").click();
    await expect(window.getByTestId("reference-dialog")).toBeHidden({ timeout: 60000 });

    await expect.poll(async () => (await snapOf(window)).sketches.length, { timeout: 60000 }).toBe(1);
    const sketch = (await snapOf(window)).sketches[0]!;
    expect(sketch.lines ?? 0).toBeGreaterThanOrEqual(2);
    expect(sketch.circles ?? 0).toBeGreaterThanOrEqual(1);
    expect(sketch.points).toBeGreaterThanOrEqual(4);
  } finally {
    await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
