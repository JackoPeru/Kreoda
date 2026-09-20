// Phase 8 E2E (§61): STL mesh export/import round-trip through the UI.
// Box → export binary .stl → import replaces the doc with MeshImport bodies
// at identical volume → .icad save/reopen proves imported bodies persist.

import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import os from "node:os";

const HERE = import.meta.dirname;
const MAIN = path.join(HERE, "..", ".vite", "build", "main.cjs");
const STL = path.join(os.tmpdir(), "kreoda-phase8-e2e.stl");
const ICAD = path.join(os.tmpdir(), "kreoda-phase8-stl-e2e.icad");

interface BodySnapshot {
  id: string;
  type: string;
  paramsMm: number[];
  volumeMm3: number;
  triangles: number;
}
interface Snapshot {
  revision: number;
  bodies: BodySnapshot[];
  sketches: { id: string }[];
}

test("STL export → import → persist", async () => {
  const app = await electron.launch({
    args: [MAIN, "--no-sandbox"],
  });
  try {
    const window = await app.firstWindow({ timeout: 30000 });
    await window.waitForLoadState("domcontentloaded");
    await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({
      timeout: 20000,
    });

    const snap = (): Promise<Snapshot> =>
      window.evaluate(() =>
        (
          window as unknown as {
            __kreoda_test: { snapshot: () => Snapshot };
          }
        ).__kreoda_test.snapshot(),
      );
    const input = window.getByTestId("command-input");

    // 1. Parametric plate.
    await input.fill("box 100 60 10");
    await input.press("Enter");
    const preview = window.getByTestId("plan-preview");
    await expect(preview).toBeVisible({ timeout: 5000 });
    await preview.getByRole("button", { name: /Run 1 step/ }).click();
    await expect
      .poll(async () => ((await snap()) as Snapshot).bodies.length, {
        timeout: 30000,
      })
      .toBe(1);

    // 2. Export STL (same Save path the toolbar uses — extension branches).
    await window.evaluate(
      ({ file }) =>
        (
          window as unknown as {
            __kreoda_test: { saveIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.saveIcad(file),
      { file: STL },
    );

    // 3. Import replaces the doc with faceted MeshImport bodies.
    const imported = (await window.evaluate(
      ({ file }) =>
        (
          window as unknown as {
            __kreoda_test: { openIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.openIcad(file),
      { file: STL },
    )) as Snapshot;
    expect(imported.bodies).toHaveLength(1);
    expect(imported.bodies[0]!.type).toBe("MeshImport");
    expect(imported.bodies[0]!.volumeMm3).toBeCloseTo(60000, 0);
    expect(imported.bodies[0]!.triangles).toBeGreaterThan(0);

    // 4. Imported bodies persist through the native container.
    await window.evaluate(
      ({ icad }) =>
        (
          window as unknown as {
            __kreoda_test: { saveIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.saveIcad(icad),
      { icad: ICAD },
    );
    const reopened = (await window.evaluate(
      ({ icad }) =>
        (
          window as unknown as {
            __kreoda_test: { openIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.openIcad(icad),
      { icad: ICAD },
    )) as Snapshot;
    expect(reopened.bodies).toHaveLength(1);
    expect(reopened.bodies[0]!.type).toBe("MeshImport");
    expect(reopened.bodies[0]!.volumeMm3).toBeCloseTo(60000, 0);

    await window.screenshot({ path: path.join(HERE, "phase8-stl.png") });
  } finally {
    await app.close();
  }
});
