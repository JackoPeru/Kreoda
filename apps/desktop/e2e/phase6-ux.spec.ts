// Phase 6 E2E (§61: beginner interaction layer): onboarding → context
// toolbar on face selection → view cube preset → dimension chips → intent
// suggestion apply (two near-equal holes unified).

import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import { HERE, MAIN, addBox, openProject, type Snapshot } from "./helpers";

test("beginner layer: onboard, context tools, views, chips, suggestion", async () => {
  const app = await electron.launch({
    args: [MAIN, "--no-sandbox", "--lang=en-US"],
  });
  try {
    const window = await app.firstWindow({ timeout: 30000 });
    await window.waitForLoadState("domcontentloaded");
    await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({
      timeout: 20000,
    });

    // Fresh-user simulation: the shell persists localStorage in its
    // profile, so clear onboarding/suggestion dismissals first.
    await window.evaluate(() => localStorage.clear());
    await window.reload();
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

    // 1. Onboarding over the empty document (§56).
    await expect(window.getByTestId("onboarding")).toBeVisible({
      timeout: 10000,
    });
    await window
      .getByTestId("onboarding")
      .getByRole("button", { name: /Start from a box/ })
      .click();
    await openProject(window);
    await expect(window.getByText(/Box 100×50×20/)).toBeVisible({
      timeout: 20000,
    });

    const s0 = (await snap()) as Snapshot;
    const boxId = s0.bodies[0]!.id;

    // 2. Face selection shows the context toolbar with hole action (§18).
    await window.evaluate(
      ({ f }) =>
        (
          window as unknown as {
            __kreoda_test: {
              selectFace: (id: string, role: string) => unknown;
            };
          }
        ).__kreoda_test.selectFace(f, "box.+Z"),
      { f: boxId },
    );
    const ctxBar = window.getByTestId("context-toolbar");
    await expect(ctxBar).toBeVisible({ timeout: 5000 });
    await expect(
      ctxBar.getByRole("button", { name: "Hole" }),
    ).toBeVisible();

    // 3. View cube presets point the camera (§23).
    const viewDir = (): Promise<[number, number, number]> =>
      window.evaluate(() =>
        (
          window as unknown as {
            __kreoda_test: { viewDir: () => [number, number, number] };
          }
        ).__kreoda_test.viewDir(),
      );
    await window
      .getByTestId("view-cube")
      .getByRole("button", { name: "Top view" })
      .click();
    {
      const dir = (await viewDir()) as [number, number, number];
      expect(Math.abs(dir[0])).toBeLessThan(0.01);
      expect(Math.abs(dir[1])).toBeLessThan(0.01);
      // Looking straight down: view direction is −Z.
      expect(dir[2]).toBeLessThan(-0.99);
    }
    await window
      .getByTestId("view-cube")
      .getByRole("button", { name: "Front view" })
      .click();
    {
      const dir = (await viewDir()) as [number, number, number];
      expect(Math.abs(dir[0])).toBeLessThan(0.01);
      expect(Math.abs(dir[2])).toBeLessThan(0.01);
      expect(dir[1]).toBeGreaterThan(0.99);
    }
    await window
      .getByTestId("view-cube")
      .getByRole("button", { name: "Right view" })
      .click();
    {
      const dir = (await viewDir()) as [number, number, number];
      expect(dir[0]).toBeLessThan(-0.99);
      expect(Math.abs(dir[1])).toBeLessThan(0.01);
      expect(Math.abs(dir[2])).toBeLessThan(0.01);
    }
    await window
      .getByTestId("view-cube")
      .getByRole("button", { name: "Isometric view" })
      .click();
    {
      const dir = (await viewDir()) as [number, number, number];
      const len = Math.hypot(dir[0], dir[1], dir[2]);
      expect(len).toBeCloseTo(1, 3);
      expect(dir[2]).toBeLessThan(-0.3);
    }

    // 4. Dimension chips follow the selected body (§22).
    await expect(window.getByTestId("dimension-chips")).toBeVisible();
    const chips = window.getByTestId("dimension-chips").locator("button");
    await expect(chips).toHaveCount(3, { timeout: 10000 });
    await expect(chips.nth(0)).toContainText("W 100");

    // 5. Two near-equal holes → suggestion → Apply unifies (§27).
    const makeHole = (x: number, d: number): Promise<Snapshot> =>
      window.evaluate(
        ({ t, xx, dd }) =>
          (
            window as unknown as {
              __kreoda_test: {
                makeHole: (
                  target: string,
                  role: string,
                  x: number,
                  y: number,
                  dia: number,
                ) => Promise<Snapshot>;
              };
            }
          ).__kreoda_test.makeHole(t, "box.+Z", xx, 25, dd),
        { t: boxId, xx: x, dd: d },
      );
    await makeHole(30, 8);
    await makeHole(70, 8.4);
    const bar = window.getByTestId("suggestion-bar");
    await expect(bar).toBeVisible({ timeout: 10000 });
    await expect(bar).toContainText("same size");
    await bar.getByRole("button", { name: "Apply" }).click();
    await expect
      .poll(
        async () => {
          const s = (await snap()) as Snapshot;
          const holes = s.bodies.filter((b) => b.type === "Hole");
          if (holes.length !== 2) return "";
          return holes.map((h) => h.paramsMm[0]).join(",");
        },
        { timeout: 30000 },
      )
      .toBe("8,8");

    await window.screenshot({ path: path.join(HERE, "phase6-ux.png") });
  } finally {
    await app.close();
  }
});

