// Phase 3 acceptance E2E (§61): drag box face → dimension changes →
// recompute → exactly ONE Undo step; Undo restores the previous size.

import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";

const HERE = import.meta.dirname;
const MAIN = path.join(HERE, "..", ".vite", "build", "main.cjs");

interface BodySnapshot {
  id: string;
  paramsMm: number[];
  volumeMm3: number;
  faces: string[];
}
interface Snapshot {
  revision: number;
  bodies: BodySnapshot[];
}
interface Anchor {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

test("pull face resizes solid in one undo step", async () => {
  const app = await electron.launch({
    args: [MAIN, "--no-sandbox"],
  });
  try {
    const window = await app.firstWindow({ timeout: 30000 });
    await window.waitForLoadState("domcontentloaded");
    await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({
      timeout: 20000,
    });

    await window.getByRole("button", { name: /Add box/ }).click();
    await window.getByRole("button", { name: "Create" }).click();
    await expect(window.getByText(/Box 100×50×20/)).toBeVisible({
      timeout: 20000,
    });

    const snap0 = (await window.evaluate(() =>
      (
        window as unknown as {
          __intentcad_test: { snapshot: () => Snapshot };
        }
      ).__intentcad_test.snapshot(),
    )) as Snapshot;
    const boxId = snap0.bodies[0]!.id;

    // Real pointer drag on the top cap, along its outward screen normal.
    const anchor = (await window.evaluate(
      ({ f }) =>
        (
          window as unknown as {
            __intentcad_test: {
              faceScreenPoint: (id: string, role: string) => Anchor | null;
            };
          }
        ).__intentcad_test.faceScreenPoint(f, "box.+Z"),
      { f: boxId },
    )) as Anchor | null;
    expect(anchor).not.toBeNull();

    await window.getByRole("button", { name: "Pull", exact: true }).click();
    await window.mouse.move(anchor!.x, anchor!.y);
    await window.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await window.mouse.move(
        anchor!.x + anchor!.nx * i * 9,
        anchor!.y + anchor!.ny * i * 9,
        { steps: 2 },
      );
    }
    await window.mouse.up();

    const readSnap = (): Promise<Snapshot> =>
      window.evaluate(() =>
        (
          window as unknown as {
            __intentcad_test: { snapshot: () => Snapshot };
          }
        ).__intentcad_test.snapshot(),
      );

    // Width grew through the source parameter (depth for the +Z cap).
    // Poll: the pointer release commits asynchronously.
    await expect
      .poll(
        async () =>
          ((await readSnap()) as Snapshot).bodies[0]!.paramsMm[2]!,
        { timeout: 20000 },
      )
      .toBeGreaterThan(20);
    const snap1 = (await readSnap()) as Snapshot;
    // Exactly ONE Undo step for the whole drag (§12).
    expect(snap1.revision).toBe(snap0.revision + 1);
    expect(snap1.bodies[0]!.faces).toContain(`${boxId}:box.+Z`);

    // Undo restores the exact previous size.
    await window.locator('button[title^="Undo"]').click();
    await expect(window.getByText(/Box 100×50×20/)).toBeVisible({
      timeout: 20000,
    });
    const snap2 = (await readSnap()) as Snapshot;
    expect(snap2.bodies[0]!.paramsMm).toEqual([100, 50, 20]);

    await window.screenshot({ path: path.join(HERE, "phase3-pull.png") });
  } finally {
    await app.close();
  }
});
