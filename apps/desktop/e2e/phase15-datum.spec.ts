import { test, expect } from "@playwright/test";
import { CommandType, frameMessage, PROTOCOL_VERSION } from "@kreoda/protocol";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, openMore, snapOf } from "./helpers";

let queryId = 0;

interface NativeFeature {
  featureId: string;
  type: string;
  volumeMm3: number;
}

interface NativeSnapshot {
  requestId: string;
  status: string;
  features: NativeFeature[];
  sketches: { featureId: string; supportRef?: string }[];
  datums: { featureId: string; resolved: { originMm?: number[] } }[];
}

interface NativeBrepSummary {
  revision: number;
  result: { volumeMm3: number; solidCount: number; bboxMm: number[] };
}

async function readNativeSnapshot(page: import("@playwright/test").Page): Promise<NativeSnapshot> {
  const requestId = `phase15-datum-snapshot-${++queryId}`;
  const frame = frameMessage(new TextEncoder().encode(JSON.stringify({
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    documentId: "",
    type: CommandType.RequestSnapshot,
    includeReferencePlanes: true,
  })));
  const response = await page.evaluate((payload) => window.kreoda.invoke(payload), Buffer.from(frame).toString("base64"));
  const parsed = JSON.parse(Buffer.from(response, "base64").toString("utf8")) as NativeSnapshot;
  if (parsed.status !== "ok" || parsed.requestId !== requestId) throw new Error("native snapshot failed");
  return parsed;
}

async function nativeBrepSummary(page: import("@playwright/test").Page, featureId: string): Promise<NativeBrepSummary> {
  const frame = frameMessage(new TextEncoder().encode(JSON.stringify({
    protocolVersion: PROTOCOL_VERSION,
    requestId: `phase15-datum-measure-${++queryId}`,
    documentId: "doc-phase1",
    type: 30,
    method: "getBoundingBox",
    params: { featureId },
  })));
  const response = await page.evaluate((payload) => window.kreoda.invoke(payload), Buffer.from(frame).toString("base64"));
  const parsed = JSON.parse(Buffer.from(response, "base64").toString("utf8")) as {
    status: string;
    errorMessage?: string;
    revision: number;
    result: NativeBrepSummary["result"];
  };
  if (parsed.status !== "ok") throw new Error(parsed.errorMessage ?? "native B-Rep query failed");
  return { revision: parsed.revision, result: parsed.result };
}

async function expectExtrudeGeometry(page: import("@playwright/test").Page, featureId: string, zMin: number, zMax: number) {
  await expect.poll(async () => {
    const { result } = await nativeBrepSummary(page, featureId);
    return result.solidCount === 1 && Math.abs(result.volumeMm3 - 35000) < 0.01 &&
      Math.abs(result.bboxMm[2]! - zMin) < 1e-6 && Math.abs(result.bboxMm[5]! - zMax) < 1e-6;
  }, { timeout: 30000 }).toBe(true);
  const result = (await nativeBrepSummary(page, featureId)).result;
  expect(result.volumeMm3).toBeCloseTo(35000, 2);
  expect(result.bboxMm[2]).toBeCloseTo(zMin, 5);
  expect(result.bboxMm[5]).toBeCloseTo(zMax, 5);
  return result;
}

