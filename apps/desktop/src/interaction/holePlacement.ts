import type { CoreMeshData } from "@kreoda/protocol";
import { faceLocalFromWorld, type FaceFrame } from "./pull";

export interface Point2 {
  x: number;
  y: number;
}

export interface BoundarySegment {
  id: string;
  a: Point2;
  b: Point2;
}

export interface FacePlacement {
  triangles: [Point2, Point2, Point2][];
  loops: Point2[][];
  boundaryEdges: BoundarySegment[];
  measureEdges: BoundarySegment[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  center: Point2;
}

export type PlacementError =
  | "face-mesh"
  | "face-boundary"
  | "face-planar"
  | "face-invalid"
  | "point-invalid"
  | "point-outside"
  | "radius-clearance"
  | "distance-invalid"
  | "distance-parallel"
  | "distance-incompatible"
  | "distance-ambiguous";

export type PlacementResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PlacementError };

interface EdgeDistance {
  edge: BoundarySegment;
  distanceMm: number;
}

const cross = (a: Point2, b: Point2): number => a.x * b.y - a.y * b.x;
const subtract = (a: Point2, b: Point2): Point2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Point2, b: Point2): number => a.x * b.x + a.y * b.y;
const edgeKey = (a: number, b: number): string => a < b ? `${a}:${b}` : `${b}:${a}`;

function worldPoint(mesh: CoreMeshData, index: number): [number, number, number] | null {
  const offset = index * 3;
  const x = mesh.positions[offset];
  const y = mesh.positions[offset + 1];
  const z = mesh.positions[offset + 2];
  return x === undefined || y === undefined || z === undefined ||
    !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)
    ? null
    : [x, y, z];
}

function simplifyLoop(points: Point2[], tolerance: number): Point2[] {
  let result = points;
  let changed = true;
  while (changed && result.length > 3) {
    changed = false;
    result = result.filter((point, index) => {
      const previous = result[(index + result.length - 1) % result.length]!;
      const next = result[(index + 1) % result.length]!;
      const incoming = subtract(point, previous);
      const outgoing = subtract(next, point);
      const lengths = Math.hypot(incoming.x, incoming.y) + Math.hypot(outgoing.x, outgoing.y);
      const collinear = Math.abs(cross(incoming, outgoing)) <= tolerance * lengths;
      if (collinear && dot(incoming, outgoing) >= 0) changed = true;
      return !(collinear && dot(incoming, outgoing) >= 0);
    });
  }
  return result;
}

function boundaryLoops(
  segments: { a: number; b: number }[],
  points: Map<number, Point2>,
  tolerance: number,
): Point2[][] | null {
  const adjacency = new Map<number, { other: number; key: string }[]>();
  for (const segment of segments) {
    const key = edgeKey(segment.a, segment.b);
    adjacency.set(segment.a, [...(adjacency.get(segment.a) ?? []), { other: segment.b, key }]);
    adjacency.set(segment.b, [...(adjacency.get(segment.b) ?? []), { other: segment.a, key }]);
  }
  if ([...adjacency.values()].some((neighbors) => neighbors.length !== 2)) return null;

  const unused = new Set(segments.map(({ a, b }) => edgeKey(a, b)));
  const loops: Point2[][] = [];
  while (unused.size > 0) {
    const firstKey = unused.values().next().value as string | undefined;
    if (!firstKey) return null;
    const [firstText, secondText] = firstKey.split(":");
    const start = Number(firstText);
    let current = Number(secondText);
    const loop = [points.get(start)!];
    unused.delete(firstKey);
    let guard = segments.length;
    while (current !== start && guard-- > 0) {
      const point = points.get(current);
      if (!point) return null;
      loop.push(point);
      const next = adjacency.get(current)?.find((neighbor) => unused.has(neighbor.key));
      if (!next) return null;
      unused.delete(next.key);
      current = next.other;
    }
    if (current !== start || loop.length < 3) return null;
    loops.push(simplifyLoop(loop, tolerance));
  }
  return loops;
}

/**
 * Select only straight OCCT edge polylines adjacent to this face and lying on
 * its tessellated trim. Curved edges remain visible in the outline, not quoteable.
 */
