import { describe, expect, it } from "vitest";
import {
  CreateCylinderPayloadSchema,
  CreateExtrudePayloadSchema,
  CreateRevolvePayloadSchema,
  CreateSpherePayloadSchema,
  FrameDecoder,
  SketchModelSchema,
  decodeMeshResponse,
  frameMessage,
  validateEnvelope,
} from "./index.js";

describe("framing (§8)", () => {
  it("round-trips a payload through [len][payload]", () => {
    const payload = new TextEncoder().encode('{"hello":"box"}');
    const framed = frameMessage(payload);
    const dec = new FrameDecoder();
    const [out] = dec.push(framed);
    expect(new TextDecoder().decode(out)).toBe('{"hello":"box"}');
  });

  it("handles split chunks", () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const framed = frameMessage(payload);
    const dec = new FrameDecoder();
    expect(dec.push(framed.slice(0, 2))).toEqual([]);
    const [out] = dec.push(framed.slice(2));
    expect([...out]).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects oversized frames so bridges can reset (M14)", () => {
    // 300 MB length prefix: must throw (never allocate), and a fresh
    // decoder stays usable — the contract sidecar.ts relies on.
    const dec = new FrameDecoder();
    const evil = new Uint8Array([0x00, 0x00, 0x2c, 0x12]);
    expect(() => dec.push(evil)).toThrow(/too large/);
    const payload = new TextEncoder().encode("ok");
    const framed = frameMessage(payload);
    const dec2 = new FrameDecoder();
    const [out] = dec2.push(framed);
    expect(new TextDecoder().decode(out)).toBe("ok");
  });
});

describe("envelope validation (§63.10)", () => {
  it("rejects wrong protocol version", () => {
    expect(() =>
      validateEnvelope({
        protocolVersion: 999,
        requestId: "r",
        documentId: "d",
        type: 1,
        payload: {},
      }),
    ).toThrow();
  });
});

function f32b64(values: number[]): string {
  const bytes = new Uint8Array(new Float32Array(values).buffer);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function u32b64(values: number[]): string {
  const bytes = new Uint8Array(new Uint32Array(values).buffer);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

describe("primitive payloads (Phase 1)", () => {
  it("validates cylinder/sphere params", () => {
    expect(
      CreateCylinderPayloadSchema.parse({
        featureId: "c",
        radiusMm: 10,
        heightMm: 40,
      }),
    ).toBeTruthy();
    expect(() =>
      CreateSpherePayloadSchema.parse({ featureId: "s", radiusMm: -2 }),
    ).toThrow();
  });

  it("decodes a b64 mesh response into typed arrays", () => {
    const mesh = decodeMeshResponse({
      protocolVersion: 1,
      requestId: "r",
      status: "ok",
      volumeMm3: 1000,
      bboxMm: [0, 0, 0, 10, 10, 10],
      triangleCount: 1,
      positionsB64: f32b64([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normalsB64: f32b64([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indicesB64: u32b64([0, 1, 2]),
      faces: [
        {
          persistentFaceId: "f:box.+Z",
          triangleStart: 0,
          triangleCount: 1,
        },
      ],
    });
    expect(mesh.positions.length).toBe(9);
    expect(mesh.indices).toEqual(new Uint32Array([0, 1, 2]));
    expect(mesh.faces[0]!.persistentFaceId).toBe("f:box.+Z");
  });

  it("rejects error responses instead of fake meshes (§41)", () => {
    expect(() =>
      decodeMeshResponse({
        protocolVersion: 1,
        requestId: "r",
        status: "error",
      }),
    ).toThrow();
  });
});

describe("sketch payloads (Phase 4)", () => {
  it("validates sketch constraint kinds", () => {
    expect(
      SketchModelSchema.parse({
        points: [{ id: "p0", x: 0, y: 0 }],
        lines: [],
        circles: [],
        constraints: [{ id: "c", kind: "horizontal", refs: ["l0"], value: 0 }],
      }),
    ).toBeTruthy();
    expect(() =>
      SketchModelSchema.parse({
        points: [],
        lines: [],
        circles: [],
        constraints: [{ id: "x", kind: "nope", refs: [] }],
      }),
    ).toThrow();
  });

  it("validates extrude/revolve params", () => {
    expect(
      CreateExtrudePayloadSchema.parse({
        featureId: "e",
        sketchId: "s",
        distanceMm: 20,
      }),
    ).toBeTruthy();
    expect(() =>
      CreateRevolvePayloadSchema.parse({
        featureId: "r",
        sketchId: "s",
        angleDeg: 400,
      }),
    ).toThrow();
  });
});
