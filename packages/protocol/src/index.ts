// @intentcad/protocol — framed binary IPC (§8) + validation (§63.10).
// Transport: uint32 LE payloadLength + payload bytes over stdio/named pipe.
// protocolVersion = 1. Payload schema is schemas/cad_protocol.fbs; generated
// bindings live in src/generated (Phase 8 flatc codegen, `pnpm codegen`).
// This module keeps the handwritten framing + zod envelope validation as the
// transport truth until the FlatBuffers migration slice.
// Canonical units: mm (length), rad (angle) — see @intentcad/units.

import { z } from "zod";
import * as flatbuffers from "flatbuffers";
import { MeshUpdate } from "./generated/intent-cad/protocol.js";

export const PROTOCOL_VERSION = 1 as const;

export const CommandType = {
  None: 0,
  GetCoreInfo: 1,
  CreateDocument: 2,
  CreateBox: 3,
  CreateCylinder: 4,
  CreateSphere: 5,
  SetFeatureParameter: 6,
  DeleteFeature: 7,
  Undo: 8,
  Redo: 9,
  SaveDocument: 10,
  OpenDocument: 11,
  RequestMesh: 12,
  CreateSketch: 13,
  UpdateSketch: 14,
  CreateExtrude: 15,
  CreateRevolve: 16,
  RequestSketch: 17,
  PreviewSketch: 18,
  CreateBoolean: 19,
  CreateHole: 20,
  CreateFillet: 21,
  CreateChamfer: 22,
  RequestFaceInfo: 23,
} as const;
export type CommandType = (typeof CommandType)[keyof typeof CommandType];

const uuid = () =>
  z
    .string()
    .min(1)
    .describe("stable UUID, never a topology array index (§0.2)");

export const CommandEnvelopeSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: z.string().min(1),
  documentId: z.string().min(1),
  type: z.number().int().min(0).max(65535),
  payload: z.unknown(),
});
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;

export const CreateBoxPayloadSchema = z.object({
  featureId: uuid(),
  widthMm: z.number().positive().max(100000),
  heightMm: z.number().positive().max(100000),
  depthMm: z.number().positive().max(100000),
  origin: z
    .object({ x: z.number(), y: z.number(), z: z.number() })
    .default({ x: 0, y: 0, z: 0 }),
});
export type CreateBoxPayload = z.infer<typeof CreateBoxPayloadSchema>;

export const CreateCylinderPayloadSchema = z.object({
  featureId: uuid(),
  radiusMm: z.number().positive().max(50000),
  heightMm: z.number().positive().max(100000),
});
export type CreateCylinderPayload = z.infer<typeof CreateCylinderPayloadSchema>;

export const CreateSpherePayloadSchema = z.object({
  featureId: uuid(),
  radiusMm: z.number().positive().max(50000),
});
export type CreateSpherePayload = z.infer<typeof CreateSpherePayloadSchema>;

export const RequestMeshPayloadSchema = z.object({
  featureId: uuid(),
  lod: z.number().int().min(0).max(2).default(1),
});
export type RequestMeshPayload = z.infer<typeof RequestMeshPayloadSchema>;

// ── Sketch model (§21) ────────────────────────────────────────────
// Local 2D coords in mm; stable string ids; constraint kinds as wire names.

export const SketchPointSchema = z.object({
  id: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  fixed: z.boolean().default(false),
});
export type SketchPoint = z.infer<typeof SketchPointSchema>;

export const SketchLineSchema = z.object({
  id: z.string().min(1),
  p1: z.string().min(1),
  p2: z.string().min(1),
});
export type SketchLine = z.infer<typeof SketchLineSchema>;

export const SketchCircleSchema = z.object({
  id: z.string().min(1),
  center: z.string().min(1),
  r: z.number().positive(),
});
export type SketchCircle = z.infer<typeof SketchCircleSchema>;

export const SketchArcSchema = z.object({
  id: z.string().min(1),
  center: z.string().min(1),
  r: z.number().positive(),
  startAngleRad: z.number().default(0),
  endAngleRad: z.number().default(1),
});
export type SketchArc = z.infer<typeof SketchArcSchema>;