function straightFaceEdges(
  mesh: CoreMeshData,
  role: string,
  frame: FaceFrame & { normal: [number, number, number] },
  boundaryEdges: BoundarySegment[],
  tolerance: number,
): BoundarySegment[] {
  const pointCount = Math.floor(mesh.edgeVertices.length / 3);
  const onBoundary = (point: Point2): boolean =>
    boundaryEdges.some((edge) => distanceToSegment(point, edge) <= tolerance);
  const result: BoundarySegment[] = [];
  for (const edge of mesh.edges) {
    const rolePart = edge.persistentEdgeId.slice(edge.persistentEdgeId.indexOf(":") + 1);
    const match = rolePart.match(/^edge\.([^.]+)\.(.+)$/);
    if (match?.[1] !== "lin" || !match[2]!.split("~").includes(role)) continue;
    const start = edge.vertexStart;
    const end = start + edge.vertexCount;
    if (start < 0 || edge.vertexCount < 2 || end > pointCount) continue;

    const points: Point2[] = [];
    for (let index = start; index < end; index++) {
      const offset = index * 3;
      const world: [number, number, number] = [
        mesh.edgeVertices[offset]!,
        mesh.edgeVertices[offset + 1]!,
        mesh.edgeVertices[offset + 2]!,
      ];
      if (!world.every(Number.isFinite)) {
        points.length = 0;
        break;
      }
      const planeDistance = (world[0] - frame.originMm[0]) * frame.normal[0] +
        (world[1] - frame.originMm[1]) * frame.normal[1] +
        (world[2] - frame.originMm[2]) * frame.normal[2];
      if (Math.abs(planeDistance) > tolerance) {
        points.length = 0;
        break;
      }
      points.push(faceLocalFromWorld(frame, world));
    }
    if (points.length !== edge.vertexCount) continue;

    const a = points[0]!;
    const b = points[points.length - 1]!;
    const direction = subtract(b, a);
    const length = Math.hypot(direction.x, direction.y);
    if (length <= tolerance) continue;
    let previousProjection = -tolerance;
    let isStraightTrim = true;
    for (let index = 0; index < points.length; index++) {
      const point = points[index]!;
      const perpendicular = Math.abs(cross(direction, subtract(point, a))) / length;
      const projection = dot(subtract(point, a), direction) / length;
      if (perpendicular > tolerance || projection < previousProjection - tolerance ||
        projection > length + tolerance || !onBoundary(point)) {
        isStraightTrim = false;
        break;
      }
      previousProjection = projection;
      if (index + 1 < points.length) {
        const next = points[index + 1]!;
        for (const fraction of [0.25, 0.5, 0.75]) {
          const sample = {
            x: point.x + (next.x - point.x) * fraction,
            y: point.y + (next.y - point.y) * fraction,
          };
          if (!onBoundary(sample)) isStraightTrim = false;
        }
      }
      if (!isStraightTrim) break;
    }
    if (isStraightTrim) result.push({ id: edge.persistentEdgeId, a, b });
  }
  return result;
}

