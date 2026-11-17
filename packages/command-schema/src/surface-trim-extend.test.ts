import { expect, it } from "vitest";
import { COMMANDS, commandNativeRequest, commandJsonSchema, featureGeometryKind } from "./index.js";

const face = { type: "face", featureId: "sheet", persistentFaceId: "sheet:face.0" };
const edge = { type: "edge", featureId: "sheet", persistentEdgeId: "sheet:edge.lin.free.0" };
const trim = { targetId: "sheet", toolId: "cutter", keepFace: face, keepUv: [4.2, 500] };
const extend = { targetId: "sheet", boundaryEdge: edge, distanceMm: 2 };

it("allocates independent native surface operations and keeps UV dimensionless", () => {
  for (const [id, nativeType] of [["CreateSurfaceTrim", 55], ["CreateSurfaceExtend", 56]] as const) {
    expect(commandJsonSchema(id)).toMatchObject({ nativeType, creation: { fixedCount: 1 }, supportsPreview: false });
    expect(COMMANDS.find(command => command.id === id)).toMatchObject({
      supportsPreview: false, beginnerVisible: false, advancedVisible: true,
    });
  }
  expect(commandNativeRequest("CreateSurfaceTrim", trim, "trimmed")).toEqual({
    type: 55, fields: { ...trim, featureId: "trimmed", toleranceMm: 1e-6 },
  });
  expect(commandNativeRequest("CreateSurfaceExtend", extend, "extended")).toEqual({
    type: 56, fields: { ...extend, featureId: "extended", toleranceMm: 1e-6 },
  });
  expect(featureGeometryKind("SurfaceTrim")).toBe("surface");
  expect(featureGeometryKind("SurfaceExtend")).toBe("surface");
  expect(featureGeometryKind("SurfaceThicken")).toBe("solid");
  expect(featureGeometryKind("SurfaceTrimmedSolid")).toBe("solid");
});

it("publishes strict topology fields with UTF-8 limits and dimensionless UV", () => {
  const trimSchema = commandJsonSchema("CreateSurfaceTrim")!.parameters as any;
  const extendSchema = commandJsonSchema("CreateSurfaceExtend")!.parameters as any;
  expect(trimSchema.additionalProperties).toBe(false);
  expect(trimSchema.properties.keepFace.additionalProperties).toBe(false);
  expect(trimSchema.properties.keepFace.properties.persistentFaceId.maxLength).toBe(512);
  expect(trimSchema.properties.keepFace.properties.persistentFaceId.maxUtf8Bytes).toBe(512);
  expect(extendSchema.additionalProperties).toBe(false);
  expect(extendSchema.properties.boundaryEdge.additionalProperties).toBe(false);
  expect(extendSchema.properties.boundaryEdge.properties.persistentEdgeId.maxLength).toBe(512);
  expect(extendSchema.properties.boundaryEdge.properties.persistentEdgeId.maxUtf8Bytes).toBe(512);
  expect(commandNativeRequest("CreateSurfaceTrim", { ...trim, keepFace: {
    ...face, persistentFaceId: "é".repeat(256),
  } }, "trimmed").fields.keepUv).toEqual([4.2, 500]);
  expect(() => commandNativeRequest("CreateSurfaceTrim", { ...trim, keepFace: {
    ...face, persistentFaceId: "x".repeat(513),
  } }, "trimmed")).toThrow();
  expect(() => commandNativeRequest("CreateSurfaceTrim", { ...trim, keepFace: {
    ...face, extra: true,
  } }, "trimmed")).toThrow();
});

it("rejects mismatched owners, internal bindings and malformed trim coordinates", () => {
  for (const fields of [
    { ...trim, toolId: "sheet" },
    { ...trim, keepFace: { ...face, featureId: "other" } },
    { ...trim, keepFace: { ...face, persistentFaceId: "other:face.0" } },
    { ...trim, keepFace: { ...face, selectionEntry: "0:1:2" } },
    { ...trim, keepFace: { ...face, persistentFaceId: "é".repeat(257) } },
    { ...trim, keepUv: [0] }, { ...trim, keepUv: [0, 1, 2] },
    { ...trim, keepUv: ["1", 2] }, { ...trim, keepUv: [NaN, 1] },
    { ...trim, toleranceMm: 0 }, { ...trim, toleranceMm: 1.1 },
    { ...trim, extra: true },
  ]) expect(() => commandNativeRequest("CreateSurfaceTrim", fields, "trimmed")).toThrow();
});

it("accepts measured positive extensions only with a strict target edge", () => {
  for (const fields of [
    { ...extend, distanceMm: 0 }, { ...extend, distanceMm: -1 },
    { ...extend, distanceMm: 0.0000001 }, { ...extend, distanceMm: 100001 },
    { ...extend, distanceMm: Infinity },
    { ...extend, boundaryEdge: { ...edge, featureId: "other" } },
    { ...extend, boundaryEdge: { ...edge, persistentEdgeId: "other:edge.lin.free.0" } },
    { ...extend, boundaryEdge: { ...edge, selectionEntry: "0:1:2" } },
    { ...extend, boundaryEdge: { ...edge, type: "face" } },
    { ...extend, toleranceMm: 1e-8 }, { ...extend, extra: true },
  ]) expect(() => commandNativeRequest("CreateSurfaceExtend", fields, "extended")).toThrow();
  expect(commandNativeRequest("CreateSurfaceExtend", {
    ...extend, distanceMm: 1e-6, toleranceMm: 1,
  }, "extended").fields.distanceMm).toBe(1e-6);
});
