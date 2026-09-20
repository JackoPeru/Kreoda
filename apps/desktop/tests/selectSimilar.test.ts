import { describe, expect, it } from "vitest";
import {
  connectedEdgeIds,
  roleClass,
  similarFaceIds,
} from "../src/interaction/selectSimilar";
import type { CoreMeshData } from "@kreoda/protocol";

const mesh = (
  faces: string[],
  edges: { id: string; verts: number[] }[] = [],
): CoreMeshData => {
  const positions = new Float32Array([0, 0, 0]);
  const normals = new Float32Array([0, 0, 1]);
  const indices = new Uint32Array([0, 0, 0]);
  const edgeVertices: number[] = [];
  const edgeRanges = edges.map((e) => {
    const start = edgeVertices.length / 3;
    edgeVertices.push(...e.verts);
    return {
      persistentEdgeId: e.id,
      vertexStart: start,
      vertexCount: e.verts.length / 3,
    };
  });
  void 0;
  return {
    positions,
    normals,
    indices,
    faces: faces.map((f, i) => ({
      persistentFaceId: f,
      triangleStart: i,
      triangleCount: 1,
    })),
    edgeVertices: new Float32Array(edgeVertices),
    edges: edgeRanges,
    volumeMm3: 0,
    bboxMm: [0, 0, 0, 1, 1, 1],
    triangleCount: faces.length,
    revision: 1,
  };
};

describe("selection helpers (§16)", () => {
  it("strips axis signs for role classes", () => {
    expect(roleClass("b:box.+X")).toBe("box.X");
    expect(roleClass("b:box.-X")).toBe("box.X");
    expect(roleClass("b:edge.lin.a~b")).toBe("edge.lin.a~b");
  });

  it("selects the opposite cap as similar", () => {
    const meshes = {
      b: mesh(["b:box.+X", "b:box.-X", "b:box.+Z"]),
    };
    expect(similarFaceIds(meshes, "b:box.+X")).toEqual([
      "b:box.+X",
      "b:box.-X",
    ]);
  });

  it("returns the seed when the body is unknown", () => {
    expect(similarFaceIds({}, "b:box.+X")).toEqual(["b:box.+X"]);
    expect(connectedEdgeIds({}, "b:edge.lin.a~b")).toEqual([
      "b:edge.lin.a~b",
    ]);
  });

  it("flood-fills connected edges through shared endpoints", () => {
    const meshes = {
      b: mesh([], [
        { id: "b:e0", verts: [0, 0, 0, 1, 0, 0] },
        { id: "b:e1", verts: [1, 0, 0, 1, 1, 0] },
        { id: "b:e2", verts: [5, 5, 5, 6, 5, 5] },
      ]),
    };
    expect(connectedEdgeIds(meshes, "b:e0").sort()).toEqual(["b:e0", "b:e1"]);
  });
});
