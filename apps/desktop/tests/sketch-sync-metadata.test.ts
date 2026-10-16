import { beforeEach, expect, it } from "vitest";
import { bindOpenedSessionRefresh, syncFromCoreList } from "../src/model/sync";
import { useDocumentUiStore } from "../src/stores";

const principalPlane = {
  origin: [0, 0, 0] as [number, number, number],
  xAxis: [1, 0, 0] as [number, number, number],
  yAxis: [0, 1, 0] as [number, number, number],
  normal: [0, 0, 1] as [number, number, number],
};

const datumPlane = {
  origin: [10, 20, 30] as [number, number, number],
  xAxis: [1, 0, 0] as [number, number, number],
  yAxis: [0, Math.SQRT1_2, Math.SQRT1_2] as [number, number, number],
  normal: [0, -Math.SQRT1_2, Math.SQRT1_2] as [number, number, number],
};

const model = {
  points: [{ id: "p0", x: 2, y: 3, fixed: false }],
  lines: [],
  circles: [],
  arcs: [],
  constraints: [],
};

beforeEach(() => useDocumentUiStore.getState().resetDocument("sketch-sync-metadata"));

it("keeps principal frame and empty supportRef in full model cache on canonical sync", async () => {
  await syncFromCoreList([], 1, [{
    featureId: "principal-sketch",
    planeKind: "XY",
    points: 1,
    lines: 0,
    circles: 0,
    constraints: 0,
    model,
    plane: principalPlane,
    supportRef: "",
  }]);

  expect(useDocumentUiStore.getState().sketches[0]).toEqual({
    featureId: "principal-sketch",
    planeKind: "XY",
    points: 1,
    lines: 0,
    circles: 0,
    constraints: 0,
    model: { ...model, planeKind: "XY", plane: principalPlane, supportRef: "" },
    plane: principalPlane,
    supportRef: "",
  });
});

it("keeps native datum frame and exact supportRef in full model cache on canonical sync", async () => {
  const supportRef = "6a1a66e0-34bb-4cbb-8f52-33a8ae1af06a";
  await syncFromCoreList([], 1, [{
    featureId: "datum-sketch",
    planeKind: "Datum",
    points: 1,
    lines: 0,
    circles: 0,
    constraints: 0,
    model,
    plane: datumPlane,
    supportRef,
  }]);

  expect(useDocumentUiStore.getState().sketches[0]).toEqual({
    featureId: "datum-sketch",
    planeKind: "Datum",
    points: 1,
    lines: 0,
    circles: 0,
    constraints: 0,
    model: { ...model, planeKind: "Datum", plane: datumPlane, supportRef },
    plane: datumPlane,
    supportRef,
  });
});

it("routes summary-only Undo through the ordered canonical refresh before publishing sketch state", async () => {
  const summary = { featureId: "datum-sketch", planeKind: "Datum", points: 1,
    lines: 0, circles: 0, constraints: 0, plane: datumPlane, supportRef: "plane-uuid" };
  const stale = { ...model, points: [{ id: "p0", x: 999, y: 999, fixed: false }] };
  await syncFromCoreList([], 1, [{ ...summary, model: stale }]);
  let refreshed = 0;
  const unbind = bindOpenedSessionRefresh(async () => {
    refreshed++;
    expect(useDocumentUiStore.getState().revision).toBe(1);
    await syncFromCoreList([], 2, [{ ...summary, model }]);
  });
  try {
    await syncFromCoreList([], 2, [summary]);
    expect(refreshed).toBe(1);
    expect(useDocumentUiStore.getState().sketches[0]?.model).toEqual({
      ...model, planeKind: "Datum", plane: datumPlane, supportRef: "plane-uuid",
    });
  } finally { unbind(); }
});
