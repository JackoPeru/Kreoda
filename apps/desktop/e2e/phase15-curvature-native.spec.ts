import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, openProperties, runBar, snapOf } from "./helpers";

test("native curvature reaches the real GPU, uses physical scale and restores the original model view", async ({}, info) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kreoda-curvature-"));
  const { app, window } = await boot({ KREODA_BACKGROUND_TEST: "1" }, [`--user-data-dir=${profile}`]);
  const shaderErrors: string[] = [];
  window.on("console", message => {
    if (/Shader Error|VALIDATE_STATUS|gl\.getProgramInfoLog|ERROR: 0:/.test(message.text())) shaderErrors.push(message.text());
  });
  try {
    await runBar(window, "sphere 60");
    await openProperties(window);
    const panel = window.getByTestId("curvature-analysis-panel");
    await panel.scrollIntoViewIfNeeded();
    const before = await snapOf(window);
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
      if (target.isVisible()) throw Error("Curvature test must remain hidden");
      await target.capturePage(rect, { stayHidden: true });
      const image = await target.capturePage(rect, { stayHidden: true });
      return { bitmap: image.toBitmap().toString("base64"), png: image.toPNG().toString("base64") };
    }, rect);
    const baseline = await capture();
    await panel.getByRole("checkbox", { name: "Analisi curvatura" }).check();
    await expect(panel.getByLabel("Legenda curvatura")).toContainText("mm⁻¹");
    await panel.getByRole("button", { name: "Scala automatica" }).click();
    const maximumPerMm = Number(await panel.getByLabel("Massimo curvatura mm inversi").inputValue());
    expect(maximumPerMm).toBeCloseTo(1 / 60, 7);
    let heated = baseline;
    await expect.poll(async () => { heated = await capture(); return heated.bitmap !== baseline.bitmap; }).toBe(true);
    const pixels = Buffer.from(heated.bitmap, "base64");
    let redPixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4)
      if (pixels[offset + 2]! > 120 && pixels[offset + 2]! > pixels[offset + 1]! * 1.5 && pixels[offset + 2]! > pixels[offset]! * 1.5) redPixels++;
    expect(redPixels).toBeGreaterThan(1000);
    fs.writeFileSync(info.outputPath("curvature-sphere.png"), Buffer.from(heated.png, "base64"));
    const full = await app.evaluate(async ({ BrowserWindow }) => {
      const image = await BrowserWindow.getAllWindows()[0]!.capturePage(undefined, { stayHidden: true });
      return image.toPNG().toString("base64");
    });
    fs.writeFileSync(info.outputPath("curvature-controls.png"), Buffer.from(full, "base64"));
    await panel.getByLabel("Massimo curvatura mm inversi").fill("0.05");
    await expect.poll(async () => (await capture()).bitmap !== heated.bitmap).toBe(true);
    const zebra = window.getByRole("checkbox", { name: "Analisi zebra" });
    await zebra.check();
    await expect(panel.getByRole("checkbox")).not.toBeChecked();
    await panel.getByRole("checkbox").check();
    await expect(zebra).not.toBeChecked();
    await panel.getByRole("checkbox").uncheck();
    await expect.poll(async () => (await capture()).bitmap === baseline.bitmap).toBe(true);
    expect(await identity()).toEqual(geometry);
    expect(await snapOf(window)).toEqual(before);
    expect(shaderErrors).toEqual([]);
    fs.writeFileSync(info.outputPath("curvature-proof.json"), JSON.stringify({ maximumPerMm, redPixels,
      revision: before.revision, volumeMm3: before.bodies[0]!.volumeMm3, geometry, shaderErrors, restoredBaseline: true }, null, 2));
  } finally {
    await app.close();
    if (!path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(profile).startsWith("kreoda-curvature-"))
      throw Error("Unexpected curvature test cleanup path");
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
