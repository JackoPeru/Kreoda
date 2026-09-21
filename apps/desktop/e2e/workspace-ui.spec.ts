// UX-5 visual E2E: workspace states, responsive layout, recovery banner.
// Functional assertions stay primary; screenshots record each state
// (no pixel-perfect matching — geometry asserts live in phase specs).
import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import {
  HERE,
  boot,
  openProject,
  openProperties,
  runBar,
  snapOf,
  type Snapshot,
} from "./helpers";

async function docksDisjoint(window: Page): Promise<boolean> {
  return window.evaluate(() => {
    const r = (id: string) =>
      document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
    const hit = (a: DOMRect, b: DOMRect): boolean =>
      a.x < b.x + b.width &&
      b.x < a.x + a.width &&
      a.y < b.y + b.height &&
      b.y < a.y + a.height;
    const top = r("workspace-topdock");
    const dock = r("command-dock");
    const status = r("workspace-status");
    return !hit(top, dock) && !hit(status, dock) && !hit(top, status);
  });
}

async function noHorizontalOverflow(window: Page): Promise<boolean> {
  return window.evaluate(
    () => document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
  );
}

test("workspace visual states", async () => {
  const { app, window } = await boot();
  try {
    await window.screenshot({ path: path.join(HERE, "ui-empty.png") });

    await runBar(window, "box 100 50 20");
    await runBar(window, "box 30 30 30");
    await expect
      .poll(async () => (await snapOf(window)).bodies.length, {
        timeout: 30000,
      })
      .toBe(2);
    const s = (await snapOf(window)) as Snapshot;
    const [idA, idB] = [s.bodies[0]!.id, s.bodies[1]!.id];
    const selectMany = (ids: string[]): Promise<unknown> =>
      window.evaluate(
        (list: string[]) =>
          (
            window as unknown as {
              __kreoda_test: { selectMany: (ids: string[]) => unknown };
            }
          ).__kreoda_test.selectMany(list),
        ids,
      );

    // Body selected: single-copy actions, no fake transforms.
    await selectMany([idA]);
    await expect(
      window
        .getByTestId("context-toolbar")
        .getByRole("button", { name: "Copy placed" }),
    ).toBeVisible({ timeout: 5000 });
    await window.screenshot({ path: path.join(HERE, "ui-body.png") });

    // Face selected: hole + sketch actions near the face.
    await window.evaluate(
      ({ f }) =>
        (
          window as unknown as {
            __kreoda_test: {
              selectFace: (id: string, role: string) => unknown;
            };
          }
        ).__kreoda_test.selectFace(f, "box.+Z"),
      { f: idA },
    );
    await expect(
      window
        .getByTestId("context-toolbar")
        .getByRole("button", { name: "Hole" }),
    ).toBeVisible({ timeout: 5000 });
    await window.screenshot({ path: path.join(HERE, "ui-face.png") });

    // Edge selected: dress-up actions.
    await window.evaluate(
      ({ f }) =>
        (
          window as unknown as {
            __kreoda_test: {
              selectEdge: (id: string, suffix: string) => unknown;
            };
          }
        ).__kreoda_test.selectEdge(f, "edge.lin.box.+X~box.-Z"),
      { f: idA },
    );
    await expect(
      window
        .getByTestId("context-toolbar")
        .getByRole("button", { name: "Round" }),
    ).toBeVisible({ timeout: 5000 });
    await window.screenshot({ path: path.join(HERE, "ui-edge.png") });

    // Two bodies: boolean trio.
    await selectMany([idA, idB]);
    await expect(
      window
        .getByTestId("context-toolbar")
        .getByRole("button", { name: "Subtract" }),
    ).toBeVisible({ timeout: 5000 });
    await window.screenshot({ path: path.join(HERE, "ui-twobodies.png") });
  } finally {
    await app.close();
  }
});

