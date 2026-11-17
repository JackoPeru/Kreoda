import { describe, expect, it } from "vitest";
import { createSectionPlane } from "../src/section/plane";
import { buildSectionCut } from "../src/section/mesh-cut";

function appendBox(
  positions: number[],
  indices: number[],
  min: [number, number, number],
  max: [number, number, number],
): void {
  const base = positions.length / 3;
  for (const point of [
    [min[0], min[1], min[2]], [max[0], min[1], min[2]],
    [max[0], max[1], min[2]], [min[0], max[1], min[2]],
    [min[0], min[1], max[2]], [max[0], min[1], max[2]],
    [max[0], max[1], max[2]], [min[0], max[1], max[2]],
  ]) positions.push(...point);
  for (const triangle of [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ]) indices.push(base + triangle[0]!, base + triangle[1]!, base + triangle[2]!);
}

function triangleArea(
  positions: Float32Array,
  indices: Uint32Array,
): number {
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3, b = indices[i + 1]! * 3, c = indices[i + 2]! * 3;
    const ab = [positions[b]! - positions[a]!, positions[b + 1]! - positions[a + 1]!, positions[b + 2]! - positions[a + 2]!];
    const ac = [positions[c]! - positions[a]!, positions[c + 1]! - positions[a + 1]!, positions[c + 2]! - positions[a + 2]!];
    area += Math.hypot(
      ab[1]! * ac[2]! - ab[2]! * ac[1]!,
      ab[2]! * ac[0]! - ab[0]! * ac[2]!,
      ab[0]! * ac[1]! - ab[1]! * ac[0]!,
    ) / 2;
  }
  return area;
}

