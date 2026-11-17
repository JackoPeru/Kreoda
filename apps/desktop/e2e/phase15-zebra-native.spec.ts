import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, openProperties, runBar, snapOf } from "./helpers";

test("native sphere reflection stripes compile, respond to controls and restore the original view without CAD edits", async ({}, info) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kreoda-zebra-"));
  const { app, window } = await boot({ KREODA_BACKGROUND_TEST: "1" }, [`--user-data-dir=${profile}`]);
  const shaderErrors: string[] = [];
  window.on("console", message => {
    if (/Shader Error|VALIDATE_STATUS|gl\.getProgramInfoLog|ERROR: 0:/.test(message.text())) shaderErrors.push(message.text());
  });
  try {
    await runBar(window, "sphere 60");
    await openProperties(window);
    const panel = window.getByTestId("zebra-analysis-panel");
    await panel.scrollIntoViewIfNeeded();
    const before = await snapOf(window);
    expect(before.bodies[0]!.type).toBe("Sphere");
    expect(before.bodies[0]!.volumeMm3).toBeCloseTo(4 / 3 * Math.PI * 60 ** 3, 2);
    const identity = () => window.evaluate(id => (window as unknown as {
      __kreoda_test: { meshIdentity: (id: string) => unknown }
    }).__kreoda_test.meshIdentity(id), before.bodies[0]!.id);
    const geometry = await identity();
    const rect = await window.getByTestId("viewport").evaluate(element => {
      const box = element.getBoundingClientRect();
      return { x: Math.round(box.x + box.width / 2 - 110), y: Math.round(box.y + box.height / 2 - 110), width: 220, height: 220 };
    });
    const capture = () => app.evaluate(async ({ BrowserWindow }, rect) => {
      const target = BrowserWindow.getAllWindows()[0]!;
      if (target.isVisible()) throw Error("Zebra test must remain hidden");
      await target.capturePage(rect, { stayHidden: true });
      const image = await target.capturePage(rect, { stayHidden: true });
      return { bitmap: image.toBitmap().toString("base64"), png: image.toPNG().toString("base64") };
    }, rect);
    const baseline = await capture();
    await panel.getByRole("checkbox", { name: "Analisi zebra" }).check();
    await expect(panel.getByLabel("Densità bande zebra")).toBeVisible();
    let striped = baseline;
    await expect.poll(async () => { striped = await capture(); return striped.bitmap !== baseline.bitmap; }).toBe(true);
    const pixels = Buffer.from(striped.bitmap, "base64");
    let bright = 0, dark = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (Math.min(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!) > 190) bright++;
      if (Math.max(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!) < 40) dark++;
    }
    expect(bright).toBeGreaterThan(500);
    expect(dark).toBeGreaterThan(500);
    fs.writeFileSync(info.outputPath("zebra-sphere.png"), Buffer.from(striped.png, "base64"));
    await panel.getByLabel("Densità bande zebra").fill("32");
    await panel.getByLabel("Orientamento zebra").fill("75");
    await expect.poll(async () => (await capture()).bitmap !== striped.bitmap).toBe(true);
    await panel.getByRole("checkbox", { name: "Analisi zebra" }).uncheck();
    await expect.poll(async () => (await capture()).bitmap === baseline.bitmap).toBe(true);
    expect(await identity()).toEqual(geometry);
    expect(await snapOf(window)).toEqual(before);
    expect(shaderErrors).toEqual([]);
    await panel.getByRole("checkbox", { name: "Analisi zebra" }).check();
    await expect(panel.getByLabel("Orientamento zebra")).toBeVisible();
    const direction = () => window.evaluate(() => (window as unknown as {
      __kreoda_test: { viewDir: () => number[] }
    }).__kreoda_test.viewDir());
    const beforeOrbit = await direction();
    await window.mouse.move(rect.x + 110, rect.y + 110);
    await window.mouse.down();
    await window.mouse.move(rect.x + 155, rect.y + 135, { steps: 5 });
    await window.mouse.up();
    expect(await direction()).not.toEqual(beforeOrbit);
    expect(await identity()).toEqual(geometry);
    expect((await snapOf(window)).revision).toBe(before.revision);
    const full = await app.evaluate(async ({ BrowserWindow }) => {
      const image = await BrowserWindow.getAllWindows()[0]!.capturePage(undefined, { stayHidden: true });
      return image.toPNG().toString("base64");
    });
    fs.writeFileSync(info.outputPath("zebra-controls.png"), Buffer.from(full, "base64"));
    fs.writeFileSync(info.outputPath("zebra-proof.json"), JSON.stringify({ brightPixels: bright, darkPixels: dark,
      revision: before.revision, volumeMm3: before.bodies[0]!.volumeMm3, geometry, shaderErrors, restoredBaseline: true }, null, 2));
  } finally {
    await app.close();
    if (!path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(profile).startsWith("kreoda-zebra-"))
      throw Error("Unexpected zebra test cleanup path");
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