/** Builds face preview from its tessellated trim; dimensions use verified B-Rep edges. */
export function buildFacePlacement(
  mesh: CoreMeshData,
  faceId: string,
  frame: FaceFrame & { normal: [number, number, number] },
): PlacementResult<FacePlacement> {
  const cut = faceId.indexOf(":");
  const role = cut < 0 ? faceId : faceId.slice(cut + 1);
  const face = mesh.faces.find((entry) =>
    entry.persistentFaceId === faceId || entry.persistentFaceId === role ||
    entry.persistentFaceId.endsWith(`:${role}`),
  );
  if (!face || face.triangleCount <= 0 || !mesh.indices.length || !mesh.positions.length) {
    return { ok: false, error: "face-mesh" };
  }
  const origin = frame.originMm;
  const normalLength = Math.hypot(...frame.normal);
  const xLength = Math.hypot(...frame.xAxis);
  const yLength = Math.hypot(...frame.yAxis);
  const finiteFrame = [...origin, ...frame.normal, ...frame.xAxis, ...frame.yAxis].every(Number.isFinite);
  if (!finiteFrame || normalLength < 0.999 || xLength < 0.999 || yLength < 0.999 ||
    Math.abs(normalLength - 1) > 1e-3 || Math.abs(xLength - 1) > 1e-3 ||
    Math.abs(yLength - 1) > 1e-3) {
    return { ok: false, error: "face-invalid" };
  }

  const normal = frame.normal.map((value) => value / normalLength) as [number, number, number];
  const projected = new Map<number, Point2>();
  const triangles: [Point2, Point2, Point2][] = [];
  const edgeUses = new Map<string, { a: number; b: number; count: number }>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let areaTotal = 0;
  let cx = 0;
  let cy = 0;
  let maxPlanarSpan = 0;

  const project = (vertex: number): Point2 | null => {
    const cached = projected.get(vertex);
    if (cached) return cached;
    const world = worldPoint(mesh, vertex);
    if (!world) return null;
    const delta: [number, number, number] = [world[0] - origin[0], world[1] - origin[1], world[2] - origin[2]];
    const offPlane = delta[0] * normal[0] + delta[1] * normal[1] + delta[2] * normal[2];
    const local = faceLocalFromWorld(frame, world);
    if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) return null;
    const point = { x: local.x, y: local.y };
    projected.set(vertex, point);
    maxX = Math.max(maxX, point.x);
    minX = Math.min(minX, point.x);
    maxY = Math.max(maxY, point.y);
    minY = Math.min(minY, point.y);
    maxPlanarSpan = Math.max(maxPlanarSpan, Math.hypot(point.x, point.y));
    if (Math.abs(offPlane) > Math.max(0.01, maxPlanarSpan * 1e-7)) return null;
    return point;
  };

  const firstIndex = face.triangleStart * 3;
  const endIndex = (face.triangleStart + face.triangleCount) * 3;
  if (firstIndex < 0 || endIndex > mesh.indices.length || endIndex % 3 !== 0) {
    return { ok: false, error: "face-mesh" };
  }
  for (let i = firstIndex; i < endIndex; i += 3) {
    const ids = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]];
    if (ids.some((id) => id === undefined)) return { ok: false, error: "face-mesh" };
    const [a, b, c] = ids as [number, number, number];
    const pa = project(a);
    const pb = project(b);
    const pc = project(c);
    if (!pa || !pb || !pc) return { ok: false, error: "face-planar" };
    const area = Math.abs(cross(subtract(pb, pa), subtract(pc, pa))) / 2;
    if (area <= 1e-10) continue;
    areaTotal += area;
    cx += ((pa.x + pb.x + pc.x) / 3) * area;
    cy += ((pa.y + pb.y + pc.y) / 3) * area;
    triangles.push([pa, pb, pc]);
    for (const [from, to] of [[a, b], [b, c], [c, a]] as const) {
      const key = edgeKey(from, to);
      const existing = edgeUses.get(key);
      if (existing) existing.count++;
      else edgeUses.set(key, { a: from, b: to, count: 1 });
    }
  }
  if (triangles.length === 0 || areaTotal <= 1e-10 || !Number.isFinite(minX) || !Number.isFinite(maxY)) {
    return { ok: false, error: "face-mesh" };
  }

  const boundary = [...edgeUses.values()].filter((edge) => edge.count === 1);
  if (boundary.length < 3 || [...edgeUses.values()].some((edge) => edge.count > 2)) {
    return { ok: false, error: "face-boundary" };
  }
  const tolerance = Math.max(0.01, Math.max(maxX - minX, maxY - minY) * 1e-7);
  const loops = boundaryLoops(boundary, projected, tolerance);
  if (!loops) return { ok: false, error: "face-boundary" };
  const boundaryEdges = loops.flatMap((loop, loopIndex) => loop.map((point, index) => ({
    id: `${loopIndex}-${index}`,
    a: point,
    b: loop[(index + 1) % loop.length]!,
  })));
  if (boundaryEdges.length < 3) return { ok: false, error: "face-boundary" };
  const measureEdges = straightFaceEdges(
    mesh,
    role,
    frame,
    boundaryEdges,
    Math.max(0.1, Math.max(maxX - minX, maxY - minY) * 1e-6),
  );
  return {
    ok: true,
    value: {
      triangles,
      loops,
      boundaryEdges,
      measureEdges,
      bounds: { minX, minY, maxX, maxY },
      center: { x: cx / areaTotal, y: cy / areaTotal },
    },
  };
}

export function distanceToSegment(point: Point2, edge: BoundarySegment): number {
  const direction = subtract(edge.b, edge.a);
  const lengthSquared = dot(direction, direction);
  if (lengthSquared <= 1e-12) return Math.hypot(point.x - edge.a.x, point.y - edge.a.y);
  const t = Math.max(0, Math.min(1, dot(subtract(point, edge.a), direction) / lengthSquared));
  return Math.hypot(point.x - (edge.a.x + direction.x * t), point.y - (edge.a.y + direction.y * t));
}

export function pointOnFace(face: FacePlacement, point: Point2): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  for (const [a, b, c] of face.triangles) {
    const ab = subtract(b, a);
    const ac = subtract(c, a);
    const ap = subtract(point, a);
    const area = cross(ab, ac);
    if (Math.abs(area) <= 1e-12) continue;
    const u = cross(ap, ac) / area;
    const v = cross(ab, ap) / area;
    if (u >= -1e-8 && v >= -1e-8 && u + v <= 1 + 1e-8) return true;
  }
  return false;
}

export function validateHoleCenter(
  face: FacePlacement,
  point: Point2,
  radiusMm: number,
): PlacementError | null {
  if (!Number.isFinite(radiusMm) || radiusMm <= 0 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return "point-invalid";
  }
  if (!pointOnFace(face, point)) return "point-outside";
  if (face.boundaryEdges.some((edge) => distanceToSegment(point, edge) < radiusMm - 1e-6)) {
    return "radius-clearance";
  }
  return null;
}

