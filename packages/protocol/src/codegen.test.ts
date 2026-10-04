// Phase 8 flatc parity: generated bindings must agree with the handwritten
// registry (packages/protocol/src/index.ts) and actually round-trip.
// Mesh successes cross the wire as MeshUpdate tables (§8).

import * as flatbuffers from "flatbuffers";
import { describe, expect, it, vi } from "vitest";
import {
  CommandType as Handwritten,
  decodeMeshFrame,
  decodeMeshUpdateFb,
  isJsonResponse,
} from "./index.js";
import { CommandEnvelope } from "./generated/kreoda/protocol/command-envelope.js";
import { CommandPayload } from "./generated/kreoda/protocol/command-payload.js";
import { CommandType as Generated } from "./generated/kreoda/protocol/command-type.js";
import { CreateBoxCommand } from "./generated/kreoda/protocol/create-box-command.js";
import { MeshUpdate } from "./generated/kreoda/protocol/mesh-update.js";
import { FaceRange } from "./generated/kreoda/protocol/face-range.js";
import { EdgeRange } from "./generated/kreoda/protocol/edge-range.js";

type MeshFixtureOverrides = {
  requestId?: string;
  featureId?: string;
  bodyId?: string;
  lod?: number;
  positions?: number[];
  normals?: number[];
  indices?: number[];
  edgeVertices?: number[];
  faces?: { id: string; start: number; count: number }[];
  edges?: { id: string; start: number; count: number }[];
  omitEdgeVertices?: boolean;
  positionsCount?: number;
  normalsCount?: number;
  indicesCount?: number;
  volumeMm3?: number;
  bboxMm?: number[];
  revision?: bigint;
};

