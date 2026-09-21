// Phase 2 E2E (§61): topology-aware selection. A persistently selected face
// (UUID + role, never an array index) survives a parameter change AND a
// save/reopen round-trip; edges arrive with persistent ids too.

import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import { HERE, MAIN, type Snapshot } from "./helpers";

const ICAD = path.join(os.tmpdir(), "kreoda-phase2-e2e.icad");

interface TestHook {
  snapshot: () => Promise<Snapshot>;
  selectFace: (featureId: string, role: string) => Promise<Snapshot>;
  setParam: (
    featureId: string,
    paramName: string,
    valueMm: number,
  ) => Promise<Snapshot>;
  saveIcad: (p: string) => Promise<Snapshot>;
  openIcad: (p: string) => Promise<Snapshot>;
}

async function hook(
  window: Pick<
    import("@playwright/test").Page,
    "evaluate" | "getByRole" | "getByText" | "screenshot" | "waitForLoadState" | "on"
  >,
): Promise<TestHook> {
  type Hook = { __kreoda_test: TestHook };
  return {
    snapshot: () =>
      window.evaluate<Snapshot>(
        () => (window as unknown as Hook).__kreoda_test.snapshot(),
      ),
    selectFace: (featureId, role) =>
      window.evaluate<Snapshot, { f: string; r: string }>(
        ({ f, r }) =>
          (window as unknown as Hook).__kreoda_test.selectFace(f, r),
        { f: featureId, r: role },
      ),
    setParam: (featureId, paramName, valueMm) =>
      window.evaluate<
        Snapshot,
        { f: string; p: string; v: number }
      >(
        ({ f, p, v }) =>
          (window as unknown as Hook).__kreoda_test.setParam(f, p, v),
        { f: featureId, p: paramName, v: valueMm },
      ),
    saveIcad: (p) =>
      window.evaluate<Snapshot, { icad: string }>(
        ({ icad }) =>
          (window as unknown as Hook).__kreoda_test.saveIcad(icad),
        { icad: p },
      ),
    openIcad: (p) =>
      window.evaluate<Snapshot, { icad: string }>(
        ({ icad }) =>
          (window as unknown as Hook).__kreoda_test.openIcad(icad),
        { icad: p },
      ),
  };
}

test("face reference survives parameter change and reopen", async () => {
  const app = await electron.launch({
    args: [MAIN, "--no-sandbox"],
  });
  try {
    const window = await app.firstWindow({ timeout: 30000 });
    await window.waitForLoadState("domcontentloaded");
    await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({
      timeout: 20000,
    });
    const t = await hook(window);

    // Exact box, then persistent face pick (top cap).
    await window.getByRole("button", { name: /Add box/ }).click();
    await window.getByRole("button", { name: "Create" }).click();
    await expect(window.getByText(/Box 100×50×20/)).toBeVisible({
      timeout: 20000,
    });
    const created = await t.snapshot();
    const boxId = created.bodies[0]!.id;
    expect(created.bodies[0]!.faces).toContain(`${boxId}:box.+Z`);
    expect(created.bodies[0]!.edgeCount).toBe(12);

    const selected = await t.selectFace(boxId, "box.+Z");
    expect(selected.selectedIds).toContain(`${boxId}:box.+Z`);

    // Typed dimension edit: same UUID, new volume, same face reference.
    const edited = await t.setParam(boxId, "widthMm", 150);
    expect(edited.bodies[0]!.volumeMm3).toBeCloseTo(150000, 3);
    expect(edited.bodies[0]!.paramsMm).toEqual([150, 50, 20]);
    expect(edited.bodies[0]!.faces).toContain(`${boxId}:box.+Z`);
    expect(edited.selectedIds).toContain(`${boxId}:box.+Z`);
    await expect(window.getByText(/Box 150×50×20/)).toBeVisible();

    // Save → reopen: identical solid AND identical face reference.
    await t.saveIcad(ICAD);
    const after = await t.openIcad(ICAD);
    expect(after.bodies).toHaveLength(1);
    expect(after.bodies[0]!.id).toBe(boxId);
    expect(after.bodies[0]!.volumeMm3).toBeCloseTo(150000, 6);
    expect(after.bodies[0]!.faces).toContain(`${boxId}:box.+Z`);

    await window.screenshot({ path: path.join(HERE, "phase2-face.png") });
  } finally {
    await app.close();
  }
});
