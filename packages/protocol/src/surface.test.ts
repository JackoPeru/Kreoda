import { describe, expect, it } from "vitest";
import {
  SurfacePointResolveRequestSchema,
  SurfacePointResolveResultSchema,
} from "./index.js";

describe("surface point resolution contract", () => {
  it("defaults acquisition tolerance and keeps points in exact millimeters", () => {
    expect(SurfacePointResolveRequestSchema.parse({
      targetId: "surface-a",
      pointMm: [1.25, -2, 500],
      persistentFaceId: "surface-a:face.0",
    })).toEqual({
      targetId: "surface-a",
      pointMm: [1.25, -2, 500],
      persistentFaceId: "surface-a:face.0",
      maxDistanceMm: 0.5,
    });
  });

  it("rejects malformed or foreign query references and unknown fields", () => {
    for (const request of [
      { targetId: "surface-a", pointMm: [1, 2], maxDistanceMm: 0.5 },
      { targetId: "surface-a", pointMm: [1, Number.NaN, 3] },
      { targetId: "surface-a", pointMm: [1, 2, 3], persistentFaceId: "other:face.0" },
      { targetId: "surface-a", pointMm: [1, 2, 3], persistentFaceId: "é".repeat(257) },
      { targetId: "surface-a", pointMm: [1, 2, 3], maxDistanceMm: 0 },
      { targetId: "surface-a", pointMm: [1, 2, 3], maxDistanceMm: 1.01 },
      { targetId: "surface-a", pointMm: [1, 2, 3], selectionEntry: "0:1:2" },
    ]) expect(() => SurfacePointResolveRequestSchema.parse(request)).toThrow();
  });

  it("validates strict resolved point data and self-consistent face ownership", () => {
    const result = {
      keepFace: { type: "face", featureId: "surface-a", persistentFaceId: "surface-a:face.0" },
      keepUv: [4.2, 500],
      pointMm: [1, 2, 3],
      projectionDistanceMm: 0.25,
    };
    expect(SurfacePointResolveResultSchema.parse(result)).toEqual(result);
    for (const invalid of [
      { ...result, keepFace: { ...result.keepFace, persistentFaceId: "other:face.0" } },
      { ...result, keepFace: { ...result.keepFace, selectionEntry: "0:1:2" } },
      { ...result, keepUv: [1] },
      { ...result, pointMm: [1, 2, Number.POSITIVE_INFINITY] },
      { ...result, projectionDistanceMm: -1 },
      { ...result, projectionDistanceMm: 1.01 },
      { ...result, extra: true },
    ]) expect(() => SurfacePointResolveResultSchema.parse(invalid)).toThrow();
  });
});
