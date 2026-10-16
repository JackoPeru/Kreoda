import { test, expect } from "@playwright/test";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { SketchModel, SketchProjectionDefinition } from "@kreoda/protocol";
import { boot, HERE, type Snapshot } from "./helpers";

interface ProjectionTestApi {
  snapshot(): Snapshot;
  createProjectionSketch(model: SketchModel): Promise<Snapshot>;
  seedProjectionForOpenTest(featureId: string, groupId: string, definition: SketchProjectionDefinition): Promise<Snapshot>;
  editProjectionSourceCircle(featureId: string, radiusMm: number, entityId?: string): Promise<Snapshot>;
  nativeProjection(featureId: string, groupId?: string): Promise<{
    documentId: string; revision: number; projection: import("@kreoda/protocol").SketchProjectionResult;
  }>;
  openSketch(featureId: string): Snapshot;
  extrudeSketch(featureId: string, depthMm: number): Promise<Snapshot>;
  saveIcad(path: string): Promise<Snapshot>;
  openIcad(path: string): Promise<Snapshot>;
  selectMany(ids: string[]): Snapshot;
  projectionRenderSummary(featureId: string): { lineCount: number; pointsMm: [number, number, number][] } | null;
  meshIdentity(featureId: string): { geometryId: string; revision: number } | null;
}

function removeProfile(profile: string): void {
  const root = realpathSync(os.tmpdir());
  const target = realpathSync(profile);
  const relative = path.relative(root, target);
  if (!relative || path.isAbsolute(relative) || path.dirname(relative) !== "." ||
      !path.basename(target).startsWith("kreoda-projection-desktop-"))
    throw new Error("Refusing to remove a profile outside its isolated temporary directory");
  rmSync(target, { recursive: true, force: true });
}

async function breakPersistedBinding(healthyFile: string, brokenFile: string): Promise<Record<string, unknown>> {
  const probe = path.resolve(HERE, "../../../clients/session-dotnet/probes/Kreoda.McpProbe/bin/Release/net8.0/Kreoda.McpProbe.dll");
  if (!existsSync(probe)) throw new Error(`Native archive proof helper is missing: ${probe}`);
  const child = spawn("dotnet", [probe], { windowsHide: true, env: {
    ...process.env,
    KREODA_MCP_PROBE_SCENARIO: "projection-archive-break",
    KREODA_PROJECTION_HEALTHY_FILE: healthyFile,
    KREODA_PROJECTION_BROKEN_FILE: brokenFile,
  } as Record<string, string> });
  let stdout = "", stderr = "";
  const exitCode = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("Projection archive rewrite timed out")); }, 30000);
    child.stdout?.on("data", chunk => { stdout = (stdout + String(chunk)).slice(-65536); });
    child.stderr?.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-8000); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => { clearTimeout(timer); resolve(code ?? -1); });
  });
  if (exitCode !== 0) throw new Error(`Projection archive rewrite failed (${exitCode}): ${stderr.trim()} ${stdout.trim()}`);
  const resultLine = stdout.trim().split(/\r?\n/).reverse().find(line => line.startsWith("{"));
  if (!resultLine) throw new Error(`Projection archive rewrite returned no proof: ${stderr.trim()} ${stdout.trim()}`);
  return JSON.parse(resultLine) as Record<string, unknown>;
}

test.use({ trace: "off" });

