// Phase 3 acceptance E2E (§61): drag box face → dimension changes →
// recompute → exactly ONE Undo step; Undo restores the previous size.

import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { HERE, MAIN, addBox, hideForBackgroundE2E, openMore, openProject, type Snapshot } from "./helpers";

interface Anchor {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

test("pull face resizes solid in one undo step", async () => {
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-phase3-pull-"));
  const app = await electron.launch({
    args: [MAIN, "--no-sandbox", "--lang=en-US", `--user-data-dir=${profile}`],
    env: {
      ...process.env,
      KREODA_SESSION_PORT: "",
      KREODA_SESSION_TOKEN: "",
      KREODA_RECOVERY_DIR: profile,
    },
  });
  try {
    const window = await app.firstWindow({ timeout: 30000 });
    await hideForBackgroundE2E(app);
    await window.waitForLoadState("domcontentloaded");
    await window.getByTestId("home-new-project").click();
    await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({
      timeout: 20000,
    });

    await addBox(window);
    await window.getByRole("button", { name: "Create" }).click();
    await openProject(window);
    await expect(window.getByText(/Box 100×50×20/)).toBeVisible({
      timeout: 20000,
    });

    const snap0 = (await window.evaluate(() =>
      (
        window as unknown as {
          __kreoda_test: { snapshot: () => Snapshot };
        }
      ).__kreoda_test.snapshot(),
    )) as Snapshot;
    const boxId = snap0.bodies[0]!.id;

    // Real pointer drag on the top cap, along its outward screen normal.
    const anchor = (await window.evaluate(
      ({ f }) =>
        (
          window as unknown as {
            __kreoda_test: {
              faceScreenPoint: (id: string, role: string) => Anchor | null;
            };
          }
        ).__kreoda_test.faceScreenPoint(f, "box.+Z"),
      { f: boxId },
    )) as Anchor | null;
    expect(anchor).not.toBeNull();

    await openMore(window);
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
            __kreoda_test: { snapshot: () => Snapshot };
          }
        ).__kreoda_test.snapshot(),
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

    const viewportFrames = () => window.evaluate(() => (
      window as unknown as {
        __kreoda_test: { viewportRenderStats: () => { renderedFrames: number } | null };
      }
    ).__kreoda_test.viewportRenderStats()?.renderedFrames ?? 0);
    const framesBeforeCapture = await viewportFrames();
    await window.evaluate(() => globalThis.window.dispatchEvent(new Event("resize")));
    await expect.poll(viewportFrames).toBeGreaterThan(framesBeforeCapture);

    const capture = await app.evaluate(async ({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      if (!browserWindow) throw new Error("Electron screenshot window missing");
      const visibleBefore = browserWindow.isVisible();
      const image = await browserWindow.webContents.capturePage(undefined, { stayHidden: true });
      const { width, height } = image.getSize();
      return {
        png: image.toPNG().toString("base64"),
        empty: image.isEmpty(),
        width,
        height,
        visibleBefore,
        visibleAfter: browserWindow.isVisible(),
      };
    });
    expect(capture.empty).toBe(false);
    expect(capture.width).toBeGreaterThan(0);
    expect(capture.height).toBeGreaterThan(0);
    expect(capture.visibleBefore).toBe(false);
    expect(capture.visibleAfter).toBe(false);

    const png = Buffer.from(capture.png, "base64");
    expect(png.byteLength).toBeGreaterThan(24);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.readUInt32BE(16)).toBe(capture.width);
    expect(png.readUInt32BE(20)).toBe(capture.height);
    const screenshotPath = path.join(HERE, "phase3-pull.png");
    writeFileSync(screenshotPath, png);
    await test.info().attach("phase3-pull.png", { path: screenshotPath, contentType: "image/png" });
  } finally {
    await app.close();
  }
});