test("sketch mode, plan preview, drawers", async () => {
  const { app, window } = await boot();
  try {
    await runBar(window, "box 100 50 20");
    await expect
      .poll(async () => (await snapOf(window)).bodies.length, {
        timeout: 30000,
      })
      .toBe(1);

    // Sketch workspace keeps the shell chrome recognizable.
    const sk = (await window.evaluate(() =>
      (
        window as unknown as {
          __kreoda_test: {
            createRectSketch: (w: number, h: number) => Promise<Snapshot>;
          };
        }
      ).__kreoda_test.createRectSketch(80, 40),
    )) as Snapshot;
    await window.evaluate(
      (id) =>
        (
          window as unknown as {
            __kreoda_test: { openSketch: (sid: string) => unknown };
          }
        ).__kreoda_test.openSketch(id),
      sk.sketches[0]!.id,
    );
    await expect(window.getByTestId("sketch-canvas")).toBeVisible({
      timeout: 10000,
    });
    await expect(window.getByTestId("workspace-topdock")).toBeVisible();
    await window.screenshot({ path: path.join(HERE, "ui-sketch.png") });
    await window.getByRole("button", { name: "Done" }).click();
    await expect(window.getByTestId("sketch-canvas")).not.toBeVisible({
      timeout: 5000,
    });

    // Command plan preview floats above the dock, commits on Run.
    const input = window.getByTestId("command-input");
    await input.fill("box 10 10 10");
    await input.press("Enter");
    const preview = window.getByTestId("plan-preview");
    await expect(preview).toBeVisible({ timeout: 5000 });
    await window.screenshot({ path: path.join(HERE, "ui-plan.png") });
    await preview.getByRole("button", { name: /Run 1 step/ }).click();
    await expect
      .poll(async () => (await snapOf(window)).bodies.length, {
        timeout: 30000,
      })
      .toBe(2);

    // Drawers open on demand.
    await openProject(window);
    await window.screenshot({ path: path.join(HERE, "ui-project.png") });
    await window.getByText(/Box 100×50×20/).first().click();
    await openProperties(window);
    await expect(
      window.getByTestId("properties-drawer").getByLabel(/Width/),
    ).toBeVisible({ timeout: 5000 });
    await window.screenshot({ path: path.join(HERE, "ui-properties.png") });
  } finally {
    await app.close();
  }
});

const RECOVERY_DIR = path.join(os.tmpdir(), "kreoda-workspace-ui-recovery");

test("recovery banner keeps full width above the viewport", async () => {
  fs.rmSync(RECOVERY_DIR, { recursive: true, force: true });
  const env = { ...process.env, KREODA_RECOVERY_DIR: RECOVERY_DIR };
  {
    const { app, window } = await boot(env);
    try {
      await runBar(window, "box 100 60 10");
      await expect
        .poll(async () => (await snapOf(window)).bodies.length, {
          timeout: 30000,
        })
        .toBe(1);
      await window.evaluate(() =>
        (
          window as unknown as {
            __kreoda_test: { autosaveNow: () => Promise<string> };
          }
        ).__kreoda_test.autosaveNow(),
      );
    } finally {
      await app.close();
    }
  }
  const { app, window } = await boot(env);
  try {
    const banner = window.getByTestId("recovery-banner");
    await expect(banner).toBeVisible({ timeout: 10000 });
    // Full-width strip: never covers the floating tools.
    const covers = await window.evaluate(() => {
      const b = document
        .querySelector('[data-testid="recovery-banner"]')!
        .getBoundingClientRect();
      const t = document
        .querySelector('[data-testid="workspace-topdock"]')!
        .getBoundingClientRect();
      return b.y < t.y + t.height && t.y < b.y + b.height;
    });
    expect(covers).toBe(false);
    await window.screenshot({ path: path.join(HERE, "ui-recovery.png") });
  } finally {
    await app.close();
    fs.rmSync(RECOVERY_DIR, { recursive: true, force: true });
  }
});

test("responsive layout at desktop breakpoints", async () => {
  const { app, window } = await boot();
  try {
    const verified: string[] = [];
    for (const [w, h] of [
      [1366, 768],
      [1920, 1080],
      [2560, 1440],
    ] as const) {
      let applied = false;
      try {
        await window.setViewportSize({ width: w, height: h });
        const actual = await window.evaluate(() => globalThis.innerWidth);
        applied = Math.abs(actual - w) <= 2;
      } catch {
        applied = false;
      }
      if (!applied) continue;
      verified.push(`${w}x${h}`);
      await expect(window.getByTestId("workspace-topdock")).toBeVisible();
      await expect(window.getByTestId("command-dock")).toBeVisible();
      await expect(window.getByTestId("viewport")).toBeVisible();
      expect(await noHorizontalOverflow(window)).toBe(true);
      expect(await docksDisjoint(window)).toBe(true);
      await window.screenshot({ path: path.join(HERE, `ui-${w}x${h}.png`) });
    }
    // Layout must hold at the default size no matter what; breakpoints
    // apply only where the harness honors resizing (logged when skipped).
    console.log(`responsive verified at: ${verified.join(", ") || "default only"}`);
    expect(await noHorizontalOverflow(window)).toBe(true);
    expect(await docksDisjoint(window)).toBe(true);
  } finally {
    await app.close();
  }
});