function closestPoint(point: Point2, edge: BoundarySegment): Point2 {
  const direction = subtract(edge.b, edge.a);
  const lengthSquared = dot(direction, direction);
  const t = lengthSquared <= 1e-12
    ? 0
    : Math.max(0, Math.min(1, dot(subtract(point, edge.a), direction) / lengthSquared));
  return { x: edge.a.x + direction.x * t, y: edge.a.y + direction.y * t };
}

function liesAlongSegment(point: Point2, edge: BoundarySegment): boolean {
  const length = Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y);
  if (length <= 1e-10) return false;
  const along = dot(subtract(point, edge.a), subtract(edge.b, edge.a)) / length;
  return along >= -1e-6 && along <= length + 1e-6;
}

/** Solves one or two signed offsets while requiring the final circle to fit the trimmed face. */
export function solveEdgeDistances(
  face: FacePlacement,
  origin: Point2,
  distances: EdgeDistance[],
  radiusMm: number,
): PlacementResult<Point2> {
  if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y) || !Number.isFinite(radiusMm) || radiusMm <= 0 ||
    distances.length < 1 || distances.length > 2 || distances.some((item) => !Number.isFinite(item.distanceMm) || item.distanceMm <= 0)) {
    return { ok: false, error: "distance-invalid" };
  }
  const lines = distances.map(({ edge, distanceMm }) => {
    const direction = subtract(edge.b, edge.a);
    const length = Math.hypot(direction.x, direction.y);
    return {
      edge,
      distanceMm,
      normal: { x: -direction.y / length, y: direction.x / length },
    };
  });
  if (lines.some((line) => !Number.isFinite(line.normal.x) || Math.hypot(line.normal.x, line.normal.y) < 0.99)) {
    return { ok: false, error: "distance-invalid" };
  }

  const candidates: Point2[] = [];
  if (lines.length === 1) {
    const line = lines[0]!;
    const signed = dot(line.normal, subtract(origin, line.edge.a));
    const direction = subtract(line.edge.b, line.edge.a);
    const projection = dot(subtract(origin, line.edge.a), direction) / dot(direction, direction);
    if (projection < -1e-6 || projection > 1 + 1e-6) return { ok: false, error: "distance-incompatible" };
    const signs = Math.abs(signed) <= 1e-8 ? [1, -1] : [Math.sign(signed)];
    for (const sign of signs) {
      const candidate = {
        x: origin.x + line.normal.x * (sign * line.distanceMm - signed),
        y: origin.y + line.normal.y * (sign * line.distanceMm - signed),
      };
      if (liesAlongSegment(candidate, line.edge) && Math.abs(distanceToSegment(candidate, line.edge) - line.distanceMm) < 1e-5) {
        candidates.push(candidate);
      }
    }
  } else {
    const first = lines[0]!;
    const second = lines[1]!;
    const determinant = cross(first.normal, second.normal);
    if (Math.abs(determinant) < 1e-6) return { ok: false, error: "distance-parallel" };
    for (const signA of [1, -1]) {
      for (const signB of [1, -1]) {
        const c1 = dot(first.normal, first.edge.a) + signA * first.distanceMm;
        const c2 = dot(second.normal, second.edge.a) + signB * second.distanceMm;
        const candidate = {
          x: (c1 * second.normal.y - first.normal.y * c2) / determinant,
          y: (first.normal.x * c2 - c1 * second.normal.x) / determinant,
        };
        if (liesAlongSegment(candidate, first.edge) && liesAlongSegment(candidate, second.edge) &&
          Math.abs(distanceToSegment(candidate, first.edge) - first.distanceMm) < 1e-5 &&
          Math.abs(distanceToSegment(candidate, second.edge) - second.distanceMm) < 1e-5) {
          candidates.push(candidate);
        }
      }
    }
  }

  const unique = candidates.filter((point, index) =>
    candidates.findIndex((other) => Math.hypot(point.x - other.x, point.y - other.y) < 1e-5) === index,
  );
  if (unique.length === 0) return { ok: false, error: "distance-incompatible" };
  const fitting = unique.filter((point) => validateHoleCenter(face, point, radiusMm) === null);
  if (fitting.length === 0) {
    return {
      ok: false,
      error: unique.some((point) => pointOnFace(face, point)) ? "radius-clearance" : "point-outside",
    };
  }
  if (fitting.length !== 1) return { ok: false, error: "distance-ambiguous" };
  return { ok: true, value: fitting[0]! };
}
