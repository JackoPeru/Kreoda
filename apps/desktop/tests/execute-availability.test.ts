import { describe, expect, it, vi, beforeEach } from "vitest";
import { ZodError } from "zod";

vi.mock("../src/ipc/coreClient", () => ({
  coreClient: {
    createSketch: vi.fn().mockResolvedValue({ featureId: "sketch-created", revision: 2 }),
    requestSketch: vi.fn().mockResolvedValue({ planeKind: "XY", points: [], lines: [], circles: [], constraints: [] }),
    createHole: vi.fn().mockResolvedValue({
      featureId: "ho-1",
      type: "Hole",
      paramsMm: [8, 0],
      dependsOn: ["box-1"],
      refExtra: "face=box.+Z;x=50;y=25;mode=throughAll",
      volumeMm3: 49497.3,
      bboxMm: [0, 0, 0, 100, 50, 10],
      revision: 2,
    }),
    requestMesh: vi.fn().mockResolvedValue({
      positions: new Float32Array(36),
      normals: new Float32Array(36),
      indices: new Uint32Array(36),
      faces: [],
      edgeVertices: new Float32Array(0),
      edges: [],
      volumeMm3: 49497.3,
      bboxMm: [0, 0, 0, 100, 50, 10],
      triangleCount: 12,
      revision: 2,
    }),
  },
}));

import { coreClient } from "../src/ipc/coreClient";
import { commandAvailability, executeCommand } from "../src/commands/execute";
import { selectionKindOf, useDocumentUiStore, useSelectionStore } from "../src/stores";
import { DatumDescriptorSchema } from "@kreoda/protocol";

const holeParams = {
  targetId: "box-1",
  faceRole: "box.+Z",
  xMm: 50,
  yMm: 25,
  diameterMm: 8,
  depthMode: "throughAll" as const,
  depthMm: 0,
};

beforeEach(() => {
  useSelectionStore.getState().clear();
  useDocumentUiStore.getState().setCoreStatus(true, "test");
  useDocumentUiStore.setState({ datums: [], sketches: [] });
  vi.clearAllMocks();
});

describe("skipAvailability equivalence (Fase 3)", () => {
  it("rejects an unavailable command without the flag and never reaches dispatch", async () => {
    // Empty selection: CreateHole availability is false ("Select a face first").
    await expect(executeCommand("CreateHole", holeParams)).rejects.toThrow(
      /face first/,
    );
    expect(coreClient.createHole).not.toHaveBeenCalled();
  });

  it("same call with the flag skips only the gate and reaches the same dispatch", async () => {
    const result = await executeCommand("CreateHole", holeParams, {
      skipAvailability: true,
    });
    expect(coreClient.createHole).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: "box-1", faceRole: "box.+Z" }),
    );
    expect(result).toMatchObject({
      kind: "created",
      feature: expect.objectContaining({ featureId: "ho-1" }),
    });
    // pullAndAppend ran: mesh pulled for the created feature (sync.ts:17).
    expect(coreClient.requestMesh).toHaveBeenCalledWith("ho-1", 1);
  });

  it("keeps zod validation with the flag (negative width still throws ZodError)", async () => {
    const err = await executeCommand(
      "CreateBox",
      { widthMm: -5, heightMm: 10, depthMm: 10 },
      { skipAvailability: true },
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ZodError);
  });
});

