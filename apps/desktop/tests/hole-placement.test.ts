import { describe, expect, it } from "vitest";
import type { CoreMeshData } from "@kreoda/protocol";
import {
  buildFacePlacement,
  pointOnFace,
  solveEdgeDistances,
  validateHoleCenter,
  type BoundarySegment,
  type FacePlacement,
  type Point2,
} from "../src/interaction/holePlacement";

const frame = {
  originMm: [0, 0, 0] as [number, number, number],
  xAxis: [1, 0, 0] as [number, number, number],
  yAxis: [0, 1, 0] as [number, number, number],
  normal: [0, 0, 1] as [number, number, number],
};

function makeMesh(points: Point2[], triangles: number[][]): CoreMeshData {
  const positions = new Float32Array(points.flatMap(({ x, y }) => [x, y, 0]));
  const indices = new Uint32Array(triangles.flat());
  const uses = new Map<string, { a: number; b: number; count: number }>();
  for (let i = 0; i < indices.length; i += 3) {
    const tri = [indices[i]!, indices[i + 1]!, indices[i + 2]!];
    for (let j = 0; j < 3; j++) {
      const a = tri[j]!;
      const b = tri[(j + 1) % 3]!;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const edge = uses.get(key);
      if (edge) edge.count++;
      else uses.set(key, { a, b, count: 1 });
    }
  }
  const boundary = [...uses.values()].filter((edge) => edge.count === 1);
  const edgeVertices = new Float32Array(boundary.flatMap(({ a, b }) => {
    const one = points[a]!;
    const two = points[b]!;
    return [one.x, one.y, 0, two.x, two.y, 0];
  }));
  const edges = boundary.map((edge, index) => ({
    persistentEdgeId: `box-1:edge.lin.box.+Z~fixture.${index}`,
    vertexStart: index * 2,
    vertexCount: 2,
  }));
  return {
    positions,
    normals: new Float32Array(positions.length),
    indices,
    faces: [{ persistentFaceId: "box-1:box.+Z", triangleStart: 0, triangleCount: triangles.length }],
    edgeVertices,
    edges,
    volumeMm3: 1,
    bboxMm: [0, 0, 0, 100, 100, 1],
    triangleCount: triangles.length,
    revision: 1,
  };
}

const rectangle = () => buildFacePlacement(
  makeMesh(
    [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }],
    [[0, 1, 2], [0, 2, 3]],
  ),
  "box-1:box.+Z",
  frame,
);

function edgeBetween(face: FacePlacement, predicate: (edge: BoundarySegment) => boolean) {
  const edge = face.measureEdges.find(predicate);
  if (!edge) throw new Error("expected boundary edge missing");
  return edge;
}

describe("trimmed planar hole placement", () => {
  it("projects a transformed face frame into local X/Y coordinates", () => {
    const local = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];
    const mesh = makeMesh(local.map(({ x, y }) => ({ x: 0, y: 0 })), []);
    mesh.positions = new Float32Array(local.flatMap(({ x, y }) => [5, x, y]));
    mesh.indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    mesh.faces[0]!.triangleCount = 2;
    const edgePairs = [[0, 1], [1, 2], [2, 3], [3, 0]] as const;
    mesh.edgeVertices = new Float32Array(edgePairs.flatMap(([a, b]) => [
      5, local[a]!.x, local[a]!.y, 5, local[b]!.x, local[b]!.y,
    ]));
    mesh.edges = edgePairs.map((_, index) => ({
      persistentEdgeId: `box-1:edge.lin.box.+Z~fixture.${index}`,
      vertexStart: index,
      vertexCount: 2,
    }));
    const result = buildFacePlacement(mesh, "box-1:box.+Z", {
      originMm: [5, 0, 0],
      xAxis: [0, 1, 0],
      yAxis: [0, 0, 1],
      normal: [1, 0, 0],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.center.x).toBeCloseTo(50, 8);
      expect(result.value.center.y).toBeCloseTo(25, 8);
    }
  });

  it("extracts outer and inner actual trim loops from face triangles", () => {
    const points = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
      { x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 },
    ];
    const result = buildFacePlacement(
      makeMesh(points, [
        [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
        [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
      ]),
      "box-1:box.+Z",
      frame,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loops.map((loop) => loop.length).sort()).toEqual([4, 4]);
    expect(pointOnFace(result.value, { x: 30, y: 50 })).toBe(true);
    expect(pointOnFace(result.value, { x: 50, y: 50 })).toBe(false);
    expect(validateHoleCenter(result.value, { x: 30, y: 50 }, 9)).toBeNull();
    expect(validateHoleCenter(result.value, { x: 30, y: 50 }, 11)).toBe("radius-clearance");
  });

  it("combines a manual point with one selected boundary distance", () => {
    const result = rectangle();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bottom = edgeBetween(result.value, (edge) => edge.a.y === 0 && edge.b.y === 0);
    const solved = solveEdgeDistances(result.value, { x: 70, y: 25 }, [{ edge: bottom, distanceMm: 10 }], 4);
    expect(solved).toEqual({ ok: true, value: { x: 70, y: 10 } });
  });

  it("solves two nonparallel distances and refuses parallel constraints", () => {
    const result = rectangle();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bottom = edgeBetween(result.value, (edge) => edge.a.y === 0 && edge.b.y === 0);
    const left = edgeBetween(result.value, (edge) => edge.a.x === 0 && edge.b.x === 0);
    const top = edgeBetween(result.value, (edge) => edge.a.y === 50 && edge.b.y === 50);
    expect(solveEdgeDistances(result.value, { x: 70, y: 20 }, [
      { edge: bottom, distanceMm: 10 }, { edge: left, distanceMm: 20 },
    ], 4)).toEqual({ ok: true, value: { x: 20, y: 10 } });
    expect(solveEdgeDistances(result.value, { x: 70, y: 20 }, [
      { edge: bottom, distanceMm: 10 }, { edge: top, distanceMm: 10 },
    ], 4)).toEqual({ ok: false, error: "distance-parallel" });
  });

  it("rejects outside points, nonpositive diameters, and insufficient radius clearance", () => {
    const result = rectangle();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateHoleCenter(result.value, { x: -1, y: 25 }, 4)).toBe("point-outside");
    expect(validateHoleCenter(result.value, { x: 2, y: 25 }, 4)).toBe("radius-clearance");
    expect(validateHoleCenter(result.value, { x: 50, y: 25 }, 0)).toBe("point-invalid");
  });
});