test("hidden Desktop opens, edits, repairs, undoes and reopens native sketch projections", async () => {
  test.setTimeout(240000);
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-projection-desktop-"));
  const archive = path.join(profile, "projection-roundtrip.icad");
  const brokenArchive = path.join(profile, "projection-broken.icad");
  let app: Awaited<ReturnType<typeof boot>>["app"] | undefined;
  try {
    const launched = await boot({
      ...process.env,
      KREODA_BACKGROUND_TEST: "1",
      KREODA_SESSION_PORT: "",
      KREODA_SESSION_TOKEN: "",
      KREODA_RECOVERY_DIR: profile,
    }, [`--user-data-dir=${profile}`]);
    app = launched.app;
    const { window } = launched;
    const sourceModel: SketchModel = {
      points: [{ id: "center", x: 0, y: 0, fixed: true }],
      lines: [], circles: [{ id: "circle", center: "center", r: 5 }], arcs: [], constraints: [],
    };
    const emptyModel: SketchModel = { points: [], lines: [], circles: [], arcs: [], constraints: [] };
    const sourceCreated = await window.evaluate(model =>
      (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.createProjectionSketch(model), sourceModel);
    const sourceId = sourceCreated.sketches.find(sketch => sketch.circles === 1)!.id;
    const targetCreated = await window.evaluate(model =>
      (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.createProjectionSketch(model), emptyModel);
    const targetId = targetCreated.sketches.find(sketch => sketch.id !== sourceId && sketch.points === 0)!.id;
    const definition: SketchProjectionDefinition = {
      version: 1, operation: "projectEdges",
      sources: [{ type: "sketchEntities", featureId: sourceId, entityIds: ["circle"] }],
    };

    // A native seed gives the empty target an authoritative projection before
    // the editor opens. The UI then proves opening it does not add a rectangle.
    const seeded = await window.evaluate(({ featureId, definition }) =>
      (window as unknown as { __kreoda_test: ProjectionTestApi & {
        seedProjectionForOpenTest(id: string, groupId: string, definition: SketchProjectionDefinition): Promise<Snapshot>
      } }).__kreoda_test.seedProjectionForOpenTest(featureId, "pg-open-seed", definition),
    { featureId: targetId, definition });
    const openRevision = seeded.revision;
    const seededGroup = seeded.sketches.find(sketch => sketch.id === targetId)!.projectionGroups![0]!;
    expect(seededGroup).toMatchObject({ groupId: "pg-open-seed", status: "ok" });

    await window.evaluate(id =>
      (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.openSketch(id), targetId);
    const canvas = window.getByTestId("sketch-canvas");
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const opening = await window.evaluate(() =>
      (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.snapshot());
    expect(opening.revision).toBe(openRevision);
    expect(opening.sketches.find(sketch => sketch.id === targetId)).toMatchObject({
      points: 0, lines: 0, circles: 0, arcs: 0,
      projectionGroups: [expect.objectContaining({ groupId: "pg-open-seed", status: "ok" })],
    });
    const projectionLines = window.getByTestId("sketch-projection-lines");
    await expect(projectionLines).toBeVisible();
    expect(await projectionLines.getAttribute("data-read-only")).toBe("true");
    expect(await projectionLines.evaluate(element => getComputedStyle(element).pointerEvents)).toBe("none");
    expect(await projectionLines.locator("path").count()).toBeGreaterThan(0);
    const editorBox = await window.getByTestId("sketch-editor-window").boundingBox();
    const canvasBox = await canvas.boundingBox();
    const panelBox = await window.getByTestId("sketch-projection-panel").boundingBox();
    expect(editorBox && canvasBox && panelBox).toBeTruthy();
    expect(canvasBox!.x).toBeGreaterThanOrEqual(editorBox!.x);
    expect(canvasBox!.x + canvasBox!.width).toBeLessThanOrEqual(editorBox!.x + editorBox!.width + 1);
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(editorBox!.x + editorBox!.width + 1);

    const panel = window.getByTestId("sketch-projection-panel");
    await panel.locator("summary").click();
    const groupSelect = window.getByLabel("Projection group");
    await groupSelect.selectOption("pg-open-seed");
    await window.getByRole("button", { name: "Remove", exact: true }).click();
    await expect.poll(async () =>
      (await window.evaluate(() => (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.snapshot()))
        .sketches.find(sketch => sketch.id === targetId)?.projectionGroups?.length,
    ).toBe(0);

    await window.evaluate(id =>
      (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.selectMany([id]), sourceId);
    await window.getByRole("button", { name: "Use selection" }).click();
    const sourceSelect = window.getByLabel("Projection source");
    await expect.poll(() => sourceSelect.inputValue()).toBe(`sketch:${sourceId}`);
    await window.getByRole("button", { name: "Create", exact: true }).click();
    await expect.poll(async () =>
      (await window.evaluate(() => (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.snapshot()))
        .sketches.find(sketch => sketch.id === targetId)?.projectionGroups?.length,
    ).toBe(1);
    let snapshot = await window.evaluate(() =>
      (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.snapshot());
    let target = snapshot.sketches.find(sketch => sketch.id === targetId)!;
    let groupId = target.projectionGroups![0]!.groupId;
    expect(groupId).not.toBe("pg-open-seed");
    expect(target.projectionGroups![0]!.definition.sources).toEqual([
      { type: "sketchEntities", featureId: sourceId, entityIds: ["circle"] },
    ]);
    const query = await window.evaluate(({ featureId, groupId }) =>
      (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.nativeProjection(featureId, groupId),
    { featureId: targetId, groupId });
    expect(query.projection).toMatchObject({ geometryCurrent: true, status: "ok", featureId: targetId });
    expect(query.projection.groups[0]!.edges.length).toBeGreaterThan(0);
    await expect.poll(async () => window.evaluate(id =>
      (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.projectionRenderSummary(id), targetId))
      .not.toBeNull();
    const worldView = await window.evaluate(id =>
      (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.projectionRenderSummary(id), targetId);
    expect(worldView?.lineCount).toBeGreaterThan(0);
    expect(worldView?.pointsMm.length).toBeGreaterThan(2);
    expect(worldView?.pointsMm.every(point => point.every(Number.isFinite))).toBe(true);

    const extruded = await window.evaluate(({ id }) =>
      (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.extrudeSketch(id, 10), { id: targetId });
    let solidId = extruded.bodies[0]!.id;
    expect(extruded.bodies[0]!.volumeMm3).toBeCloseTo(Math.PI * 25 * 10, 2);

    await window.evaluate(({ id, radius }) =>
      (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.editProjectionSourceCircle(id, radius),
    { id: sourceId, radius: 6 });
    await expect.poll(async () => {
      const state = await window.evaluate(() => (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.snapshot());
      return state.bodies.find(body => body.id === solidId)?.volumeMm3;
    }, { timeout: 30000 }).toBeCloseTo(Math.PI * 36 * 10, 2);

    await window.evaluate(file =>
      (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.saveIcad(file), archive);
    const archiveProof = await breakPersistedBinding(archive, brokenArchive);
    expect(archiveProof).toMatchObject({ status: "rewritten", replacementCount: 1, bindingUnchanged: true });
    expect(existsSync(brokenArchive)).toBe(true);
    await window.getByRole("button", { name: "Done" }).click();
    await expect(canvas).not.toBeVisible();
    const broken = await window.evaluate(file =>
      (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.openIcad(file), brokenArchive);
    const unavailable = broken.bodies.find(body => body.id === solidId)!;
    expect(unavailable).toMatchObject({ geometryCurrent: false, status: "unavailable", triangles: -1 });
    expect(unavailable.volumeMm3).toBeUndefined();
    await window.evaluate(id =>
      (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.openSketch(id), targetId);
    await expect(canvas).toBeVisible();
    await panel.locator("summary").click();
    await expect.poll(async () =>
      window.getByLabel("Projection source").locator(`option[value="sketch:${sourceId}"]`).count(),
    ).toBe(1);
    const loadedProjection = await window.evaluate(({ id, groupId }) =>
      (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.nativeProjection(id, groupId),
    { id: targetId, groupId });
    expect(loadedProjection.projection).toMatchObject({ geometryCurrent: false, status: "unavailable" });

    await groupSelect.selectOption(groupId);
    await window.evaluate(id =>
      (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.selectMany([id]), sourceId);
    await window.getByRole("button", { name: "Use selection" }).click();
    await expect.poll(() => sourceSelect.inputValue()).toBe(`sketch:${sourceId}`);
    await window.getByRole("button", { name: "Repair selected group" }).click();
    await expect.poll(async () => {
      const state = await window.evaluate(() => (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.snapshot());
      return state.sketches.find(sketch => sketch.id === targetId)?.projectionGroups?.[0]?.status;
    }, { timeout: 30000 }).toBe("ok");
    snapshot = await window.evaluate(() =>
      (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.snapshot());
    target = snapshot.sketches.find(sketch => sketch.id === targetId)!;
    expect(target.projectionGroups![0]).toMatchObject({
      groupId, sourceFeatureIds: [sourceId], definition: { sources: [{ entityIds: ["circlX"] }] },
    });
    const repairedVolume = snapshot.bodies.find(body => body.id === solidId)!.volumeMm3;
    expect(repairedVolume).toBeCloseTo(Math.PI * 36 * 10, 2);

    await window.getByRole("button", { name: "Done" }).click();
    await expect(canvas).not.toBeVisible();
    await window.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => {
      const state = await window.evaluate(() => (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.snapshot());
      return state.bodies.find(body => body.id === solidId)?.volumeMm3;
    }, { timeout: 30000 }).toBeUndefined();
    const undoProjection = await window.evaluate(({ id, groupId }) =>
      (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.nativeProjection(id, groupId),
    { id: targetId, groupId });
    expect(undoProjection.projection).toMatchObject({ geometryCurrent: false, status: "unavailable" });
    await window.getByRole("button", { name: "Redo" }).click();
    await expect.poll(async () => {
      const state = await window.evaluate(() => (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.snapshot());
      return state.bodies.find(body => body.id === solidId)?.volumeMm3;
    }, { timeout: 30000 }).toBeCloseTo(Math.PI * 36 * 10, 2);

    await window.evaluate(file =>
      (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.saveIcad(file), archive);
    const reopened = await window.evaluate(file =>
      (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.openIcad(file), archive);
    expect(reopened.sketches.find(sketch => sketch.id === targetId)?.projectionGroups).toEqual([
      expect.objectContaining({ groupId, status: "ok" }),
    ]);
    expect(reopened.bodies.find(body => body.id === solidId)?.volumeMm3).toBeCloseTo(Math.PI * 36 * 10, 2);
    await window.evaluate(id =>
      (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.openSketch(id), targetId);
    await expect(canvas).toBeVisible();
    await expect(window.getByTestId("sketch-projection-lines")).toBeVisible();
    const afterOpen = await window.evaluate(() =>
      (window as unknown as { __kreoda_test: ProjectionTestApi }).__kreoda_test.snapshot());
    expect(afterOpen.sketches.find(sketch => sketch.id === targetId)).toMatchObject({
      points: 0, lines: 0, circles: 0,
      projectionGroups: [expect.objectContaining({ groupId, status: "ok" })],
    });

    const evidence = path.resolve(HERE, "../../../docs/superpowers/evidence/2026-10-16-projection-desktop");
    mkdirSync(evidence, { recursive: true });
    writeFileSync(path.join(evidence, "native-e2e-proof.json"), JSON.stringify({
      kernel: "hidden Electron Desktop with native CoreClient commands",
      sourceId, targetId, groupId, solidId,
      openRevision, finalRevision: afterOpen.revision,
      volumeAfterSourceEditMm3: Math.PI * 36 * 10,
      persistedBindingBreak: archiveProof,
      repairPreservedGroupAndSolidIds: true,
      undoRestoredUnavailableProjection: true,
      saveOpenPreservedProjectionAndVolume: true,
      viewportWorldLineCount: worldView?.lineCount,
      screenshots: 0,
      backgroundWindowVerifiedAtLaunch: true,
    }, null, 2));
  } finally {
    await app?.close().catch(() => {});
    removeProfile(profile);
  }
});
