import * as THREE from "three";
import type { SectionPlane } from "./plane";

export interface SectionCutPresentation {
  contourPositions: Float32Array;
  capPositions: Float32Array;
  capIndices: Uint32Array;
}

export function buildSectionCut(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  plane: SectionPlane,
  outwardNormals?: ArrayLike<number>,
): SectionCutPresentation {
  const empty = (): SectionCutPresentation => ({
    contourPositions: new Float32Array(),
    capPositions: new Float32Array(),
    capIndices: new Uint32Array(),
  });
  if (positions.length % 3 !== 0 || indices.length % 3 !== 0 || indices.length === 0) return empty();

  type Point = [number, number, number];
  type Node = { key: string; point: Point };
  type Segment = { a: Node; b: Node; below: boolean; above: boolean };
  const weldMm = 1e-7;
  const node = (point: Point): Node => ({
    key: point.map((value) => Math.round(value / weldMm)).join(","),
    point,
  });
  const segments = new Map<string, Segment>();
  const readPoint = (index: number): Point => [
    Number(positions[index * 3]),
    Number(positions[index * 3 + 1]),
    Number(positions[index * 3 + 2]),
  ];
  const distance = (point: Point): number =>
    point[0] * plane.normal[0] + point[1] * plane.normal[1] + point[2] * plane.normal[2] - plane.offsetMm;
  // Tangent planes leave an existing native boundary, not a new cut surface.
  let below = false, above = false;
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const side = distance(readPoint(vertex));
    below ||= side < -weldMm;
    above ||= side > weldMm;
    if (below && above) break;
  }
  if (!below || !above) return empty();
  const addIntersection = (a: Point, b: Point, da: number, db: number, out: Map<string, Node>): void => {
    if (Math.abs(da) <= weldMm) {
      const value = node(a);
      out.set(value.key, value);
    } else if (Math.abs(db) <= weldMm) {
      const value = node(b);
      out.set(value.key, value);
    } else if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      const value = node([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ]);
      out.set(value.key, value);
    }
  };

  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const vertexIndices = [Number(indices[triangle]), Number(indices[triangle + 1]), Number(indices[triangle + 2])];
    if (vertexIndices.some((index) => !Number.isInteger(index) || index < 0 || index * 3 + 2 >= positions.length)) continue;
    const points = vertexIndices.map(readPoint) as [Point, Point, Point];
    if (points.some((point) => !point.every(Number.isFinite))) continue;
    const distances = points.map(distance) as [number, number, number];
    // Fully coplanar native triangles already provide their own visible surface.
    if (distances.every((value) => Math.abs(value) <= weldMm)) continue;
    const found = new Map<string, Node>();
    for (let edge = 0; edge < 3; edge++) {
      const next = (edge + 1) % 3;
      addIntersection(points[edge]!, points[next]!, distances[edge]!, distances[next]!, found);
      if (Math.abs(distances[edge]!) <= weldMm && Math.abs(distances[next]!) <= weldMm) {
        const a = node(points[edge]!);
        const b = node(points[next]!);
        found.set(a.key, a);
        found.set(b.key, b);
      }
    }
    if (found.size !== 2) continue;
    let [a, b] = [...found.values()];
    if (!a || !b || a.key === b.key) continue;
    const faceNormal = new THREE.Vector3();
    if (outwardNormals?.length === positions.length) {
      for (const index of vertexIndices) faceNormal.add(new THREE.Vector3(
        Number(outwardNormals[index * 3]), Number(outwardNormals[index * 3 + 1]), Number(outwardNormals[index * 3 + 2]),
      ));
    }
    if (!Number.isFinite(faceNormal.lengthSq()) || faceNormal.lengthSq() < 1e-20) {
      faceNormal.crossVectors(
        new THREE.Vector3(...points[1]).sub(new THREE.Vector3(...points[0])),
        new THREE.Vector3(...points[2]).sub(new THREE.Vector3(...points[0])),
      );
    }
    const direction = faceNormal.cross(new THREE.Vector3(...plane.normal));
    if (new THREE.Vector3(...b.point).sub(new THREE.Vector3(...a.point)).dot(direction) < 0) [a, b] = [b, a];
    const key = a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`;
    const existing = segments.get(key);
    const below = distances.some(value => value < -weldMm);
    const above = distances.some(value => value > weldMm);
    if (existing) {
      existing.below ||= below;
      existing.above ||= above;
    } else segments.set(key, { a, b, below, above });
  }

  if (segments.size === 0) return empty();
  // A cut crosses incident triangles on both sides. A tangent native face
  // has incident triangles on just one side, even beside a crossing solid.
  const lines = [...segments.values()].filter(segment => segment.below && segment.above);
  if (lines.length === 0) return empty();
  const contourPositions = new Float32Array(lines.flatMap(({ a, b }) => [...a.point, ...b.point]));
  const adjacency = new Map<string, number[]>();
  lines.forEach((segment, index) => {
    for (const key of [segment.a.key, segment.b.key]) {
      const connected = adjacency.get(key) ?? [];
      connected.push(index);
      adjacency.set(key, connected);
    }
  });

  const loops: Point[][] = [];
  const visited = new Set<number>();
  for (let first = 0; first < lines.length; first++) {
    if (visited.has(first)) continue;
    const segment = lines[first]!;
    const start = segment.a;
    let current = segment.b;
    let previous = first;
    const points = [start.point];
    visited.add(first);
    let closed = false;
    for (let steps = 0; steps < lines.length; steps++) {
      if (current.key === start.key) {
        closed = points.length >= 3;
        break;
      }
      points.push(current.point);
      const connected = adjacency.get(current.key) ?? [];
      if (connected.length !== 2) break;
      const next = connected.find((index) => index !== previous && !visited.has(index));
      if (next === undefined) break;
      visited.add(next);
      const nextSegment = lines[next]!;
      current = nextSegment.a.key === current.key ? nextSegment.b : nextSegment.a;
      previous = next;
    }
    if (closed) loops.push(points);
  }
  if (loops.length === 0) return { contourPositions, capPositions: new Float32Array(), capIndices: new Uint32Array() };

  const n = new THREE.Vector3(...plane.normal).normalize();
  const axis = Math.abs(n.x) < 0.8 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = axis.cross(n).normalize();
  const v = n.clone().cross(u).normalize();
  const projected = loops.map((points) => ({
    points,
    polygon: points.map((point) => {
      const p = new THREE.Vector3(...point);
      return new THREE.Vector2(p.dot(u), p.dot(v));
    }),
  }));
  const contains = (point: THREE.Vector2, polygon: THREE.Vector2[]): boolean => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i]!, b = polygon[j]!;
      if ((a.y > point.y) !== (b.y > point.y) &&
          point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };
  const containers = projected.map((loop, index) => projected.flatMap((other, otherIndex) =>
    otherIndex !== index && contains(loop.polygon[0]!, other.polygon) ? [otherIndex] : [],
  ));
  const signs = projected.map(loop => Math.sign(THREE.ShapeUtils.area(loop.polygon)));
  const outside = containers.map(ancestors => ancestors.reduce((sum, index) => sum + signs[index]!, 0));
  const inside = outside.map((winding, index) => winding + signs[index]!);
  // Outward nested solids add occupancy; inward cavity shells remove it.
  const outerIds = projected.flatMap((_, index) => outside[index] === 0 && inside[index] !== 0 ? [index] : []);
  const holeOwner = projected.map((_, index) => {
    if (outside[index] === 0 || inside[index] !== 0) return -1;
    return outerIds.filter(outer => containers[index]!.includes(outer))
      .sort((a, b) => containers[b]!.length - containers[a]!.length)[0] ?? -1;
  });
  const capVertices: number[] = [];
  const capIndices: number[] = [];
  for (const outer of outerIds) {
    const holeIds = projected.flatMap((_, index) => holeOwner[index] === outer ? [index] : []);
    const polygonIds = [outer, ...holeIds];
    const contours = polygonIds.map((index) => projected[index]!.polygon);
    const triangles = THREE.ShapeUtils.triangulateShape(contours[0]!, contours.slice(1));
    const base = capVertices.length / 3;
    for (const index of polygonIds) {
      for (const point of projected[index]!.points) capVertices.push(...point);
    }
    for (const triangle of triangles) for (const index of triangle) capIndices.push(base + index!);
  }
  return { contourPositions, capPositions: new Float32Array(capVertices), capIndices: new Uint32Array(capIndices) };
}