function meshFixture(overrides: MeshFixtureOverrides = {}): Uint8Array {
  const builder = new flatbuffers.Builder(512);
  const positions = overrides.positions ?? [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const normals = overrides.normals ?? [0, 0, 1, 0, 0, 1, 0, 0, 1];
  const indices = overrides.indices ?? [0, 1, 2];
  const edgeVertices = overrides.edgeVertices ?? [];
  const bytes = (values: number[]) => new Uint8Array(new Float32Array(values).buffer);
  const indicesBytes = new Uint8Array(new Uint32Array(indices).buffer);
  const fid = builder.createString(overrides.featureId ?? "tip-1");
  const body = builder.createString(overrides.bodyId ?? "tip-1");
  const req = builder.createString(overrides.requestId ?? "relay-1");
  const positionsOffset = MeshUpdate.createPositionsVector(builder, bytes(positions));
  const normalsOffset = MeshUpdate.createNormalsVector(builder, bytes(normals));
  const indicesOffset = MeshUpdate.createIndicesVector(builder, indicesBytes);
  const edgeVerticesOffset = overrides.omitEdgeVertices ? 0 : MeshUpdate.createEdgeVerticesVector(builder, bytes(edgeVertices));
  const faceOffsets = (overrides.faces ?? [{ id: "face-1", start: 0, count: 1 }]).map(face =>
    FaceRange.createFaceRange(builder, builder.createString(face.id), face.start, face.count));
  const facesOffset = MeshUpdate.createFacesVector(builder, faceOffsets);
  const edgeOffsets = (overrides.edges ?? []).map(edge =>
    EdgeRange.createEdgeRange(builder, builder.createString(edge.id), edge.start, edge.count));
  const edgesOffset = MeshUpdate.createEdgesVector(builder, edgeOffsets);
  const bboxOffset = MeshUpdate.createBboxMmVector(builder, overrides.bboxMm ?? [0, 0, 0, 1, 1, 1]);
  const update = MeshUpdate.createMeshUpdate(
    builder,
    fid,
    body,
    overrides.lod ?? 1,
    req,
    overrides.positionsCount ?? positions.length,
    overrides.normalsCount ?? normals.length,
    overrides.indicesCount ?? indices.length,
    positionsOffset,
    normalsOffset,
    indicesOffset,
    edgeVerticesOffset,
    facesOffset,
    edgesOffset,
    overrides.volumeMm3 ?? 1,
    bboxOffset,
    overrides.revision ?? BigInt(7),
  );
  builder.finish(update);
  return builder.asUint8Array();
}

describe("flatc codegen parity (§61)", () => {
  it("generated CommandType matches the handwritten registry", () => {
    const names = Object.keys(Handwritten) as (keyof typeof Handwritten)[];
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const generatedValue = (Generated as unknown as Record<string, number>)[name];
      expect(generatedValue, `CommandType.${name}`).toBe(Handwritten[name]);
    }
  });

  it("CreateBox envelope round-trips through the generated bindings", () => {
    const builder = new flatbuffers.Builder(256);
    const feat = builder.createString("feat-123");
    CreateBoxCommand.startCreateBoxCommand(builder);
    CreateBoxCommand.addFeatureId(builder, feat);
    CreateBoxCommand.addWidthMm(builder, 100);
    CreateBoxCommand.addHeightMm(builder, 60);
    CreateBoxCommand.addDepthMm(builder, 10);
    const box = CreateBoxCommand.endCreateBoxCommand(builder);

    const req = builder.createString("req-1");
    const doc = builder.createString("doc-1");
    const env = CommandEnvelope.createCommandEnvelope(
      builder,
      1,
      req,
      doc,
      Generated.CreateBox,
      CommandPayload.CreateBoxCommand,
      box,
    );
    builder.finish(env);

    const back = CommandEnvelope.getRootAsCommandEnvelope(
      new flatbuffers.ByteBuffer(builder.asUint8Array()),
    );
    expect(back.protocolVersion()).toBe(1);
    expect(back.requestId()).toBe("req-1");
    expect(back.type()).toBe(Generated.CreateBox);
    expect(back.payloadType()).toBe(CommandPayload.CreateBoxCommand);
    const payload = back.payload(new CreateBoxCommand()) as CreateBoxCommand;
    expect(payload.featureId()).toBe("feat-123");
    expect(payload.widthMm()).toBe(100);
    expect(payload.heightMm()).toBe(60);
    expect(payload.depthMm()).toBe(10);
  });

  it("MeshUpdate decodes to validated CoreMeshData (§8)", () => {
    const builder = new flatbuffers.Builder(512);
    const fid = builder.createString("box-1");
    const pos = new Float32Array([0, 0, 0, 100, 0, 0, 0, 60, 0]);
    const nrm = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const idx = new Uint32Array([0, 1, 2]);
    const posOff = MeshUpdate.createPositionsVector(
      builder,
      new Uint8Array(pos.buffer, pos.byteOffset, pos.byteLength),
    );
    const nrmOff = MeshUpdate.createNormalsVector(
      builder,
      new Uint8Array(nrm.buffer, nrm.byteOffset, nrm.byteLength),
    );
    const idxOff = MeshUpdate.createIndicesVector(
      builder,
      new Uint8Array(idx.buffer, idx.byteOffset, idx.byteLength),
    );
    const faceId = builder.createString("box-1:box.+Z");
    const face = FaceRange.createFaceRange(builder, faceId, 0, 1);
    const faces = MeshUpdate.createFacesVector(builder, [face]);
    const bbox = MeshUpdate.createBboxMmVector(builder, [0, 0, 0, 100, 60, 10]);
    const reqId = builder.createString("req-7");
    const update = MeshUpdate.createMeshUpdate(
      builder, fid, fid, 1, reqId, 9, 9, 3,
      posOff, nrmOff, idxOff, 0, faces, 0, 60000, bbox, BigInt(7),
    );
    builder.finish(update);
    const bytes = builder.asUint8Array();
    expect(isJsonResponse(bytes)).toBe(false);
    expect(isJsonResponse(new TextEncoder().encode('{"a":1}'))).toBe(true);
    const mesh = decodeMeshUpdateFb(bytes);
    expect(mesh.positions).toEqual(pos);
    expect(mesh.normals).toEqual(nrm);
    expect(mesh.indices).toEqual(idx);
    expect(mesh.faces).toEqual([
      { persistentFaceId: "box-1:box.+Z", triangleStart: 0, triangleCount: 1 },
    ]);
    expect(mesh.volumeMm3).toBe(60000);
    expect(mesh.bboxMm).toEqual([0, 0, 0, 100, 60, 10]);
    expect(mesh.triangleCount).toBe(1);
    expect(mesh.revision).toBe(7);
  });

  it("accepts an omitted optional edge-vertex vector when there are no edges", () => {
    const mesh = decodeMeshUpdateFb(meshFixture({ omitEdgeVertices: true, edges: [] }));
    expect(mesh.edgeVertices).toEqual(new Float32Array());
    expect(mesh.edges).toEqual([]);
  });

  it("checks raw geometry semantics before allocating output vectors", () => {
    const bytes = meshFixture({ positions: [0, 0, 0, Number.NaN, 0, 0, 0, 1, 0] });
    const NativeFloat32Array = globalThis.Float32Array;
    let outputVectorAllocations = 0;
    vi.stubGlobal("Float32Array", new Proxy(NativeFloat32Array, {
      construct(target, args) {
        if (typeof args[0] === "number" && args[0] > 0) outputVectorAllocations++;
        return Reflect.construct(target, args, target);
      },
    }));
    try {
      expect(() => decodeMeshUpdateFb(bytes)).toThrow();
      expect(outputVectorAllocations).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  const invalidMeshCases: [string, MeshFixtureOverrides][] = [
    ["normals count", { normalsCount: 8 }],
    ["non-triangle indices", { indices: [0, 1] }],
    ["out-of-range indices", { indices: [0, 1, 9] }],
    ["non-finite positions", { positions: [0, 0, 0, Number.NaN, 0, 0, 0, 1, 0] }],
    ["non-finite normals", { normals: [0, 0, 1, 0, Number.POSITIVE_INFINITY, 1, 0, 0, 1] }],
    ["non-finite edge vertices", { edgeVertices: [0, 0, 0, Number.NaN, 0, 0], edges: [{ id: "edge-1", start: 0, count: 2 }] }],
    ["invalid face span", { faces: [{ id: "face-1", start: 1, count: 1 }] }],
    ["overlapping face spans", { faces: [{ id: "face-1", start: 0, count: 1 }, { id: "face-2", start: 0, count: 1 }] }],
    ["duplicate face ids", { indices: [0, 1, 2, 0, 2, 1], faces: [{ id: "same", start: 0, count: 1 }, { id: "same", start: 1, count: 1 }] }],
    ["empty face spans", { faces: [{ id: "face-1", start: 0, count: 0 }] }],
    ["invalid edge span", { edgeVertices: [0, 0, 0, 1, 0, 0], edges: [{ id: "edge-1", start: 1, count: 2 }] }],
    ["overlapping edge spans", { edgeVertices: [0, 0, 0, 1, 0, 0, 2, 0, 0], edges: [{ id: "edge-1", start: 0, count: 2 }, { id: "edge-2", start: 1, count: 2 }] }],
    ["duplicate edge ids", { edgeVertices: [0, 0, 0, 1, 0, 0, 2, 0, 0], edges: [{ id: "same", start: 0, count: 1 }, { id: "same", start: 1, count: 1 }] }],
    ["empty edge spans", { edgeVertices: [0, 0, 0], edges: [{ id: "edge-1", start: 0, count: 0 }] }],
    ["empty semantic ids", { requestId: "", featureId: "" }],
    ["reversed bounding box", { bboxMm: [1, 0, 0, 0, 1, 1] }],
    ["non-finite volume", { volumeMm3: Number.NaN }],
    ["unsafe revision", { revision: BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1) }],
  ];

  it.each(invalidMeshCases)("rejects invalid MeshUpdate data: %s", (_name, overrides) => {
    expect(() => decodeMeshUpdateFb(meshFixture(overrides))).toThrow();
  });

  it("checks declared lengths before accepting hostile vector lengths", () => {
    const bytes = meshFixture();
    const update = MeshUpdate.getRootAsMeshUpdate(new flatbuffers.ByteBuffer(bytes));
    const vector = update.positionsArray()!;
    const vectorOffset = vector.byteOffset - bytes.byteOffset;
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(vectorOffset - 4, 0xffffffff, true);
    expect(() => decodeMeshUpdateFb(bytes)).toThrow();
  });

  it("corrupt mesh frames throw honestly", () => {
    expect(() => decodeMeshUpdateFb(new Uint8Array(0))).toThrow();
    expect(() =>
      decodeMeshUpdateFb(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
    ).toThrow();
  });

  it("decodeMeshFrame routes verified-FB, JSON errors, and garbage", () => {
    const builder = new flatbuffers.Builder(64);
    const fid = builder.createString("b");
    const emptyF32 = MeshUpdate.createPositionsVector(
      builder,
      new Uint8Array(0),
    );
    const emptyU32 = MeshUpdate.createIndicesVector(
      builder,
      new Uint8Array(0),
    );
    const noFaces = MeshUpdate.createFacesVector(builder, []);
    const update = MeshUpdate.createMeshUpdate(
      builder, fid, fid, 1, fid, 0, 0, 0, emptyF32, emptyF32, emptyU32, 0,
      noFaces, 0, 0,
      MeshUpdate.createBboxMmVector(builder, [0, 0, 0, 0, 0, 0]),
      BigInt(1),
    );
    builder.finish(update);
    // Empty mesh decodes (zero triangles) — routing, not content, asserted.
    const mesh = decodeMeshFrame(builder.asUint8Array());
    expect(mesh.triangleCount).toBe(0);
    // JSON error envelope → honest mesh failure, never a misroute.
    const err = new TextEncoder().encode(
      '{"protocolVersion":1,"requestId":"r","status":"error","errorCode":"X","errorMessage":"nope"}',
    );
    expect(() => decodeMeshFrame(err)).toThrow(/nope/);
    // Binary garbage → corruption error, never a hang or silent empty mesh.
    expect(() =>
      decodeMeshFrame(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
    ).toThrow(/corrupt/);
  });
});
