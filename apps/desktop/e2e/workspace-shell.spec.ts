// UX-1 E2E: minimal workspace shell — viewport-first layout, floating
// docks, drawers closed by default, all command paths intact.
// UX-4 E2E: progressive disclosure — drawers, Simple/Advanced, diagnostics.
import { test, expect } from "@playwright/test";
import path from "node:path";
import {
  HERE,
  boot,
  openMore,
  openProject,
  openProperties,
  runBar,
  snapOf,
} from "./helpers";

test("minimal shell: viewport dominates, docks float, drawers on demand", async () => {
  const { app, window } = await boot();
  try {
    // Shell renders: top dock, command dock, status, viewport.
    await expect(window.getByTestId("workspace-chrome")).toBeVisible();
    await expect(window.getByTestId("workspace-topdock")).toBeVisible();
    await expect(
      window.getByRole("button", { name: "Add", exact: true }),
    ).toBeVisible();
    await expect(window.getByTestId("command-dock")).toBeVisible();
    await expect(window.getByTestId("workspace-status")).toBeVisible();
    await expect(window.getByTestId("viewport")).toBeVisible();

    // Drawers closed by default.
    await expect(window.getByTestId("project-drawer")).not.toBeVisible();
    await expect(window.getByTestId("properties-drawer")).not.toBeVisible();

    // Viewport uses (almost) the whole window: ≥85% of the area.
    const ratio = await window.evaluate(() => {
      const el = document.querySelector('[data-testid="viewport"]')!;
      const r = el.getBoundingClientRect();
      return (r.width * r.height) / (globalThis.innerWidth * globalThis.innerHeight);
    });
    expect(ratio).toBeGreaterThanOrEqual(0.85);

    // Floating docks never overlap each other or the status pill.
    const disjoint = await window.evaluate(() => {
      const r = (id: string) =>
        document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
      const hit = (
        a: DOMRect,
        b: DOMRect,
      ): boolean =>
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height;
      const top = r("workspace-topdock");
      const dock = r("command-dock");
      const status = r("workspace-status");
      return !hit(top, dock) && !hit(status, dock) && !hit(top, status);
    });
    expect(disjoint).toBe(true);

    await window.screenshot({ path: path.join(HERE, "shell-empty.png") });

    // Command path intact through the floating bar.
    await runBar(window, "box 100 50 20");
    await expect
      .poll(async () => (await snapOf(window)).bodies.length, {
        timeout: 30000,
      })
      .toBe(1);

    // Project drawer opens in one click; tree selects the body.
    await openProject(window);
    const boxText = window.getByText(/Box 100×50×20/);
    await expect(boxText).toBeVisible({ timeout: 10000 });
    await boxText.click();
    await window.screenshot({ path: path.join(HERE, "shell-model.png") });

    // Properties drawer opens on demand with the dimension fields.
    await openProperties(window);
    await expect(
      window.getByTestId("properties-drawer").getByLabel(/Width/),
    ).toBeVisible({ timeout: 5000 });
    await window.screenshot({ path: path.join(HERE, "shell-drawers.png") });

    // Face selection still raises the contextual tools (unchanged UX-2 target).
    const boxId = (await snapOf(window)).bodies[0]!.id;
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
    await expect(window.getByTestId("context-toolbar")).toBeVisible({
      timeout: 5000,
    });
  } finally {
    await app.close();
  }
});

test("progressive disclosure: drawers, mode toggle, diagnostics", async () => {
  const { app, window } = await boot();
  try {
    // Drawers closed by default, open in one click and close again.
    await expect(window.getByTestId("project-drawer")).not.toBeVisible();
    await openProject(window);
    await window.getByRole("button", { name: "Close project drawer" }).click();
    await expect(window.getByTestId("project-drawer")).not.toBeVisible({
      timeout: 5000,
    });

    // Simple/Advanced lives in More (not permanently visible) and flips.
    await openMore(window);
    const menu = window.getByTestId("more-menu");
    await expect(
      menu.getByRole("button", { name: "Simple" }),
    ).toBeVisible();
    await menu.getByRole("button", { name: "Simple" }).click();
    await openMore(window);
    await expect(
      window.getByTestId("more-menu").getByRole("button", { name: "Advanced" }),
    ).toBeVisible({ timeout: 5000 });
    await window.keyboard.press("Escape");

    // Diagnostics hide behind the status pill (rev 0 on an empty doc).
    await expect(window.getByTestId("workspace-diagnostics")).not.toBeVisible();
    await window.getByTestId("workspace-status").click();
    const diag = window.getByTestId("workspace-diagnostics");
    await expect(diag).toBeVisible({ timeout: 5000 });
    await expect(diag).toContainText(/rev 0/);
    await expect(diag).toContainText(/core 0\.1\.0/);
    await window.screenshot({ path: path.join(HERE, "shell-disclosure.png") });
  } finally {
    await app.close();
  }
});