describe("datum selection and optional CreateSketch binding", () => {
  const plane = DatumDescriptorSchema.parse({ featureId: "67e12d50-c1e9-4c42-9bf8-983de4eb9c27", kind: "DatumPlane",
    definition: { type: "principal", planeKind: "XY" }, dependsOn: [],
    resolved: { originMm: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] }, status: "ok" });

  it("keeps a datum plane a datum in Desktop selection context and binds its native UUID", async () => {
    useDocumentUiStore.setState({ datums: [plane] });
    useSelectionStore.getState().select(plane.featureId, false);
    expect(selectionKindOf(plane.featureId)).toBe("datumPlane");
    expect(commandAvailability("CreateInstance").available).toBe(false);
    await executeCommand("CreateSketch", { planeKind: "XY" });
    expect(coreClient.createSketch).toHaveBeenCalledWith(expect.objectContaining({ supportRef: plane.featureId }));
  });

  it("keeps principal sketch creation unbound with no datum plane selection", async () => {
    await executeCommand("CreateSketch", { planeKind: "XY" });
    expect(coreClient.createSketch).toHaveBeenCalledOnce();
    expect(vi.mocked(coreClient.createSketch).mock.calls[0]?.[0].supportRef).toBeUndefined();
  });

  it("clears local selection and hover when a datum UUID is removed", () => {
    useDocumentUiStore.setState({ datums: [plane] });
    useSelectionStore.getState().select(plane.featureId, false);
    useSelectionStore.getState().hover(plane.featureId);
    useDocumentUiStore.getState().setDatums([]);
    expect(useSelectionStore.getState().selectedIds).toEqual([]);
    expect(useSelectionStore.getState().hoveredId).toBeNull();
  });

  it("never binds an axis as sketch support and preserves explicit supportRef", async () => {
    const axis = DatumDescriptorSchema.parse({ featureId: "67e12d50-c1e9-4c42-9bf8-983de4eb9c28", kind: "DatumAxis",
      definition: { type: "planeNormal", plane: { type: "principal", planeKind: "XY" } }, dependsOn: [],
      resolved: { originMm: [0, 0, 0], direction: [0, 0, 1] }, status: "ok" });
    useDocumentUiStore.setState({ datums: [axis] });
    useSelectionStore.getState().select(axis.featureId, false);
    await executeCommand("CreateSketch", { planeKind: "XY" });
    expect(vi.mocked(coreClient.createSketch).mock.calls[0]?.[0].supportRef).toBeUndefined();
    vi.clearAllMocks();
    await executeCommand("CreateSketch", { planeKind: "XY", supportRef: "explicit-native-support" });
    expect(coreClient.createSketch).toHaveBeenCalledWith(expect.objectContaining({ supportRef: "explicit-native-support" }));
  });

  it("does not infer support in a provider-resolved skipAvailability context", async () => {
    useDocumentUiStore.setState({ datums: [plane] });
    useSelectionStore.getState().select(plane.featureId, false);
    await executeCommand("CreateSketch", { planeKind: "XY" }, { skipAvailability: true });
    expect(vi.mocked(coreClient.createSketch).mock.calls[0]?.[0].supportRef).toBeUndefined();
    vi.clearAllMocks();
    await executeCommand("CreateSketch", { planeKind: "XY", supportRef: "explicit-native-support" }, { skipAvailability: true });
    expect(coreClient.createSketch).toHaveBeenCalledWith(expect.objectContaining({ supportRef: "explicit-native-support" }));
  });

  it("rejects a selected broken datum plane instead of silently creating on a principal plane", async () => {
    useDocumentUiStore.setState({ datums: [{ ...plane, status: "broken" }] });
    useSelectionStore.getState().select(plane.featureId, false);
    expect(commandAvailability("CreateSketch")).toMatchObject({ available: false, reason: "BROKEN_REFERENCE" });
    await expect(executeCommand("CreateSketch", { planeKind: "XY" })).rejects.toThrow("BROKEN_REFERENCE");
    expect(coreClient.createSketch).not.toHaveBeenCalled();
  });

  it("reports ambiguous selected datum planes and does not dispatch an implicit sketch", async () => {
    const second = { ...plane, featureId: "67e12d50-c1e9-4c42-9bf8-983de4eb9c29" };
    useDocumentUiStore.setState({ datums: [plane, second] });
    useSelectionStore.setState({ selectedIds: [plane.featureId, second.featureId] });
    expect(commandAvailability("CreateSketch")).toMatchObject({ available: false, reason: "AMBIGUOUS_REFERENCE" });
    await expect(executeCommand("CreateSketch", { planeKind: "XY" })).rejects.toThrow("AMBIGUOUS_REFERENCE");
    expect(coreClient.createSketch).not.toHaveBeenCalled();
    await executeCommand("CreateSketch", { planeKind: "XY", supportRef: plane.featureId });
    expect(coreClient.createSketch).toHaveBeenCalledWith(expect.objectContaining({ supportRef: plane.featureId }));
  });
});