describe("render-only section cut presentation", () => {
  it("retains crossing contours along existing triangulation edges", () => {
    const positions: number[] = [], indices: number[] = [];
    appendBox(positions, indices, [-1, -1, -1], [1, 1, 0]);
    appendBox(positions, indices, [-1, -1, 0], [1, 1, 1]);
    const cut = buildSectionCut(positions, indices, createSectionPlane([0, 0, 1], 0)!);
    expect(triangleArea(cut.capPositions, cut.capIndices)).toBeCloseTo(4, 4);
  });

  it.each([false, true])("caps only the crossing solid beside a tangent solid (inverted %s)", (inverted) => {
    const positions: number[] = [], indices: number[] = [];
    appendBox(positions, indices, [-1, -1, -1], [1, 1, 1]);
    appendBox(positions, indices, [3, -1, -2], [5, 1, 0]);
    const cut = buildSectionCut(positions, indices, createSectionPlane([0, 0, 1], 0, inverted)!);
    expect(triangleArea(cut.capPositions, cut.capIndices)).toBeCloseTo(4, 4);
    expect([...cut.capPositions].filter((_, i) => i % 3 === 0).every(x => x <= 1)).toBe(true);
    expect([...cut.contourPositions].filter((_, i) => i % 3 === 0).every(x => x <= 1)).toBe(true);
  });

  it.each([-1, 1])("does not cover a tangent native face at quota %s", (quota) => {
    const positions: number[] = [], indices: number[] = [];
    appendBox(positions, indices, [-1, -1, -1], [1, 1, 1]);
    const cut = buildSectionCut(positions, indices, createSectionPlane([0, 0, 1], quota)!);
    expect(cut.capIndices).toHaveLength(0);
  });

  it("builds a closed contour and planar cap for a native triangulated solid", () => {
    const positions: number[] = [], indices: number[] = [];
    appendBox(positions, indices, [-1, -1, -1], [1, 1, 1]);
    const cut = buildSectionCut(
      new Float32Array(positions),
      new Uint32Array(indices),
      createSectionPlane([0, 0, 1], 0)!,
    );
    expect(cut.contourPositions.length).toBeGreaterThanOrEqual(24);
    expect(triangleArea(cut.capPositions, cut.capIndices)).toBeCloseTo(4, 4);
  });

  it("does not turn a nested outward solid into a cavity", () => {
    const positions: number[] = [], indices: number[] = [];
    appendBox(positions, indices, [-2, -2, -1], [2, 2, 1]);
    appendBox(positions, indices, [-1, -1, -1], [1, 1, 1]);
    const cut = buildSectionCut(positions, indices, createSectionPlane([0, 0, 1], 0)!);
    expect(triangleArea(cut.capPositions, cut.capIndices)).toBeCloseTo(16, 4);
  });

  it("uses native outward normals when cavity indices have reversed winding", () => {
    const positions: number[] = [], indices: number[] = [];
    appendBox(positions, indices, [-2, -2, -1], [2, 2, 1]);
    const cavityStart = indices.length;
    appendBox(positions, indices, [-1, -1, -1], [1, 1, 1]);
    const normals = new Float32Array(positions.length);
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i]! * 3, b = indices[i + 1]! * 3, c = indices[i + 2]! * 3;
      const ab = [positions[b]! - positions[a]!, positions[b + 1]! - positions[a + 1]!, positions[b + 2]! - positions[a + 2]!];
      const ac = [positions[c]! - positions[a]!, positions[c + 1]! - positions[a + 1]!, positions[c + 2]! - positions[a + 2]!];
      const sign = i < cavityStart ? 1 : -1;
      const normal = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!];
      for (const vertex of [a, b, c]) for (let axis = 0; axis < 3; axis++) normals[vertex + axis]! += sign * normal[axis]!;
    }
    const cut = buildSectionCut(positions, indices, createSectionPlane([0, 0, 1], 0)!, normals);
    expect(triangleArea(cut.capPositions, cut.capIndices)).toBeCloseTo(12, 4);
  });

  it("fills an outward island inside an inward cavity", () => {
    const positions: number[] = [], indices: number[] = [];
    appendBox(positions, indices, [-2, -2, -1], [2, 2, 1]);
    const cavityStart = indices.length;
    appendBox(positions, indices, [-1, -1, -1], [1, 1, 1]);
    for (let i = cavityStart; i < indices.length; i += 3) {
      [indices[i + 1], indices[i + 2]] = [indices[i + 2]!, indices[i + 1]!];
    }
    appendBox(positions, indices, [-0.5, -0.5, -1], [0.5, 0.5, 1]);
    const cut = buildSectionCut(positions, indices, createSectionPlane([0, 0, 1], 0)!);
    expect(triangleArea(cut.capPositions, cut.capIndices)).toBeCloseTo(13, 4);
  });

  it("keeps an inward cavity shell open in a hollow section", () => {
    const positions: number[] = [], indices: number[] = [];
    appendBox(positions, indices, [-2, -2, -1], [2, 2, 1]);
    const cavityStart = indices.length;
    appendBox(positions, indices, [-1, -1, -1], [1, 1, 1]);
    for (let i = cavityStart; i < indices.length; i += 3) {
      [indices[i + 1], indices[i + 2]] = [indices[i + 2]!, indices[i + 1]!];
    }
    const cut = buildSectionCut(
      new Float32Array(positions),
      new Uint32Array(indices),
      createSectionPlane([0, 0, 1], 0)!,
    );
    expect(triangleArea(cut.capPositions, cut.capIndices)).toBeCloseTo(12, 4);
  });

  it("returns no synthetic cap when plane does not cross mesh", () => {
    const positions: number[] = [], indices: number[] = [];
    appendBox(positions, indices, [-1, -1, -1], [1, 1, 1]);
    const cut = buildSectionCut(
      new Float32Array(positions),
      new Uint32Array(indices),
      createSectionPlane([0, 0, 1], 2)!,
    );
    expect(cut.contourPositions).toHaveLength(0);
    expect(cut.capIndices).toHaveLength(0);
  });
});
