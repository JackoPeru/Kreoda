import { expect, it } from "vitest";
import { worldPointToSketchLocal, projectionWorldVertices } from "../src/viewport/ProjectionViewport";

const tilted = {
  origin: [10, 20, 30] as [number, number, number],
  xAxis: [1, 0, 0] as [number, number, number],
  yAxis: [0, Math.SQRT1_2, Math.SQRT1_2] as [number, number, number],
  normal: [0, -Math.SQRT1_2, Math.SQRT1_2] as [number, number, number],
};

it("projects located world CAD points onto non-XY sketch axes exactly once", () => {
  expect(worldPointToSketchLocal([12, 23, 33], tilted)).toEqual([2, 3 * Math.SQRT2]);
});

it("keeps viewport projection vertices in native world CAD coordinates", () => {
  const vertices = projectionWorldVertices({ featureId: "sketch", plane: tilted, geometryCurrent: true,
    status: "ok", error: "", blockingSourceIds: [], groups: [{ groupId: "g", generation: 1,
      definition: { version: 1, operation: "silhouette", sources: [{ type: "shape", featureId: "solid" }] },
      sourceFeatureIds: ["solid"], status: "ok", error: "", blockingSourceIds: [], edges: [{
        memberIndex: 0, curveType: "line", firstParameter: 0, lastParameter: 1, closed: false,
        pointsMm: [[12, 23, 33], [13, 24, 34]],
      }] }] });
  expect([...vertices]).toEqual([12, 23, 33, 13, 24, 34]);
});