test("dismiss paths persist; similar select; chip edit commits", async () => {
  const app = await electron.launch({
    args: [MAIN, "--no-sandbox", "--lang=en-US"],
  });
  try {
    const window = await app.firstWindow({ timeout: 30000 });
    await window.waitForLoadState("domcontentloaded");
    await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({
      timeout: 20000,
    });
    await window.evaluate(() => localStorage.clear());
    await window.reload();
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

    // T4: onboarding Dismiss persists across reload.
    await expect(window.getByTestId("onboarding")).toBeVisible({
      timeout: 10000,
    });
    await window
      .getByTestId("onboarding")
      .getByRole("button", { name: "Dismiss" })
      .click();
    await expect(window.getByTestId("onboarding")).not.toBeVisible();
    await window.reload();
    await window.waitForLoadState("domcontentloaded");
    await expect(window.getByText(/core 0\.1\.0/)).toBeVisible({
      timeout: 20000,
    });
    await expect(window.getByTestId("onboarding")).not.toBeVisible();

    // Box via dialog (onboarding dismissed, Add popover path).
    await addBox(window);
    await window.getByRole("button", { name: "Create" }).click();
    await openProject(window);
    await expect(window.getByText(/Box 100×50×20/)).toBeVisible({
      timeout: 20000,
    });
    const boxId = ((await snap()) as Snapshot).bodies[0]!.id;

    // T2: Similar selects the opposite cap (2 faces).
    await window.evaluate(
      ({ f }) =>
        (
          window as unknown as {
            __kreoda_test: {
              selectFace: (id: string, role: string) => unknown;
            };
          }
        ).__kreoda_test.selectFace(f, "box.+Z"),
      { f: boxId },
    );
    await window
      .getByTestId("context-toolbar")
      .getByRole("button", { name: "Similar" })
      .click();
    await expect
      .poll(
        async () => ((await snap()) as Snapshot).selectedIds.length,
        { timeout: 10000 },
      )
      .toBe(2);

    // T1: chip edit commits through the same typed path (inline editor).
    await window.evaluate(
      ({ f }) =>
        (
          window as unknown as {
            __kreoda_test: {
              selectFace: (id: string, role: string) => unknown;
            };
          }
        ).__kreoda_test.selectFace(f, "box.+Z"),
      { f: boxId },
    );
    const chipW = window
      .getByTestId("dimension-chips")
      .locator("button", { hasText: /^W / })
      .first();
    await chipW.click();
    const chipInput = window
      .getByTestId("dimension-chips")
      .locator("button input")
      .first();
    await expect(chipInput).toBeVisible({ timeout: 5000 });
    await chipInput.fill("200");
    await chipInput.press("Enter");
    await expect(window.getByText(/Box 200×50×20/)).toBeVisible({
      timeout: 20000,
    });

    // T5: suggestion ✕ persists across reload.
    const makeHole = (x: number, d: number): Promise<Snapshot> =>
      window.evaluate(
        ({ t, xx, dd }) =>
          (
            window as unknown as {
              __kreoda_test: {
                makeHole: (
                  target: string,
                  role: string,
                  x: number,
                  y: number,
                  dia: number,
                ) => Promise<Snapshot>;
              };
            }
          ).__kreoda_test.makeHole(t, "box.+Z", xx, 25, dd),
        { t: boxId, xx: x, dd: d },
      );
    await makeHole(30, 8);
    await makeHole(70, 8.4);
    const bar = window.getByTestId("suggestion-bar");
    await expect(bar).toBeVisible({ timeout: 10000 });
    await bar.getByRole("button", { name: "✕" }).click();
    await expect(bar).not.toBeVisible();
    // Dismissal persists in the profile (reload would show a fresh UI
    // store, so assert the stored key directly).
    const stored = (await window.evaluate(
      () => localStorage.getItem("kreoda.dismissedSuggestions"),
    )) as string | null;
    expect(stored).toContain("equalSize");
  } finally {
    await app.close();
  }
});
