import { test, expect } from "@playwright/test";
import { frameMessage } from "@kreoda/protocol";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  boot,
  hideForBackgroundE2E,
  openMore,
  runBar,
  snapOf,
  type Snapshot,
} from "./helpers";

let queryId = 0;

interface NativeBrepSummary {
  revision: number;
  result: { volumeMm3: number; solidCount: number; bboxMm: number[] };
}

async function nativeBrepSummary(page: import("@playwright/test").Page, featureId: string): Promise<NativeBrepSummary> {
  const request = Buffer.from(frameMessage(Buffer.from(JSON.stringify({
    protocolVersion: 1,
    requestId: `phase15-section-${++queryId}`,
    documentId: "doc-phase1",
    type: 30,
    method: "getBoundingBox",
    params: { featureId },
  })))).toString("base64");
  const response = await page.evaluate((frame) => window.kreoda.invoke(frame), request);
  const parsed = JSON.parse(Buffer.from(response, "base64").toString("utf8")) as {
    status: string;
    errorMessage?: string;
    revision: number;
    result: NativeBrepSummary["result"];
  };
  if (parsed.status !== "ok") throw new Error(parsed.errorMessage ?? "native B-Rep query failed");
  return { revision: parsed.revision, result: parsed.result };
}

async function nativeKernelInfo(page: import("@playwright/test").Page): Promise<{ occtVersion: string }> {
  const request = Buffer.from(frameMessage(Buffer.from(JSON.stringify({
    protocolVersion: 1,
    requestId: `phase15-section-kernel-${++queryId}`,
    documentId: "doc-phase1",
    type: 1,
    payload: {},
  })))).toString("base64");
  const response = await page.evaluate((frame) => window.kreoda.invoke(frame), request);
  return JSON.parse(Buffer.from(response, "base64").toString("utf8")) as { occtVersion: string };
}

async function sectionStats(page: import("@playwright/test").Page) {
  return page.evaluate(() => (
    window as unknown as {
      __kreoda_test: {
        viewportRenderStats: () => { section: { enabled: boolean; plane: unknown; cappedBodies: number; contourSegments: number } } | null;
      };
    }
  ).__kreoda_test.viewportRenderStats()?.section ?? null);
}

async function viewportFrameCount(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => (
    window as unknown as { __kreoda_test: { viewportRenderStats: () => { renderedFrames: number } | null } }
  ).__kreoda_test.viewportRenderStats()?.renderedFrames ?? 0);
}

async function redrawViewport(page: import("@playwright/test").Page): Promise<void> {
  const frames = await viewportFrameCount(page);
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await expect.poll(async () => viewportFrameCount(page)).toBeGreaterThan(frames);
}

async function clearSelection(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => (
    window as unknown as { __kreoda_test: { selectMany: (ids: string[]) => unknown } }
  ).__kreoda_test.selectMany([]));
}

async function openSectionControls(page: import("@playwright/test").Page): Promise<void> {
  await openMore(page);
  if (!(await page.getByTestId("section-controls").isVisible())) {
    await page.getByTestId("section-open").click();
  }
  await expect(page.getByTestId("section-controls")).toBeVisible();
}

async function closeMore(page: import("@playwright/test").Page): Promise<void> {
  const button = page.getByTestId("workspace-topdock").getByRole("button", { name: "More" });
  if (await button.getAttribute("aria-expanded") === "true") await button.click();
  await expect(page.getByTestId("more-menu")).toBeHidden();
  await expect(button).toHaveAttribute("aria-expanded", "false");
}

async function elementAtPointer(page: import("@playwright/test").Page, x: number, y: number) {
  return page.evaluate(({ px, py }) => {
    const element = document.elementFromPoint(px, py);
    return {
      tag: element?.tagName.toLowerCase() ?? null,
      testId: element?.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
      isCanvas: element instanceof HTMLCanvasElement,
    };
  }, { px: x, py: y });
}

async function viewportScreenshot(
  app: Awaited<ReturnType<typeof boot>>["app"],
  page: import("@playwright/test").Page,
): Promise<Buffer> {
  const clip = await page.getByTestId("viewport").evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });
  const base64 = await app.evaluate(async ({ BrowserWindow }, rect: { x: number; y: number; width: number; height: number }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error("Electron viewport window missing");
    const image = await window.webContents.capturePage(rect, { stayHidden: true });
    return image.toPNG().toString("base64");
  }, clip);
  return Buffer.from(base64, "base64");
}

