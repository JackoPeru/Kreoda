import { describe, expect, it, vi, beforeEach } from "vitest";
import { ZodError } from "zod";

vi.mock("../src/ipc/coreClient", () => ({
  coreClient: {
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
import { executeCommand } from "../src/commands/execute";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

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
