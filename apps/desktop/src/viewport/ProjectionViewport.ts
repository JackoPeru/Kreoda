import * as THREE from "three";
import type { SketchPlaneFrame, SketchProjectionResult } from "@kreoda/protocol";

export function worldPointToSketchLocal(
  point: readonly number[],
  plane: SketchPlaneFrame,
): [number, number] {
  const delta = [point[0]! - plane.origin[0]!, point[1]! - plane.origin[1]!, point[2]! - plane.origin[2]!];
  const dot = (axis: readonly number[]) => delta[0]! * axis[0]! + delta[1]! * axis[1]! + delta[2]! * axis[2]!;
  const local: [number, number] = [dot(plane.xAxis), dot(plane.yAxis)];
  if (!Number.isFinite(local[0]) || !Number.isFinite(local[1])) throw new Error("projection frame contains nonfinite coordinates");
  return local;
}

export function projectionWorldVertices(projection: SketchProjectionResult): Float32Array {
  if (!projection.geometryCurrent || projection.status !== "ok") return new Float32Array();
  const points: number[] = [];
  for (const group of projection.groups) {
    if (group.status !== "ok") continue;
    for (const edge of group.edges) {
      if (edge.pointsMm.some(point => point.some(value => !Number.isFinite(value)))) continue;
      for (const point of edge.pointsMm) points.push(point[0]!, point[1]!, point[2]!);
    }
  }
  return new Float32Array(points);
}

export function createProjectionGroup(projection: SketchProjectionResult): THREE.Group {
  const root = new THREE.Group();
  root.name = `projection:${projection.featureId}`;
  root.userData = { featureId: projection.featureId, readOnlyDerived: true, worldCoordinates: true };
  if (!projection.geometryCurrent || projection.status !== "ok") return root;

  for (const group of projection.groups) {
    if (group.status !== "ok") continue;
    for (const edge of group.edges) {
      if (edge.pointsMm.length < 2 || edge.pointsMm.some(point => point.some(value => !Number.isFinite(value)))) continue;
      const points = edge.pointsMm.map(point => new THREE.Vector3(point[0], point[1], point[2]));
      if (edge.closed && points[0]!.distanceToSquared(points.at(-1)!) > 1e-12) points.push(points[0]!.clone());
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      geometry.computeBoundingBox();
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xf0a54b, transparent: true, opacity: 0.9 }));
      line.name = `projection:${projection.featureId}:${group.groupId}`;
      line.userData = { readOnlyDerived: true, groupId: group.groupId, memberIndex: edge.memberIndex };
      line.raycast = () => {};
      root.add(line);
    }
  }
  return root;
}