test("native tangent face and retained-wall edge occlusion preserve real CAD selection", async () => {
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-section-boundary-"));
  const { app, window: page } = await boot({ ...process.env, KREODA_SESSION_PORT: "", KREODA_SESSION_TOKEN: "", KREODA_RECOVERY_DIR: profile }, [`--user-data-dir=${profile}`]);
  try {
    await hideForBackgroundE2E(app);
    await runBar(page, "box 100 60 20");
    const before = await snapOf(page);
    const id = before.bodies[0]!.id;
    const brep = await nativeBrepSummary(page, id);
    await page.getByTestId("view-cube").getByRole("button", { name: "Top view" }).click();
    await openSectionControls(page);
    await page.getByTestId("section-enable").click();
    await page.getByTestId("section-offset").fill("20");
    await page.getByTestId("section-offset").press("Tab");
    await expect.poll(() => sectionStats(page)).toMatchObject({ enabled: true, cappedBodies: 0 });
    await closeMore(page);
    const anchor = await page.evaluate((feature) => (window as unknown as { __kreoda_test: {
      faceScreenPoint: (id: string, role: string) => { x: number; y: number } | null;
    } }).__kreoda_test.faceScreenPoint(feature, "box.+Z"), id);
    expect(anchor).not.toBeNull();
    await clearSelection(page);
    await page.mouse.click(anchor!.x, anchor!.y);
    await expect.poll(async () => (await snapOf(page)).selectedIds).toContain(`${id}:box.+Z`);

    await openSectionControls(page);
    await page.getByTestId("section-offset").fill("5");
    await page.getByTestId("section-offset").press("Tab");
    await page.getByRole("button", { name: "edge", exact: true }).click();
    await closeMore(page);
    await page.getByTestId("view-cube").getByRole("button", { name: "Isometric view" }).click();
    const direction = await page.evaluate(() => (window as unknown as { __kreoda_test: {
      viewDir: () => [number, number, number];
    } }).__kreoda_test.viewDir());
    expect(direction[0]).toBeLessThan(0);
    expect(direction[1]).toBeGreaterThan(0);
    async function clickCadPoint(point: [number, number, number]) {
      const screen = await page.evaluate((p) => (window as unknown as { __kreoda_test: {
        projectPoint: (point: [number, number, number]) => { x: number; y: number } | null;
      } }).__kreoda_test.projectPoint(p), point);
      expect(screen).not.toBeNull();
      const bounds = await page.getByTestId("viewport").boundingBox();
      expect(bounds).not.toBeNull();
      await clearSelection(page);
      await page.mouse.click(bounds!.x + screen!.x, bounds!.y + screen!.y);
    }
    await clickCadPoint([0, 60, 10]);
    expect((await snapOf(page)).selectedIds).toEqual([]);
    await clickCadPoint([100, 0, 10]);
    await expect.poll(async () => (await snapOf(page)).selectedIds).toHaveLength(1);
    const visibleEdge = (await snapOf(page)).selectedIds[0]!;
    expect(visibleEdge).toContain("edge.");
    await openSectionControls(page);
    await page.getByTestId("section-enable").click();
    await closeMore(page);
    await clickCadPoint([0, 60, 10]);
    await expect.poll(async () => (await snapOf(page)).selectedIds).toHaveLength(1);
    const legacyEdge = (await snapOf(page)).selectedIds[0]!;
    expect(legacyEdge).toContain("box.-X");
    expect(legacyEdge).toContain("box.+Y");
    expect(await nativeBrepSummary(page, id)).toEqual(brep);
    expect((await snapOf(page)).revision).toBe(before.revision);
    writeFileSync(test.info().outputPath("native-section-boundary-proof.json"), JSON.stringify({
      kernel: (await nativeKernelInfo(page)).occtVersion, tangentNativeFacePicked: `${id}:box.+Z`,
      hiddenEdgeRejected: true, visibleEdgePicked: visibleEdge,
      sectionOffLegacyEdgePicked: legacyEdge, nativeBrepUnchanged: true,
    }, null, 2));
  } finally { await app.close(); }
});