test("native datum edit, supported extrude, save/open and undo stay coherent in hidden Electron", async () => {
  test.setTimeout(120000);
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-phase15-datum-"));
  const { app, window } = await boot({
    ...process.env,
    KREODA_BACKGROUND_TEST: "1",
    KREODA_SESSION_PORT: "",
    KREODA_SESSION_TOKEN: "",
    KREODA_RECOVERY_DIR: profile,
  }, [`--user-data-dir=${profile}`]);
  try {
    await openMore(window);
    await window.getByTestId("reference-geometry-button").click();
    const panel = window.getByTestId("reference-geometry-panel");
    await panel.getByLabel("Construction method").selectOption("offset");
    await panel.getByLabel("Offset (mm)").fill("12");
    await panel.getByRole("button", { name: "Create reference" }).click();
    await expect.poll(async () => (await snapOf(window)).datums ?? []).toHaveLength(1);

    let snapshot = await snapOf(window);
    const datumId = snapshot.datums![0]!.featureId;
    expect(snapshot.datums![0]!.kind).toBe("DatumPlane");
    expect(snapshot.datums![0]!.status).toBe("ok");
    expect(snapshot.datums![0]!.resolved.originMm?.[2]).toBeCloseTo(12);

    await panel.getByLabel("Edit existing reference").selectOption(datumId);
    await panel.getByLabel("Offset (mm)").fill("24");
    await panel.getByRole("button", { name: "Update reference" }).click();
    await expect.poll(async () => (await snapOf(window)).datums?.find((item) => item.featureId === datumId)?.resolved.originMm?.[2]).toBeCloseTo(24);

    await window.evaluate((id) => (
      window as unknown as { __kreoda_test: { selectMany: (ids: string[]) => unknown } }
    ).__kreoda_test.selectMany([id]), datumId);
    await panel.getByRole("button", { name: "Create sketch here" }).click();
    await expect(window.getByTestId("sketch-canvas")).toBeVisible();
    const supportedSketch = async () => (await snapOf(window)).sketches.find((sketch) => sketch.supportRef === datumId);
    await expect.poll(supportedSketch, { timeout: 20000 }).toMatchObject({
      planeKind: "Datum",
      supportRef: datumId,
      plane: { origin: [0, 0, 24], normal: [0, 0, 1] },
      modelPlane: { origin: [0, 0, 24], normal: [0, 0, 1] },
      points: 4,
    });
    await window.getByRole("button", { name: "Done" }).click();

    const sketchId = (await supportedSketch())!.id;
    await window.evaluate((id) => (
      window as unknown as { __kreoda_test: { selectMany: (ids: string[]) => unknown } }
    ).__kreoda_test.selectMany([id]), sketchId);
    await window.getByRole("button", { name: "Pull sketch" }).click();
    await window.getByLabel("Distance (mm)").fill("7");
    await window.getByRole("button", { name: "Extrude", exact: true }).click();
    await expect.poll(async () => (await snapOf(window)).bodies.some((body) => body.type === "Extrude")).toBe(true);
    snapshot = await snapOf(window);
    const solidId = snapshot.bodies.find((body) => body.type === "Extrude")!.id;
    const initialGeometry = await expectExtrudeGeometry(window, solidId, 24, 31);
    let native = await readNativeSnapshot(window);
    expect(native.features.find((feature) => feature.featureId === solidId)).toMatchObject({
      volumeMm3: 35000,
    });
    expect(native.sketches.find((sketch) => sketch.featureId === sketchId)?.supportRef).toBe(datumId);

    const icadPath = path.join(profile, "datum-sketch.icad");
    await window.evaluate(async (file) => (
      window as unknown as { __kreoda_test: { saveIcad: (path: string) => Promise<unknown> } }
    ).__kreoda_test.saveIcad(file), icadPath);

    await window.evaluate((id) => (
      window as unknown as { __kreoda_test: { selectMany: (ids: string[]) => unknown } }
    ).__kreoda_test.selectMany([id]), datumId);
    await openMore(window);
    await window.getByTestId("reference-geometry-button").click();
    const editPanel = window.getByTestId("reference-geometry-panel");
    await editPanel.getByLabel("Offset (mm)").fill("30");
    await editPanel.getByRole("button", { name: "Update reference" }).click();
    const movedGeometry = await expectExtrudeGeometry(window, solidId, 30, 37);
    expect(movedGeometry.volumeMm3).toBeCloseTo(initialGeometry.volumeMm3, 8);
    const movedSnapshot = await snapOf(window);
    expect(movedSnapshot.sketches.find((sketch) => sketch.id === sketchId)).toMatchObject({
      supportRef: datumId,
      plane: { origin: [0, 0, 30], normal: [0, 0, 1] },
    });
    expect(movedSnapshot.bodies.find((body) => body.id === solidId)).toBeTruthy();
    native = await readNativeSnapshot(window);
    expect(native.features.find((feature) => feature.featureId === solidId)?.type).toBe("Extrude");
    expect(native.features.find((feature) => feature.featureId === solidId)?.volumeMm3).toBeCloseTo(35000, 2);
    expect(native.sketches.find((sketch) => sketch.featureId === sketchId)?.supportRef).toBe(datumId);
    expect(native.datums.find((item) => item.featureId === datumId)?.resolved.originMm?.[2]).toBeCloseTo(30);
    await window.evaluate(async (file) => (
      window as unknown as { __kreoda_test: { saveIcad: (path: string) => Promise<unknown> } }
    ).__kreoda_test.saveIcad(file), icadPath);
    expect(existsSync(icadPath)).toBe(true);

    await editPanel.getByRole("button", { name: "Close reference geometry" }).click();
    await window.getByRole("button", { name: "Undo" }).click();
    const undoneGeometry = await expectExtrudeGeometry(window, solidId, 24, 31);
    expect(undoneGeometry.volumeMm3).toBeCloseTo(initialGeometry.volumeMm3, 8);
    native = await readNativeSnapshot(window);
    expect(native.features.find((feature) => feature.featureId === solidId)?.volumeMm3).toBeCloseTo(35000, 2);
    expect(native.sketches.find((sketch) => sketch.featureId === sketchId)?.supportRef).toBe(datumId);
    expect(native.datums.find((item) => item.featureId === datumId)?.resolved.originMm?.[2]).toBeCloseTo(24);

    const reopened = await window.evaluate(async (file) => (
      window as unknown as { __kreoda_test: { openIcad: (path: string) => Promise<unknown> } }
    ).__kreoda_test.openIcad(file), icadPath);
    expect(reopened).toMatchObject({
      datums: [{ featureId: datumId, resolved: { originMm: [0, 0, 30] } }],
      sketches: [{ id: sketchId, supportRef: datumId, plane: { origin: [0, 0, 30], normal: [0, 0, 1] } }],
      bodies: [{ id: solidId, type: "Extrude", volumeMm3: 35000 }],
    });
    const reopenedGeometry = await expectExtrudeGeometry(window, solidId, 30, 37);
    expect(reopenedGeometry.volumeMm3).toBeCloseTo(initialGeometry.volumeMm3, 8);
    native = await readNativeSnapshot(window);
    expect(native.features.find((feature) => feature.featureId === solidId)?.volumeMm3).toBeCloseTo(35000, 2);
    expect(native.sketches.find((sketch) => sketch.featureId === sketchId)?.supportRef).toBe(datumId);
  } finally {
    await app.close();
  }
});
