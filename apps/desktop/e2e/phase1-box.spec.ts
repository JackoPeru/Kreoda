// Phase 1 E2E (§49, §61): exact-size primitive from the UI is real OCCT
// geometry; save → reopen returns the identical solid; viewport shows the
// core tessellation (no frontend-generated geometry).

import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import os from "node:os";

const HERE = import.meta.dirname;
const MAIN = path.join(HERE, "..", ".vite", "build", "main.cjs");
const ICAD = path.join(os.tmpdir(), "kreoda-phase1-e2e.icad");

interface BodySnapshot {
  id: string;
  type: string;
  volumeMm3: number;
  triangles: number;
}
interface Snapshot {
  revision: number;
  selectedIds: string[];
  bodies: BodySnapshot[];
}

test("exact box → save → reopen identical", async () => {
  const app = await electron.launch({
    args: [MAIN, "--no-sandbox"],
  });
  try {
    const window = await app.firstWindow({ timeout: 30000 });
    await window.waitForLoadState("domcontentloaded");
    await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({
      timeout: 20000,
    });

    // Scenario A (§62): type exact dimensions, get a solid.
    await window.getByRole("button", { name: /Add box/ }).click();
    await window.getByRole("button", { name: "Create" }).click();
    await expect(window.getByText(/Box 100×50×20/)).toBeVisible({
      timeout: 20000,
    });

    const before = (await window.evaluate(
      () =>
        (
          window as unknown as {
            __kreoda_test: { snapshot: () => Snapshot };
          }
        ).__kreoda_test.snapshot(),
    )) as Snapshot;
    expect(before.bodies).toHaveLength(1);
    expect(before.bodies[0]!.type).toBe("Box");
    // Exact OCCT volume for 100×50×20 — not an approximation.
    expect(before.bodies[0]!.volumeMm3).toBeCloseTo(100000, 3);
    expect(before.bodies[0]!.triangles).toBeGreaterThanOrEqual(12);

    // Body selection (§16): tree click selects the canonical body.
    await window.getByText(/Box 100×50×20/).click();
    const selected = (await window.evaluate(
      () =>
        (
          window as unknown as {
            __kreoda_test: { snapshot: () => Snapshot };
          }
        ).__kreoda_test.snapshot(),
    )) as Snapshot;
    expect(selected.selectedIds).toContain(before.bodies[0]!.id);

    // Save → reopen round-trip through the real .icad container.
    await window.evaluate(
      ({ icad }) =>
        (
          window as unknown as {
            __kreoda_test: { saveIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.saveIcad(icad),
      { icad: ICAD },
    );
    const after = (await window.evaluate(
      ({ icad }) =>
        (
          window as unknown as {
            __kreoda_test: { openIcad: (p: string) => Promise<Snapshot> };
          }
        ).__kreoda_test.openIcad(icad),
      { icad: ICAD },
    )) as Snapshot;

    expect(after.bodies).toHaveLength(1);
    expect(after.bodies[0]!.id).toBe(before.bodies[0]!.id);
    expect(after.bodies[0]!.volumeMm3).toBeCloseTo(
      before.bodies[0]!.volumeMm3,
      6,
    );
    expect(after.bodies[0]!.triangles).toBe(before.bodies[0]!.triangles);
    await expect(window.getByText(/Box 100×50×20/)).toBeVisible();

    await window.screenshot({ path: path.join(HERE, "phase1-box.png") });
  } finally {
    await app.close();
  }
});
