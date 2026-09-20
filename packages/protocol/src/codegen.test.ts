// Phase 8 flatc parity: generated bindings must agree with the handwritten
// registry (packages/protocol/src/index.ts) and actually round-trip.
// Mesh successes cross the wire as MeshUpdate tables (§8).

import * as flatbuffers from "flatbuffers";
import { describe, expect, it } from "vitest";
import {
  CommandType as Handwritten,
  decodeMeshFrame,
  decodeMeshUpdateFb,
  isJsonResponse,
} from "./index.js";
import { CommandEnvelope } from "./generated/intent-cad/protocol/command-envelope.js";
import { CommandPayload } from "./generated/intent-cad/protocol/command-payload.js";
import { CommandType as Generated } from "./generated/intent-cad/protocol/command-type.js";
import { CreateBoxCommand } from "./generated/intent-cad/protocol/create-box-command.js";
import { MeshUpdate } from "./generated/intent-cad/protocol/mesh-update.js";
import { FaceRange } from "./generated/intent-cad/protocol/face-range.js";

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