export const SketchConstraintKindSchema = z.enum([
  "coincident",
  "horizontal",
  "vertical",
  "parallel",
  "perpendicular",
  "equalRadius",
  "concentric",
  "distance",
  "radius",
  "diameter",
  "angle",
  "pointOnLine",
  "fixed",
]);
export type SketchConstraintKind = z.infer<typeof SketchConstraintKindSchema>;

export const SketchConstraintSchema = z.object({
  id: z.string().min(1),
  kind: SketchConstraintKindSchema,
  refs: z.array(z.string().min(1)).default([]),
  value: z.number().default(0),
});
export type SketchConstraint = z.infer<typeof SketchConstraintSchema>;

export const SketchModelSchema = z.object({
  points: z.array(SketchPointSchema).default([]),
  lines: z.array(SketchLineSchema).default([]),
  circles: z.array(SketchCircleSchema).default([]),
  arcs: z.array(SketchArcSchema).default([]),
  constraints: z.array(SketchConstraintSchema).default([]),
});
export type SketchModel = z.infer<typeof SketchModelSchema>;

export const CreateSketchPayloadSchema = z.object({
  featureId: uuid(),
  planeKind: z.enum(["XY", "XZ", "YZ"]).default("XY"),
  model: SketchModelSchema,
});
export type CreateSketchPayload = z.infer<typeof CreateSketchPayloadSchema>;

export const CreateExtrudePayloadSchema = z.object({
  featureId: uuid(),
  sketchId: uuid(),
  distanceMm: z.number().positive().max(100000),
});
export type CreateExtrudePayload = z.infer<typeof CreateExtrudePayloadSchema>;

export const CreateRevolvePayloadSchema = z.object({
  featureId: uuid(),
  sketchId: uuid(),
  angleDeg: z.number().positive().max(360),
});
export type CreateRevolvePayload = z.infer<typeof CreateRevolvePayloadSchema>;

export const CreateBooleanPayloadSchema = z.object({
  featureId: uuid(),
  op: z.enum(["fuse", "cut", "common"]),
  targetId: uuid(),
  toolId: uuid(),
});
export type CreateBooleanPayload = z.infer<typeof CreateBooleanPayloadSchema>;

export const CreateHolePayloadSchema = z.object({
  featureId: uuid(),
  targetId: uuid(),
  faceRole: z.string().min(1),
  xMm: z.number(),
  yMm: z.number(),
  diameterMm: z.number().positive().max(100000),
  depthMode: z.enum(["throughAll", "blind"]),
  depthMm: z.number().nonnegative().max(100000).default(0),
});
export type CreateHolePayload = z.infer<typeof CreateHolePayloadSchema>;

export const CreateFilletPayloadSchema = z.object({
  featureId: uuid(),
  targetId: uuid(),
  edgeIds: z.array(z.string().min(1)).min(1),
  radiusMm: z.number().positive().max(100000),
});
export type CreateFilletPayload = z.infer<typeof CreateFilletPayloadSchema>;

export const CreateChamferPayloadSchema = z.object({
  featureId: uuid(),
  targetId: uuid(),
  edgeIds: z.array(z.string().min(1)).min(1),
  distanceMm: z.number().positive().max(100000),
});
export type CreateChamferPayload = z.infer<typeof CreateChamferPayloadSchema>;

export const SketchResponseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: z.string(),
  status: z.string(),
  featureId: z.string().optional(),
  planeKind: z.string().optional(),
  sketch: z.unknown().optional(),
  solved: z.boolean().optional(),
  residual: z.number().optional(),
  dofs: z.number().optional(),
  conflicting: z.array(z.string()).default([]),
  revision: z.number().int().nonnegative().optional(),
});
export type SketchResponse = z.infer<typeof SketchResponseSchema>;