test("native same-document tip swap retains active section", async () => {
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-section-tip-swap-"));
  const { app, window: page } = await boot({ ...process.env, KREODA_SESSION_PORT: "", KREODA_SESSION_TOKEN: "", KREODA_RECOVERY_DIR: profile }, [`--user-data-dir=${profile}`]);
  try {
    await hideForBackgroundE2E(app);
    await runBar(page, "box 100 60 20");
    const boxId = (await snapOf(page)).bodies[0]!.id;
    await openSectionControls(page);
    await page.getByTestId("section-enable").click();
    await page.getByTestId("section-offset").fill("7");
    await page.getByTestId("section-offset").press("Tab");
    await closeMore(page);
    await page.evaluate(({ id }) => (
      window as unknown as { __kreoda_test: { selectFace: (featureId: string, role: string) => unknown } }
    ).__kreoda_test.selectFace(id, "box.+Z"), { id: boxId });
    await page.evaluate(({ id }) => (
      window as unknown as { __kreoda_test: { makeHole: (target: string, role: string, x: number, y: number, diameter: number, mode: "throughAll" | "blind", depth: number) => Promise<unknown> } }
    ).__kreoda_test.makeHole(id, "box.+Z", 50, 30, 8, "blind", 15), { id: boxId });
    const snapshot = await snapOf(page);
    const hole = snapshot.bodies.find(body => body.type === "Hole");
    expect(hole).toBeTruthy();
    expect(snapshot.tips).toEqual([hole!.id]);
    await expect.poll(async () => sectionStats(page)).toMatchObject({ enabled: true, cappedBodies: 1 });
    await expect.poll(async () => (await sectionStats(page))?.plane).toMatchObject({ normal: [0, 0, 1], offsetMm: 7, inverted: false });
    const brep = await nativeBrepSummary(page, hole!.id);
    expect(brep.result.solidCount).toBe(1);
    expect(brep.result.volumeMm3).toBeCloseTo(120000 - Math.PI * 16 * 15, 2);
    writeFileSync(test.info().outputPath("native-tip-swap-proof.json"), JSON.stringify({ kernel: (await nativeKernelInfo(page)).occtVersion, tips: snapshot.tips, section: await sectionStats(page), brep, sameDocumentTipSwapRetainedSection: true }, null, 2));
  } finally { await app.close(); }
});

