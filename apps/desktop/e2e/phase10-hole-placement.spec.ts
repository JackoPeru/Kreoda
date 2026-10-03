import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CommandType, frameMessage, PROTOCOL_VERSION } from "@kreoda/protocol";
import { boot, runBar, snapOf, type BodySnapshot, type Snapshot } from "./helpers";

const ICAD = path.join(os.tmpdir(), `kreoda-phase10-hole-${randomUUID()}.icad`);

interface NativeHole {
  featureId: string;
  type: string;
  paramsMm: number[];
  dependsOn: string[];
  refExtra: string;
  volumeMm3: number;
}

interface NativeSnapshot {
  requestId: string;
  status: string;
  features: NativeHole[];
}

interface HoleSnapshot extends BodySnapshot {
  paramsMm: number[];
}

async function readNativeSnapshot(
  window: import("@playwright/test").Page,
): Promise<NativeSnapshot> {
  const requestId = `phase10-snapshot-${randomUUID()}`;
  const request = {
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    documentId: "",
    type: CommandType.RequestSnapshot,
    includeReferencePlanes: true,
  };
  const frame = frameMessage(new TextEncoder().encode(JSON.stringify(request)));
  const framedBase64 = Buffer.from(frame).toString("base64");
  const responseBase64 = await window.evaluate(
    (payload) =>
      (window as unknown as {
        kreoda: { invoke: (framedBase64: string) => Promise<string> };
      }).kreoda.invoke(payload),
    framedBase64,
  );
  // The request includes its four-byte little-endian frame header. The IPC
  // reply is the unframed JSON payload consumed by CoreClient.roundTrip.
  const response = JSON.parse(Buffer.from(responseBase64, "base64").toString("utf8")) as NativeSnapshot;
  expect(response.requestId).toBe(requestId);
  expect(response.status).toBe("ok");
  return response;
}

async function selectFace(window: import("@playwright/test").Page, featureId: string, role: string): Promise<void> {
  await window.evaluate(
    ({ id, faceRole }) => (
      window as unknown as {
        __kreoda_test: { selectFace: (featureId: string, role: string) => unknown };
      }
    ).__kreoda_test.selectFace(id, faceRole),
    { id: featureId, faceRole: role },
  );
}

async function clickBoundaryAtMidpoint(
  window: import("@playwright/test").Page,
  edge: import("@playwright/test").Locator,
): Promise<void> {
  const point = await edge.evaluate((element) => {
    const group = element as SVGGElement;
    const hitLine = group.querySelector<SVGLineElement>('line[stroke="transparent"]');
    const svg = group.ownerSVGElement;
    if (!hitLine || !svg) throw new Error("Boundary edge has no SVG hit line");
    const x1 = Number(hitLine.getAttribute("x1"));
    const y1 = Number(hitLine.getAttribute("y1"));
    const x2 = Number(hitLine.getAttribute("x2"));
    const y2 = Number(hitLine.getAttribute("y2"));
    if (![x1, y1, x2, y2].every(Number.isFinite)) {
      throw new Error("Boundary edge has invalid SVG coordinates");
    }

    const midpoint = svg.createSVGPoint();
    midpoint.x = (x1 + x2) / 2;
    midpoint.y = (y1 + y2) / 2;
    const matrix = svg.getScreenCTM();
    if (!matrix) throw new Error("Boundary edge SVG has no screen transform");
    const screenPoint = midpoint.matrixTransform(matrix);
    const hit = document.elementFromPoint(screenPoint.x, screenPoint.y);
    if (hit?.closest("[data-boundary-edge]") !== group) {
      throw new Error(`Boundary midpoint is occluded by ${hit?.tagName ?? "no element"}`);
    }
    return { x: screenPoint.x, y: screenPoint.y };
  });

  await window.mouse.click(point.x, point.y);
}