export const FaceRangeSchema = z.object({
  persistentFaceId: z.string().min(1),
  triangleStart: z.number().int().nonnegative(),
  triangleCount: z.number().int().nonnegative(),
});
export type FaceRange = z.infer<typeof FaceRangeSchema>;

export const ModelDeltaSchema = z.object({
  revision: z.number().int().nonnegative(),
  baseRevision: z.number().int().nonnegative(),
  added: z.array(z.unknown()).default([]),
  updated: z.array(z.unknown()).default([]),
  removedIds: z.array(z.string()).default([]),
  changedMeshes: z.array(z.unknown()).default([]),
});
export type ModelDelta = z.infer<typeof ModelDeltaSchema>;

/** Encode one framed message: [uint32 LE len][payload]. */
export function frameMessage(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  new DataView(out.buffer).setUint32(0, payload.length, true);
  out.set(payload, 4);
  return out;
}

/**
 * Incremental frame decoder for stdio streams. Feed chunks, pop complete
 * payloads. Guards against oversized frames (DoS / corrupt sidecar).
 */
export class FrameDecoder {
  private buf = new Uint8Array(0);
  readonly maxFrameBytes = 256 * 1024 * 1024;

  push(chunk: Uint8Array): Uint8Array[] {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf, 0);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
    const out: Uint8Array[] = [];
    while (this.buf.length >= 4) {
      const len = new DataView(
        this.buf.buffer,
        this.buf.byteOffset,
        4,
      ).getUint32(0, true);
      if (len > this.maxFrameBytes) throw new Error(`frame too large: ${len}`);
      if (this.buf.length < 4 + len) break;
      out.push(this.buf.slice(4, 4 + len));
      this.buf = this.buf.slice(4 + len);
    }
    return out;
  }
}

export function validateEnvelope(raw: unknown): CommandEnvelope {
  return CommandEnvelopeSchema.parse(raw);
}

// ── Binary mesh payload (§8, §14) ─────────────────────────────────────
// Buffers travel base64-encoded inside the interim JSON envelope; decoded
// here into typed arrays (float32 LE positions/normals, uint32 LE indices).
// FlatBuffers byte vectors replace the transfer encoding in Phase 2.

export const MeshResponseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: z.string(),
  status: z.string(),
  volumeMm3: z.number().optional(),
  bboxMm: z.array(z.number()).length(6).optional(),
  triangleCount: z.number().int().nonnegative().optional(),
  vertexCount: z.number().int().nonnegative().optional(),
  positionsB64: z.string().optional(),
  normalsB64: z.string().optional(),
  indicesB64: z.string().optional(),
  edgeVerticesB64: z.string().default(""),
  faces: z.array(FaceRangeSchema).default([]),
  edges: z
    .array(
      z.object({
        persistentEdgeId: z.string().min(1),
        vertexStart: z.number().int().nonnegative(),
        vertexCount: z.number().int().nonnegative(),
      }),
    )
    .default([]),
  revision: z.number().int().nonnegative().optional(),
});
export type MeshResponse = z.infer<typeof MeshResponseSchema>;
export type EdgeRange = MeshResponse["edges"][number];

export interface CoreMeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  faces: FaceRange[];
  edgeVertices: Float32Array;
  edges: EdgeRange[];
  volumeMm3: number;
  bboxMm: [number, number, number, number, number, number];
  triangleCount: number;
  revision: number;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Decode + validate a RequestMesh response. Throws on status/error. */
