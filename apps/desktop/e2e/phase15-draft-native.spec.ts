import { test, expect } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { boot, runBar, snapOf } from "./helpers";

test("real OCCT draft query reports planar face angles and stays read-only", async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kreoda-draft-profile-"));
  const { app, window } = await boot({ KREODA_BACKGROUND_TEST: "1" }, [`--user-data-dir=${profile}`]);
  try {
    await runBar(window, "box 100 60 10");
    const before = await snapOf(window);
    const solid = before.bodies[0]!;
    const result = await window.evaluate(id => (window as unknown as {
      __kreoda_test: { draftAnalysisE2E: (featureId: string, pull: [number, number, number]) => Promise<{
        faces: { referenceId: string; draftAngleDeg: number; classification: string }[]
      }> };
    }).__kreoda_test.draftAnalysisE2E(id, [0, 0, 1]), solid.id);
    expect(result.faces).toHaveLength(6);
    expect(result.faces.some(f => f.referenceId.endsWith(":box.+Z") && Math.abs(f.draftAngleDeg - 90) < 1e-6 && f.classification === "positive")).toBe(true);
    expect(result.faces.some(f => f.referenceId.endsWith(":box.-Z") && Math.abs(f.draftAngleDeg + 90) < 1e-6 && f.classification === "negative")).toBe(true);
    expect(result.faces.filter(f => f.classification === "neutral")).toHaveLength(4);
    const after = await snapOf(window);
    expect(after.revision).toBe(before.revision);
    expect(after.bodies).toEqual(before.bodies);
  } finally { await app.close(); fs.rmSync(profile, { recursive: true, force: true }); }
});
