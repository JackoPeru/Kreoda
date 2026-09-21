// UX-2 E2E: contextual toolbar follows the selection anchor and exposes
// only valid actions per selection kind (face / edge / sketch / bodies).
// (Properties-drawer-closed-by-default and viewport dimension edit are
// covered by workspace-shell.spec.ts and phase6-ux.spec.ts T1.)
import { test, expect } from "@playwright/test";
import path from "node:path";
import { HERE, boot, runBar, snapOf, type Snapshot } from "./helpers";

interface Anchor {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

test("context toolbar follows the selected face", async () => {
  const { app, window } = await boot();
  try {
    await runBar(window, "box 100 50 20");
    await expect
      .poll(async () => (await snapOf(window)).bodies.length, {
        timeout: 30000,
      })
      .toBe(1);
    const s = (await snapOf(window)) as Snapshot;
    const boxId = s.bodies[0]!.id;
    const roles = s.bodies[0]!.faces.map((f) => f.slice(f.indexOf(":") + 1));
    expect(roles.length).toBeGreaterThanOrEqual(2);
    const roleA = roles[0]!;
    const roleB = roles.find((r) => r !== roleA)!;

    const selectFace = (role: string): Promise<unknown> =>
      window.evaluate(
        ({ f, r }) =>
          (
            window as unknown as {
              __kreoda_test: {
                selectFace: (id: string, role: string) => unknown;
              };
            }
          ).__kreoda_test.selectFace(f, r),
        { f: boxId, r: role },
      );
    const anchorOf = (role: string): Promise<Anchor> =>
      window.evaluate(
        ({ f, r }) =>
          (
            window as unknown as {
              __kreoda_test: {
                faceScreenPoint: (id: string, role: string) => Anchor;
              };
            }
          ).__kreoda_test.faceScreenPoint(f, r),
        { f: boxId, r: role },
      ) as Promise<Anchor>;
    const toolbarCenter = async (): Promise<{ x: number; y: number }> => {
      const box = (await window
        .getByTestId("context-toolbar")
        .boundingBox())!;
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };

    await selectFace(roleA);
    const bar = window.getByTestId("context-toolbar");
    await expect(bar).toBeVisible({ timeout: 5000 });
    const a = await anchorOf(roleA);
    const c1 = await toolbarCenter();
    // Anchored near the face (above it), not docked at a fixed spot.
    expect(Math.hypot(c1.x - a.x, c1.y - a.y)).toBeLessThan(250);

    await selectFace(roleB);
    const b = await anchorOf(roleB);
    // The anchor loop runs on rAF: poll until the toolbar arrives.
    await expect
      .poll(
        async () => {
          const c = await toolbarCenter();
          return Math.hypot(c.x - c1.x, c.y - c1.y);
        },
        { timeout: 5000 },
      )
      .toBeGreaterThan(5);
    const c2 = await toolbarCenter();
    expect(Math.hypot(c2.x - b.x, c2.y - b.y)).toBeLessThan(250);

    await window.screenshot({ path: path.join(HERE, "context-face.png") });
  } finally {
    await app.close();
  }
});

test("toolbar actions change with selection kind", async () => {
  const { app, window } = await boot();
  try {
    await runBar(window, "box 100 50 20");
    await runBar(window, "box 30 30 30");
    await expect
      .poll(async () => (await snapOf(window)).bodies.length, {
        timeout: 30000,
      })
      .toBe(2);
    let s = (await snapOf(window)) as Snapshot;
    const [idA, idB] = [s.bodies[0]!.id, s.bodies[1]!.id];
    const roleA = s.bodies[0]!.faces[0]!.slice(
      s.bodies[0]!.faces[0]!.indexOf(":") + 1,
    );
    const bar = window.getByTestId("context-toolbar");

    const hole = bar.getByRole("button", { name: "Hole" });
    const round = bar.getByRole("button", { name: "Round" });

    // Face: hole tools, no edge tools.
    await window.evaluate(
      ({ f, r }) =>
        (
          window as unknown as {
            __kreoda_test: {
              selectFace: (id: string, role: string) => unknown;
            };
          }
        ).__kreoda_test.selectFace(f, r),
      { f: idA, r: roleA },
    );
    await expect(hole).toBeVisible({ timeout: 5000 });
    await expect(round).toHaveCount(0);

    // Edge: dress-up tools, no face tools.
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
    await expect(round).toBeVisible({ timeout: 5000 });
    await expect(
      bar.getByRole("button", { name: "Connected" }),
    ).toBeVisible();
    await expect(hole).toHaveCount(0);

    // Sketch: extrude + edit, nothing else.
    const sk = (await window.evaluate(() =>
      (
        window as unknown as {
          __kreoda_test: {
            createRectSketch: (w: number, h: number) => Promise<Snapshot>;
          };
        }
      ).__kreoda_test.createRectSketch(60, 40),
    )) as Snapshot;
    expect(sk.sketches).toHaveLength(1);
    await expect(
      bar.getByRole("button", { name: "Pull sketch" }),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      bar.getByRole("button", { name: "Edit sketch" }),
    ).toBeVisible();
    await expect(hole).toHaveCount(0);
    await expect(round).toHaveCount(0);

    // Single body: placed copy only, no boolean trio, no fake transforms.
    await window.evaluate(
      (ids: string[]) =>
        (
          window as unknown as {
            __kreoda_test: { selectMany: (ids: string[]) => unknown };
          }
        ).__kreoda_test.selectMany(ids),
      [idA],
    );
    await expect(
      bar.getByRole("button", { name: "Copy placed" }),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      bar.getByRole("button", { name: "Subtract" }),
    ).toHaveCount(0);

    // Two bodies: boolean trio; Subtract commits through the real op.
    await window.evaluate(
      ({ a, b }) =>
        (
          window as unknown as {
            __kreoda_test: { selectMany: (ids: string[]) => unknown };
          }
        ).__kreoda_test.selectMany([a, b]),
      { a: idA, b: idB },
    );
    await expect(
      bar.getByRole("button", { name: "Combine" }),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      bar.getByRole("button", { name: "Subtract" }),
    ).toBeVisible();
    await expect(
      bar.getByRole("button", { name: "Overlap" }),
    ).toBeVisible();
    await bar.getByRole("button", { name: "Subtract" }).click();
    await expect
      .poll(async () => (await snapOf(window)).bodies.length, {
        timeout: 30000,
      })
      .toBe(3);

    // Altro → Properties opens the drawer on demand (closed by default).
    s = (await snapOf(window)) as Snapshot;
    const cutId = s.bodies.find((b) => b.id !== idA && b.id !== idB)!.id;
    await window.evaluate(
      (ids: string[]) =>
        (
          window as unknown as {
            __kreoda_test: { selectMany: (ids: string[]) => unknown };
          }
        ).__kreoda_test.selectMany(ids),
      [cutId],
    );
    await expect(window.getByTestId("properties-drawer")).not.toBeVisible();
    await bar.getByRole("button", { name: "More actions" }).click();
    await bar.getByRole("button", { name: "Properties" }).click();
    await expect(window.getByTestId("properties-drawer")).toBeVisible({
      timeout: 5000,
    });

    await window.screenshot({ path: path.join(HERE, "context-actions.png") });
  } finally {
    await app.close();
  }
});