export function decodeMeshResponse(raw: unknown): CoreMeshData {  const r = MeshResponseSchema.parse(raw);
  if (r.status !== "ok") {
    throw new Error(
      `mesh failed: ${(raw as { errorMessage?: string })?.errorMessage ?? r.status}`,
    );
  }
  if (!r.positionsB64 || !r.normalsB64 || !r.indicesB64) {
    throw new Error("mesh response missing binary buffers");
  }
  const pos = b64ToBytes(r.positionsB64);
  const nor = b64ToBytes(r.normalsB64);
  const idx = b64ToBytes(r.indicesB64);
  if (pos.byteLength % 4 !== 0 || nor.byteLength % 4 !== 0 || idx.byteLength % 4 !== 0) {
    throw new Error("mesh buffer length not a multiple of 4");
  }
  if (pos.byteLength !== nor.byteLength) {
    throw new Error("positions/normals length mismatch");
  }
  const positions = new Float32Array(pos.buffer, pos.byteOffset, pos.byteLength / 4);
  const normals = new Float32Array(nor.buffer, nor.byteOffset, nor.byteLength / 4);
  const indices = new Uint32Array(idx.buffer, idx.byteOffset, idx.byteLength / 4);
  if (positions.length % 3 !== 0) throw new Error("positions not xyz triplets");
  const edgeBytes = r.edgeVerticesB64 ? b64ToBytes(r.edgeVerticesB64) : new Uint8Array(0);
  if (edgeBytes.byteLength % 4 !== 0) throw new Error("edge buffer not float32");
  const edgeVertices = new Float32Array(
    edgeBytes.buffer,
    edgeBytes.byteOffset,
    edgeBytes.byteLength / 4,
  );
  if (edgeVertices.length % 3 !== 0) throw new Error("edge verts not triplets");
  const bbox = (r.bboxMm ?? [0, 0, 0, 0, 0, 0]) as CoreMeshData["bboxMm"];
  return {
    positions: positions.slice(),
    normals: normals.slice(),
    indices: indices.slice(),
    faces: r.faces,
    edgeVertices: edgeVertices.slice(),
    edges: r.edges,
    volumeMm3: r.volumeMm3 ?? 0,
    bboxMm: bbox,
    triangleCount: r.triangleCount ?? indices.length / 3,
    revision: r.revision ?? 0,
  };
}

// ── FlatBuffers mesh responses (§8: mesh data must not be JSON) ──────
// Success frames for RequestMesh / preview are finished MeshUpdate tables;
// errors stay JSON. Decoding is verify-first: a FlatBuffers uoffset low
// byte may legally be 0x7B (`{`), so single-byte sniffing misroutes —
// verify the table, fall back to JSON only when verification fails.

/** True when a response frame holds JSON (legacy sidecar or an error). */
export function isJsonResponse(bytes: Uint8Array): boolean {
  return bytes.length > 0 && bytes[0] === 0x7b;
}

