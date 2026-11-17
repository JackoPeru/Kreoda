import { test, expect } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { boot, runBar, snapOf } from "./helpers";

test("native STEP persistent face outward push uses exact semantic id", async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kreoda-push-profile-"));
  const step = path.join(profile, "import.step");
  const { app, window } = await boot({ KREODA_BACKGROUND_TEST: "1" }, [`--user-data-dir=${profile}`]);
  try {
    await runBar(window, "box 100 60 10");
    await window.evaluate(file => (window as unknown as { __kreoda_test: { saveIcad: (p: string) => Promise<unknown> } }).__kreoda_test.saveIcad(file), step);
    await window.evaluate(file => (window as unknown as { __kreoda_test: { openIcad: (p: string) => Promise<unknown> } }).__kreoda_test.openIcad(file), step);
    const before = await snapOf(window);
    expect(before.bodies[0]?.type).toBe("StepImport");
    const solid = before.bodies[0]!;
    const actualFaceId = solid.faces.find(id => id.startsWith(`${solid.id}:`) && !/face\[\d+\]/.test(id));
    expect(actualFaceId, "native persistent semantic face ID required").toBeTruthy();
    await window.evaluate(({ owner, face, amount }) => (window as unknown as {
      __kreoda_test: { outwardFacePushE2E: (owner: string, face: string, amount: number) => Promise<void> };
    }).__kreoda_test.outwardFacePushE2E(owner, face, amount), { owner: solid.id, face: actualFaceId!, amount: 5 });
    const after = await snapOf(window);
    expect(after.bodies.length).toBeGreaterThan(before.bodies.length);
    expect(after.bodies.some(item => item.type === "OutwardFacePush" && item.volumeMm3 > solid.volumeMm3)).toBe(true);
  } finally { await app.close(); fs.rmSync(profile, { recursive: true, force: true }); }
});

test("native STEP inward pocket reduces volume and survives save/open", async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kreoda-pocket-profile-"));
  const step = path.join(profile, "import.step");
  const saved = path.join(profile, "pocket.icad");
  const { app, window } = await boot({ KREODA_BACKGROUND_TEST: "1" }, [`--user-data-dir=${profile}`]);
  try {
    await runBar(window, "box 100 60 10");
    await window.evaluate(file => (window as unknown as { __kreoda_test: { saveIcad: (p: string) => Promise<unknown> } }).__kreoda_test.saveIcad(file), step);
    await window.evaluate(file => (window as unknown as { __kreoda_test: { openIcad: (p: string) => Promise<unknown> } }).__kreoda_test.openIcad(file), step);
    const before = await snapOf(window);
    const solid = before.bodies.find(body => body.type === "StepImport")!;
    expect(solid).toBeTruthy();
    const face = solid.faces.find(id => id.endsWith(":box.+Z"));
    expect(face, `top face must have persistent semantic role; available: ${solid.faces.join(", ")}`).toBeTruthy();
    await window.evaluate(({ owner, faceId }) => (window as unknown as {
      __kreoda_test: { inwardFacePocketE2E: (owner: string, face: string, depth: number) => Promise<void> };
    }).__kreoda_test.inwardFacePocketE2E(owner, faceId, 2), { owner: solid.id, faceId: face! });
    const after = await snapOf(window);
    expect(after.bodies.some(body => body.type === "InwardFacePocket" && body.volumeMm3 < solid.volumeMm3)).toBe(true);
    await window.evaluate(() => (window as unknown as { __kreoda_test: { configurationE2E: { undo: () => Promise<void> } } }).__kreoda_test.configurationE2E.undo());
    const undone = await snapOf(window);
    expect(undone.bodies.some(body => body.type === "InwardFacePocket")).toBe(false);
    await window.evaluate(() => (window as unknown as { __kreoda_test: { configurationE2E: { redo: () => Promise<void> } } }).__kreoda_test.configurationE2E.redo());
    const redone = await snapOf(window);
    expect(redone.bodies.some(body => body.type === "InwardFacePocket" && body.volumeMm3 < solid.volumeMm3)).toBe(true);
    await window.evaluate(file => (window as unknown as { __kreoda_test: { saveIcad: (p: string) => Promise<unknown> } }).__kreoda_test.saveIcad(file), saved);
    await window.evaluate(file => (window as unknown as { __kreoda_test: { openIcad: (p: string) => Promise<unknown> } }).__kreoda_test.openIcad(file), saved);
    const reopened = await snapOf(window);
    expect(reopened.bodies.some(body => body.type === "InwardFacePocket" && body.volumeMm3 < solid.volumeMm3)).toBe(true);
  } finally { await app.close(); fs.rmSync(profile, { recursive: true, force: true }); }
});