test("native section reveals blind-hole wall without changing CAD, IDs, B-Rep or Undo", async () => {
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-phase15-section-"));
  const icad = path.join(profile, "blind-hole.icad");
  let app: Awaited<ReturnType<typeof boot>>["app"] | undefined;
  try {
    const context = await boot({
      ...process.env,
      KREODA_SESSION_PORT: "",
      KREODA_SESSION_TOKEN: "",
      KREODA_RECOVERY_DIR: profile,
    }, [`--user-data-dir=${profile}`]);
    app = context.app;
    const page = context.window;
    await hideForBackgroundE2E(app);

    await openMore(page);
    await page.getByTestId("section-open").click();
    await expect(page.getByTestId("section-enable")).toBeDisabled();
    await expect(page.getByText("Add a solid to enable section view.")).toBeVisible();
    await page.getByTestId("workspace-topdock").getByRole("button", { name: "More" }).click();

    await runBar(page, "box 10 10 10");
    await expect.poll(async () => (await snapOf(page)).bodies.length).toBe(1);
    await openMore(page);
    await page.getByTestId("section-open").click();
    await page.getByTestId("section-enable").click();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await snapOf(page)).bodies.length).toBe(0);
    await expect.poll(async () => sectionStats(page)).toMatchObject({ enabled: false, cappedBodies: 0, contourSegments: 0 });
    await page.getByTestId("workspace-topdock").getByRole("button", { name: "More" }).click();

    await runBar(page, "box 100 60 20");
    await expect.poll(async () => (await snapOf(page)).bodies.length).toBe(1);
    const boxId = ((await snapOf(page)) as Snapshot).bodies[0]!.id;
    await page.evaluate(({ id }) => (
      window as unknown as { __kreoda_test: { selectFace: (featureId: string, role: string) => unknown } }
    ).__kreoda_test.selectFace(id, "box.+Z"), { id: boxId });
    await page.evaluate(({ id }) => (
      window as unknown as {
        __kreoda_test: { makeHole: (target: string, role: string, x: number, y: number, diameter: number, mode: "throughAll" | "blind", depth: number) => Promise<unknown> };
      }
    ).__kreoda_test.makeHole(id, "box.+Z", 50, 30, 8, "blind", 15), { id: boxId });

    const before = (await snapOf(page)) as Snapshot;
    const hole = before.bodies.find((body) => body.type === "Hole");
    expect(hole).toBeTruthy();
    expect(before.tips).toEqual([hole!.id]);
    const beforeBrep = await nativeBrepSummary(page, hole!.id);
    expect(beforeBrep.result.solidCount).toBe(1);
    expect(beforeBrep.result.volumeMm3).toBeCloseTo(120000 - Math.PI * 16 * 15, 2);
    const nativeMeshBefore = await page.evaluate(({ id }) => (
      window as unknown as { __kreoda_test: { meshIdentity: (featureId: string) => unknown } }
    ).__kreoda_test.meshIdentity(id), { id: hole!.id });
    await page.evaluate(({ p }) => (
      window as unknown as { __kreoda_test: { saveIcad: (filePath: string) => Promise<unknown> } }
    ).__kreoda_test.saveIcad(p), { p: icad });

    await page.getByTestId("view-cube").getByRole("button", { name: "Isometric view" }).click();
    await page.getByTestId("view-cube").getByRole("button", { name: "Top view" }).click();
    const viewportRect = await page.getByTestId("viewport").evaluate((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    });
    const orbitX = viewportRect.x + viewportRect.width / 2;
    const orbitY = viewportRect.y + viewportRect.height / 2;
    await page.mouse.move(orbitX, orbitY);
    await page.mouse.down();
    await page.mouse.move(orbitX, orbitY - 70, { steps: 5 });
    await page.mouse.up();
    const viewDir = await page.evaluate(() => (
      window as unknown as { __kreoda_test: { viewDir: () => [number, number, number] | null } }
    ).__kreoda_test.viewDir());
    expect(viewDir).not.toBeNull();
    expect(viewDir![2]).toBeLessThan(-0.9);
    expect(viewDir![2]).toBeGreaterThan(-0.98);
    await openSectionControls(page);
    const framesBeforeSection = await viewportFrameCount(page);
    await closeMore(page);
    await redrawViewport(page);
    const beforeCanvas = await viewportScreenshot(app, page);
    const beforePath = test.info().outputPath("native-section-before.png");
    writeFileSync(beforePath, beforeCanvas);
    await openSectionControls(page);
    await page.getByTestId("section-enable").click();
    await expect.poll(async () => viewportFrameCount(page)).toBeGreaterThan(framesBeforeSection);
    await expect(page.getByTestId("section-enable")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("section-axis")).toHaveValue("z");
    await expect(page.getByTestId("section-offset")).toHaveValue("10");

    await page.getByTestId("section-offset").fill("0");
    await page.getByTestId("section-offset").press("Tab");
    await page.getByTestId("section-enable").click();
    await page.getByTestId("section-enable").click();
    await expect(page.getByTestId("section-offset")).toHaveValue("0");
    await expect.poll(async () => (await sectionStats(page))?.plane).toMatchObject({
      normal: [0, 0, 1], offsetMm: 0, inverted: false,
    });
    await page.getByTestId("section-offset").fill("10");
    await page.getByTestId("section-offset").press("Tab");

    await page.getByTestId("section-axis").selectOption("x");
    await expect.poll(async () => (await sectionStats(page))?.plane).toMatchObject({ normal: [1, 0, 0], offsetMm: 50 });
    await page.getByTestId("section-axis").selectOption("y");
    await expect.poll(async () => (await sectionStats(page))?.plane).toMatchObject({ normal: [0, 1, 0], offsetMm: 30 });
    await page.getByTestId("section-invert").click();
    await expect.poll(async () => (await sectionStats(page))?.plane).toMatchObject({ inverted: true });
    const offset = page.getByTestId("section-offset");
    await offset.fill("1000001");
    await offset.press("Tab");
    await expect.poll(async () => (await sectionStats(page))?.plane).toMatchObject({ offsetMm: 30, inverted: true });
    await expect(offset).toHaveValue("30");
    await page.getByTestId("section-reset").click();
    await expect.poll(async () => sectionStats(page)).toMatchObject({
      enabled: false,
      cappedBodies: 0,
      contourSegments: 0,
    });
    await expect(page.getByTestId("section-axis")).toHaveValue("z");
    await expect(offset).toHaveValue("10");
    await expect(page.getByTestId("section-invert")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("section-enable").click();
    await expect.poll(async () => sectionStats(page)).toMatchObject({ enabled: true, cappedBodies: 1 });
    await expect.poll(async () => (await sectionStats(page))?.plane).toMatchObject({
      normal: [0, 0, 1], offsetMm: 10, inverted: false,
    });
    await expect.poll(async () => (await sectionStats(page))?.contourSegments ?? 0).toBeGreaterThan(0);
    await page.getByTestId("section-invert").click();
    await expect.poll(async () => (await sectionStats(page))?.plane).toMatchObject({
      normal: [0, 0, 1], offsetMm: 10, inverted: true,
    });
    await closeMore(page);
    await redrawViewport(page);
    const sectionCanvas = await viewportScreenshot(app, page);
    expect(sectionCanvas.equals(beforeCanvas)).toBe(false);
    const activePath = test.info().outputPath("native-section-active.png");
    writeFileSync(activePath, sectionCanvas);
    await test.info().attach("native-section-before.png", { path: beforePath, contentType: "image/png" });
    await test.info().attach("native-section-active.png", { path: activePath, contentType: "image/png" });

    const holeWallRole = hole!.faces
      .map((faceId) => faceId.slice(hole!.id.length + 1))
      .find((role) => role.startsWith("wall."));
    expect(holeWallRole, "native hole wall face role").toBeTruthy();
    const cutGeometry = await page.evaluate(({ id, role }) => (
      window as unknown as {
        __kreoda_test: {
          sectionGeometryDiagnostics: (
            featureId: string,
            sample: [number, number, number],
            faceRole: string,
          ) => {
            capTriangleCount: number;
            capAreaMm2: number;
            capCoversSample: boolean;
            rayCandidates: number;
            frontSideWallHits: number;
            frontSideUnoccludedWallHits: number;
            doubleSideWallHits: number;
            capOccludesDoubleSideWallHits: number;
            productionWallHits: number;
            nativeMaterialSides: string[];
            nativeFace: { persistentFaceId: string; triangleCount: number; zBoundsMm: [number, number]; windingOpposedTriangles: number } | null;
          } | null;
        };
      }
    ).__kreoda_test.sectionGeometryDiagnostics(id, [50, 30, 10], role!), { id: hole!.id, role: holeWallRole });
    expect(cutGeometry).not.toBeNull();
    expect(cutGeometry!.capTriangleCount).toBeGreaterThan(0);
    expect(cutGeometry!.capAreaMm2).toBeGreaterThan(5940);
    expect(cutGeometry!.capAreaMm2).toBeLessThan(5960);
    expect(cutGeometry!.capCoversSample, "hole center remains open in the rendered cap").toBe(false);
    expect(cutGeometry!.nativeFace?.triangleCount).toBeGreaterThan(0);
    expect(cutGeometry!.nativeFace!.zBoundsMm[0]).toBeLessThan(10);
    expect(cutGeometry!.nativeFace!.zBoundsMm[1]).toBeGreaterThan(10);
    expect(cutGeometry!.nativeFace!.windingOpposedTriangles).toBeGreaterThan(0);
    expect(cutGeometry!.doubleSideWallHits).toBeGreaterThan(cutGeometry!.frontSideWallHits);
    expect(cutGeometry!.productionWallHits).toBeGreaterThan(0);
    expect(cutGeometry!.nativeMaterialSides).toEqual(["double", "double", "double", "double"]);
    console.log("native section geometry diagnostics", JSON.stringify({ viewDir, cutGeometry }));
    const anchor = await page.evaluate(({ id, role }) => (
      window as unknown as {
        __kreoda_test: { faceScreenPoint: (featureId: string, faceRole: string) => { x: number; y: number; normal: [number, number, number]; point: [number, number, number] } | null };
      }
    ).__kreoda_test.faceScreenPoint(id, role!), { id: hole!.id, role: holeWallRole });
    expect(anchor, "visible native hole wall anchor through open cap").not.toBeNull();
    expect(anchor!.point[2], "native wall point lies inside retained lower half").toBeLessThanOrEqual(10);
    expect(anchor!.normal[0] * viewDir![0] + anchor!.normal[1] * viewDir![1] + anchor!.normal[2] * viewDir![2])
      .toBeLessThan(0);

    // Keep the camera ray fixed. Without the cut, the uncut exterior roof must
    // occlude this same interior-wall point; with the cut, the cap aperture
    // exposes the native OCCT wall face for selection.
    await openSectionControls(page);
    await page.getByTestId("section-enable").click();
    await expect.poll(async () => sectionStats(page)).toMatchObject({ enabled: false, cappedBodies: 0 });
    const coveredTarget = await elementAtPointer(page, anchor!.x, anchor!.y);
    await closeMore(page);
    const canvasTarget = await elementAtPointer(page, anchor!.x, anchor!.y);
    expect(canvasTarget.isCanvas, "same ray is actionable on viewport after closing More menu").toBe(true);
    await clearSelection(page);
    await expect.poll(async () => (await snapOf(page)).selectedIds).toEqual([]);
    await page.mouse.click(anchor!.x, anchor!.y);
    await expect.poll(async () => (await snapOf(page)).selectedIds).toContain(`${hole!.id}:box.+Z`);
    await openSectionControls(page);
    await page.getByTestId("section-enable").click();
    await expect.poll(async () => sectionStats(page)).toMatchObject({ enabled: true, cappedBodies: 1 });
    await closeMore(page);
    expect((await elementAtPointer(page, anchor!.x, anchor!.y)).isCanvas).toBe(true);
    await clearSelection(page);
    await expect.poll(async () => (await snapOf(page)).selectedIds).toEqual([]);
    await page.mouse.click(anchor!.x, anchor!.y);
    await expect.poll(async () => (await snapOf(page)).selectedIds).toContain(`${hole!.id}:${holeWallRole}`);

    const afterSection = (await snapOf(page)) as Snapshot;
    const afterBrep = await nativeBrepSummary(page, hole!.id);
    const nativeMeshAfter = await page.evaluate(({ id }) => (
      window as unknown as { __kreoda_test: { meshIdentity: (featureId: string) => unknown } }
    ).__kreoda_test.meshIdentity(id), { id: hole!.id });
    expect(afterSection.revision).toBe(before.revision);
    expect(afterBrep.revision).toBe(beforeBrep.revision);
    expect(afterBrep.result.solidCount).toBe(beforeBrep.result.solidCount);
    expect(afterBrep.result.volumeMm3).toBe(beforeBrep.result.volumeMm3);
    expect(nativeMeshAfter).toEqual(nativeMeshBefore);
    expect(afterSection.bodies.map(({ id, type, volumeMm3, faces }) => ({ id, type, volumeMm3, faces })))
      .toEqual(before.bodies.map(({ id, type, volumeMm3, faces }) => ({ id, type, volumeMm3, faces })));
    expect(afterSection.tips).toEqual(before.tips);

    await openSectionControls(page);
    await page.getByTestId("section-enable").click();
    await expect.poll(async () => sectionStats(page)).toMatchObject({ enabled: false, cappedBodies: 0, contourSegments: 0 });
    const sidesAfterDisable = await page.evaluate(({ id, role }) => (
      window as unknown as {
        __kreoda_test: {
          sectionGeometryDiagnostics: (
            featureId: string,
            sample: [number, number, number],
            faceRole: string,
          ) => { nativeMaterialSides: string[] } | null;
        };
      }
    ).__kreoda_test.sectionGeometryDiagnostics(id, [50, 30, 10], role!)?.nativeMaterialSides ?? null, {
      id: hole!.id,
      role: holeWallRole,
    });
    expect(sidesAfterDisable).toEqual(["front", "front", "front", "front"]);

    // A committed native remesh must retain section state; Undo must still
    // reverse the CAD edit while the same presentation plane stays active.
    await page.getByTestId("section-enable").click();
    const meshBeforeRemesh = await page.evaluate(({ id }) => (
      window as unknown as { __kreoda_test: { meshIdentity: (featureId: string) => unknown } }
    ).__kreoda_test.meshIdentity(id), { id: hole!.id });
    await page.evaluate(({ id }) => (
      window as unknown as { __kreoda_test: { setParam: (featureId: string, name: string, value: number) => Promise<Snapshot> } }
    ).__kreoda_test.setParam(id, "widthMm", 120), { id: boxId });
    await expect.poll(async () => sectionStats(page)).toMatchObject({ enabled: true, plane: { offsetMm: 10 } });
    const meshAfterRemesh = await page.evaluate(({ id }) => (
      window as unknown as { __kreoda_test: { meshIdentity: (featureId: string) => unknown } }
    ).__kreoda_test.meshIdentity(id), { id: hole!.id });
    expect(meshAfterRemesh).not.toEqual(meshBeforeRemesh);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await snapOf(page)).bodies.find((body) => body.id === boxId)?.paramsMm[0]).toBe(100);
    await expect.poll(async () => sectionStats(page)).toMatchObject({ enabled: true, plane: { offsetMm: 10 } });
    // The document boundary remains authoritative while Home unmounts Viewport.
    await closeMore(page);
    await page.getByTestId("back-home").click();
    await expect(page.getByTestId("viewport")).toHaveCount(0);
    await page.evaluate(({ p }) => (
      window as unknown as { __kreoda_test: { openIcad: (filePath: string) => Promise<Snapshot> } }
    ).__kreoda_test.openIcad(p), { p: icad });
    await expect(page.getByTestId("home-screen")).toBeVisible();
    expect((await snapOf(page)).bodies.length).toBeGreaterThan(0);
    await page.getByTestId("home-new-project").click();
    await expect(page.getByTestId("viewport")).toBeVisible();
    await expect.poll(async () => sectionStats(page)).toMatchObject({
      enabled: false,
      plane: null,
      cappedBodies: 0,
      contourSegments: 0,
    });
    await openSectionControls(page);
    await expect(page.getByTestId("section-axis")).toHaveValue("z");
    await expect(page.getByTestId("section-offset")).toHaveValue("0");
    await expect(page.getByTestId("section-invert")).toHaveAttribute("aria-pressed", "false");
    const coreInfo = await nativeKernelInfo(page);
    expect(coreInfo.occtVersion).toBeTruthy();
    expect(coreInfo.occtVersion).not.toBe("unlinked");
    const proof = {
      kernel: coreInfo.occtVersion,
      viewportFramesBeforeSection: framesBeforeSection,
      viewportFramesWithSection: await viewportFrameCount(page),
      before: { revision: beforeBrep.revision, featureIds: before.bodies.map((body) => body.id), volumeMm3: beforeBrep.result.volumeMm3, solidCount: beforeBrep.result.solidCount },
      afterSection: { revision: afterBrep.revision, featureIds: afterSection.bodies.map((body) => body.id), volumeMm3: afterBrep.result.volumeMm3, solidCount: afterBrep.result.solidCount },
      section: await sectionStats(page),
      nativeInteriorFacePicked: `${hole!.id}:${holeWallRole}`,
      uncutSameRayHit: `${hole!.id}:box.+Z`,
      elementAtAnchorWithMoreOpen: coveredTarget,
      elementAtAnchorWithMoreClosed: canvasTarget,
      sameRayScreenClientPx: [anchor!.x, anchor!.y],
      anchorWorldPointMm: anchor!.point,
      anchorNativeOutwardNormal: anchor!.normal,
      sectionGeometry: cutGeometry,
      nativeSidesRestoredAfterDisable: sidesAfterDisable,
      capAndContourRendered: true,
      remeshRetainedSection: true,
      undoReversedNativeEdit: true,
      successfulOpenResetSection: true,
      documentOpenedWhileHome: true,
    };
    const proofPath = test.info().outputPath("native-section-proof.json");
    writeFileSync(proofPath, JSON.stringify(proof, null, 2));
    await test.info().attach("native-section-proof.json", {
      path: proofPath,
      contentType: "application/json",
    });
  } finally {
    await app?.close();
  }
});