async function placeHoleFromEdges(
  window: import("@playwright/test").Page,
  featureId: string,
  role: string,
): Promise<{ xMm: number; yMm: number; beforeX: number; beforeY: number }> {
  await selectFace(window, featureId, role);
  await window.getByTestId("context-toolbar").getByRole("button", { name: "Hole" }).click();
  const dialog = window.getByRole("dialog");
  const preview = dialog.getByTestId("hole-placement-preview");
  await expect(preview).toBeVisible({ timeout: 10000 });
  const edges = preview.locator("[data-boundary-edge]");
  await expect(edges).toHaveCount(4);

  const centerX = dialog.getByTestId("hole-center-x");
  const centerY = dialog.getByTestId("hole-center-y");
  const beforeX = Number(await centerX.inputValue());
  const beforeY = Number(await centerY.inputValue());
  expect(Number.isFinite(beforeX) && Number.isFinite(beforeY)).toBe(true);

  const horizontal = preview.locator('[data-boundary-edge][data-direction="horizontal"]').first();
  const horizontalDirection = await horizontal.getAttribute("data-direction");
  await clickBoundaryAtMidpoint(window, horizontal);
  await expect(horizontal).toHaveAttribute("aria-pressed", "true");
  await dialog.getByTestId("hole-edge-distance-1").fill("8");
  await expect(preview.getByText("d1 8 mm")).toBeVisible();

  const otherDirection = horizontalDirection === "horizontal" ? "vertical" : "horizontal";
  const perpendicular = preview.locator(`[data-boundary-edge][data-direction="${otherDirection}"]`).first();
  await clickBoundaryAtMidpoint(window, perpendicular);
  await expect(perpendicular).toHaveAttribute("aria-pressed", "true");
  await dialog.getByTestId("hole-edge-distance-2").fill("12");
  await expect(preview.getByText("d2 12 mm")).toBeVisible();
  await expect(dialog.getByTestId("hole-placement-error")).toHaveCount(0);

  const xMm = Number(await centerX.inputValue());
  const yMm = Number(await centerY.inputValue());
  expect(Number.isFinite(xMm) && Number.isFinite(yMm)).toBe(true);
  expect(Math.hypot(xMm - beforeX, yMm - beforeY)).toBeGreaterThan(5);
  await expect(dialog.getByRole("button", { name: "Cut hole" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Cut hole" }).click();
  await expect(dialog).toBeHidden({ timeout: 30000 });
  return { xMm, yMm, beforeX, beforeY };
}

test("edge distances place off-center holes on horizontal and vertical faces and survive undo/save", async () => {
  const { app, window } = await boot();
  try {
    await runBar(window, "box 100 50 10");
    await runBar(window, "box 60 80 20");
    const before = await snapOf(window);
    const boxes = before.bodies.filter((body) => body.type === "Box");
    expect(boxes).toHaveLength(2);
    const xyBox = boxes[0]!;
    const verticalBox = boxes[1]!;

    const xyPoint = await placeHoleFromEdges(window, xyBox.id, "box.+Z");
    let current = await snapOf(window);
    expect(current.bodies).toHaveLength(3);
    const xyHole = current.bodies.find((body) => body.type === "Hole") as HoleSnapshot | undefined;
    expect(xyHole).toBeDefined();
    expect(xyHole!.triangles).toBeGreaterThan(12);
    expect(xyHole!.faces.some((face) => face.includes(":wall."))).toBe(true);
    expect(xyHole!.paramsMm[0]).toBeCloseTo(8, 6);
    expect(xyHole!.volumeMm3).toBeCloseTo(100 * 50 * 10 - Math.PI * 16 * 10, 1);
    expect(Math.hypot(xyPoint.xMm - xyPoint.beforeX, xyPoint.yMm - xyPoint.beforeY)).toBeGreaterThan(5);

    await window.locator('button[title^="Undo"]').click();
    await expect.poll(async () => (await snapOf(window)).bodies.length).toBe(2);
    await window.locator('button[title^="Redo"]').click();
    await expect.poll(async () => (await snapOf(window)).bodies.length).toBe(3);

    const verticalPoint = await placeHoleFromEdges(window, verticalBox.id, "box.+X");
    current = await snapOf(window);
    expect(current.bodies).toHaveLength(4);
    const holes = current.bodies.filter((body) => body.type === "Hole") as HoleSnapshot[];
    expect(holes).toHaveLength(2);
    const verticalHole = holes[1]!;
    expect(verticalHole.triangles).toBeGreaterThan(12);
    expect(verticalHole.faces.some((face) => face.includes(":wall."))).toBe(true);
    expect(verticalHole.paramsMm[0]).toBeCloseTo(8, 6);
    expect(verticalHole.volumeMm3).toBeCloseTo(60 * 80 * 20 - Math.PI * 16 * 60, 1);
    expect(Math.hypot(verticalPoint.xMm - verticalPoint.beforeX, verticalPoint.yMm - verticalPoint.beforeY)).toBeGreaterThan(5);

    const nativeSnapshot = await readNativeSnapshot(window);
    const passedPoints = [
      { targetId: xyBox.id, role: "box.+Z", point: xyPoint },
      { targetId: verticalBox.id, role: "box.+X", point: verticalPoint },
    ].map(({ targetId, role, point }) => {
      const native = nativeSnapshot.features.find((feature) =>
        feature.type === "Hole" && feature.dependsOn.includes(targetId) && feature.refExtra.includes(`face=${role};`),
      );
      expect(native).toBeDefined();
      expect(native!.type).toBe("Hole");
      expect(native!.paramsMm[0]).toBeCloseTo(8, 6);
      const coordinates = Object.fromEntries([...native!.refExtra.matchAll(/(?:^|;)(x|y)=([^;]+)/g)].map((match) => [match[1]!, Number(match[2])])) as Record<"x" | "y", number>;
      expect(coordinates.x).toBeCloseTo(point.xMm, 5);
      expect(coordinates.y).toBeCloseTo(point.yMm, 5);
      return { featureId: native!.featureId, targetId, role, xMm: point.xMm, yMm: point.yMm };
    });

    await window.evaluate(
      ({ file }) => (
        window as unknown as { __kreoda_test: { saveIcad: (file: string) => Promise<Snapshot> } }
      ).__kreoda_test.saveIcad(file),
      { file: ICAD },
    );
    const reopened = await window.evaluate(
      ({ file }) => (
        window as unknown as { __kreoda_test: { openIcad: (file: string) => Promise<Snapshot> } }
      ).__kreoda_test.openIcad(file),
      { file: ICAD },
    ) as Snapshot;
    const persistedSnapshot = await readNativeSnapshot(window);
    const persisted = persistedSnapshot.features.filter((feature) =>
      passedPoints.some((point) => point.featureId === feature.featureId),
    );
    expect(persisted).toHaveLength(2);
    for (const point of passedPoints) {
      const feature = persisted.find((candidate) => candidate.featureId === point.featureId)!;
      expect(feature.refExtra).toMatch(/face=.+;x=.+;y=.+;mode=throughAll/);
      const coordinates = Object.fromEntries([...feature.refExtra.matchAll(/(?:^|;)(x|y)=([^;]+)/g)].map((match) => [match[1]!, Number(match[2])]));
      expect(coordinates.x).toBeCloseTo(point.xMm, 6);
      expect(coordinates.y).toBeCloseTo(point.yMm, 6);
    }
    expect(reopened.bodies.filter((body) => body.type === "Hole")).toHaveLength(2);
  } finally {
    try {
      await app.close();
    } finally {
      await fs.promises.rm(ICAD, { force: true });
    }
  }
});
