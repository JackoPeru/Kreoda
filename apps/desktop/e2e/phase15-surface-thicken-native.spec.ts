import { test, expect } from "@playwright/test";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { boot, runBar, snapOf } from "./helpers";

test("native STEP face thickening is a persistent editable independent solid", async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kreoda-thicken-profile-"));
  const step = path.join(profile, "import.step");
  const saved = path.join(profile, "surface-thicken.icad");
  const { app, window } = await boot({ KREODA_BACKGROUND_TEST: "1" }, [`--user-data-dir=${profile}`]);
  try {
    await runBar(window, "box 100 60 10");
    await window.evaluate(file => (window as unknown as { __kreoda_test: { saveIcad: (p: string) => Promise<unknown> } }).__kreoda_test.saveIcad(file), step);
    await window.evaluate(file => (window as unknown as { __kreoda_test: { openIcad: (p: string) => Promise<unknown> } }).__kreoda_test.openIcad(file), step);
    const before = await snapOf(window);
    const source = before.bodies.find(body => body.type === "StepImport")!;
    const face = source.faces.find(id => id.endsWith(":box.+Z"));
    expect(face).toBeTruthy();
    await window.evaluate(({ owner, persistentFaceId }) => (window as unknown as {
      __kreoda_test: { surfaceFaceThickenE2E: (owner: string, face: string, thick: number) => Promise<void> };
    }).__kreoda_test.surfaceFaceThickenE2E(owner, persistentFaceId, 3), { owner: source.id, persistentFaceId: face! });
    const after = await snapOf(window);
    expect(after.bodies.some(body => body.type === "SurfaceFaceThicken" && Math.abs(body.volumeMm3 - 18000) < 1e-3)).toBe(true);
    await window.evaluate(() => (window as unknown as { __kreoda_test: { configurationE2E: { undo: () => Promise<void> } } }).__kreoda_test.configurationE2E.undo());
    expect((await snapOf(window)).bodies.some(body => body.type === "SurfaceFaceThicken")).toBe(false);
    await window.evaluate(() => (window as unknown as { __kreoda_test: { configurationE2E: { redo: () => Promise<void> } } }).__kreoda_test.configurationE2E.redo());
    expect((await snapOf(window)).bodies.some(body => body.type === "SurfaceFaceThicken")).toBe(true);
    await window.evaluate(file => (window as unknown as { __kreoda_test: { saveIcad: (p: string) => Promise<unknown> } }).__kreoda_test.saveIcad(file), saved);
    await window.evaluate(file => (window as unknown as { __kreoda_test: { openIcad: (p: string) => Promise<unknown> } }).__kreoda_test.openIcad(file), saved);
    expect((await snapOf(window)).bodies.some(body => body.type === "SurfaceFaceThicken")).toBe(true);
  } finally { await app.close(); fs.rmSync(profile, { recursive: true, force: true }); }
});