function u8ToF32(bytes: Uint8Array | null, what: string): Float32Array {
  if (!bytes || bytes.byteLength % 4 !== 0) {
    throw new Error(`mesh buffer ${what} not float32`);
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function u8ToU32(bytes: Uint8Array | null, what: string): Uint32Array {
  if (!bytes || bytes.byteLength % 4 !== 0) {
    throw new Error(`mesh buffer ${what} not uint32`);
  }
  return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

/** Decode + validate a FlatBuffers MeshUpdate frame. Throws on corrupt data. */
export function decodeMeshUpdateFb(bytes: Uint8Array): CoreMeshData {
  const mesh = tryDecodeMeshUpdateFb(bytes);
  if (!mesh) throw new Error("mesh frame is not a MeshUpdate table");
  return mesh;
}

/**
 * Verify-first decode: returns null when the bytes are not a valid
 * MeshUpdate table (JSON errors, legacy frames, corruption) — callers
 * fall back to the JSON path instead of misrouting on one byte (a
 * FlatBuffers uoffset low byte may legally be 0x7B).
 */
export function tryDecodeMeshUpdateFb(bytes: Uint8Array): CoreMeshData | null {
  try {
    if (bytes.byteLength < 16) return null;
    const bb = new flatbuffers.ByteBuffer(bytes);
    const update = MeshUpdate.getRootAsMeshUpdate(bb);
    // Loop-cap: a FaceRange/EdgeRange table needs ≥8 bytes; a larger count
    // is structurally impossible (also kills hostile-length hangs).
    if (
      update.facesLength() > bytes.byteLength / 8 ||
      update.edgesLength() > bytes.byteLength / 8
    ) {
      return null;
    }
    return decodeUpdate(update);
  } catch {
    return null;
  }
}
/**
 * Mesh frames from either encoding: verified FlatBuffers first, JSON
 * (errors, legacy sidecars) second, honest corruption error last.
 */
export function decodeMeshFrame(bytes: Uint8Array): CoreMeshData {
  const fb = tryDecodeMeshUpdateFb(bytes);
  if (fb) return fb;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("mesh frame corrupt (neither FlatBuffers nor JSON)");
  }
  return decodeMeshResponse(parsed);
}

/**
 * requestId carried by a response frame, either encoding (C15): the
 * sidecar correlates pipelined responses by id, never arrival order.
 * Returns null when the frame carries no readable id.
 */
export function responseRequestId(bytes: Uint8Array): string | null {
  if (bytes.byteLength >= 16 && !isJsonResponse(bytes)) {
    try {
      const update = MeshUpdate.getRootAsMeshUpdate(
        new flatbuffers.ByteBuffer(bytes),
      );
      const id = update.requestId();
      if (typeof id === "string" && id.length > 0) return id;
    } catch {
      // Fall through to the JSON attempt below.
    }
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
      requestId?: unknown;
    };
    return typeof parsed.requestId === "string" ? parsed.requestId : null;
  } catch {
    return null;
  }
}

function decodeUpdate(update: MeshUpdate): CoreMeshData {
  const pos = u8ToF32(update.positionsArray(), "positions");
  const nor = u8ToF32(update.normalsArray(), "normals");
  const idx = u8ToU32(update.indicesArray(), "indices");
  if (pos.byteLength !== nor.byteLength) {
    throw new Error("positions/normals length mismatch");
  }
  if (pos.length % 3 !== 0) throw new Error("positions not xyz triplets");
  if (update.positionsCount() !== pos.length) {
    throw new Error("positions count mismatch");
  }
  if (update.indicesCount() !== idx.length) {
    throw new Error("indices count mismatch");
  }
  const positions = new Float32Array(pos);
  const normals = new Float32Array(nor);
  const indices = new Uint32Array(idx);
  const edgeRaw = update.edgeVerticesArray() ?? new Uint8Array(0);
  if (edgeRaw.byteLength % 4 !== 0) {
    throw new Error("edge buffer not float32");
  }
  const edgeVertices = new Float32Array(
    edgeRaw.buffer,
    edgeRaw.byteOffset,
    edgeRaw.byteLength / 4,
  );
  if (edgeVertices.length % 3 !== 0) {
    throw new Error("edge verts not triplets");
  }
  const faces: FaceRange[] = [];
  const nf = update.facesLength();
  for (let i = 0; i < nf; i++) {
    const f = update.faces(i);
    if (!f) throw new Error("mesh face missing");
    faces.push({
      persistentFaceId: f.persistentFaceId() ?? "",
      triangleStart: f.triangleStart(),
      triangleCount: f.triangleCount(),
    });
  }
  const edges: EdgeRange[] = [];
  const ne = update.edgesLength();
  for (let i = 0; i < ne; i++) {
    const e = update.edges(i);
    if (!e) throw new Error("mesh edge missing");
    edges.push({
      persistentEdgeId: e.persistentEdgeId() ?? "",
      vertexStart: e.vertexStart(),
      vertexCount: e.vertexCount(),
    });
  }
  const bboxRaw = update.bboxMmArray();
  const bbox: CoreMeshData["bboxMm"] =
    bboxRaw && bboxRaw.length === 6
      ? [bboxRaw[0]!, bboxRaw[1]!, bboxRaw[2]!, bboxRaw[3]!, bboxRaw[4]!, bboxRaw[5]!]
      : [0, 0, 0, 0, 0, 0];
  const revision = Number(update.revision());
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("mesh revision invalid");
  }
  return {
    positions,
    normals,
    indices,
    faces,
    edgeVertices: new Float32Array(edgeVertices),
    edges,
    volumeMm3: update.volumeMm3(),
    bboxMm: bbox,
    triangleCount: indices.length / 3,
    revision,
  };
}
