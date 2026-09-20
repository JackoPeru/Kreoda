import type { CoreMeshData } from "@kreoda/protocol";

/** Role class: role stem with axis signs stripped ("box.+X" → "box.X"). */
export function roleClass(persistentId: string): string {
  const cut = persistentId.indexOf(":");
  const role = cut < 0 ? persistentId : persistentId.slice(cut + 1);
  return role.replace(/[+-]/g, "");
}

/**
 * Select-similar faces (§16 "select similar"): faces on the same body whose
 * role class matches (e.g. both X caps of a box) — parallel/opposite pairs
 * for symmetric edits. Never array indices: role strings only (§0.2).
 */
export function similarFaceIds(
  meshes: Record<string, CoreMeshData>,
  faceId: string,
): string[] {
  const cut = faceId.indexOf(":");
  if (cut < 0) return [faceId];
  const bodyId = faceId.slice(0, cut);
  const mesh = meshes[bodyId];
  if (!mesh) return [faceId];
  const cls = roleClass(faceId);
  return mesh.faces
    .map((f) => f.persistentFaceId)
    .filter((id) => roleClass(id) === cls);
}

/**
 * Connected-edge chain (§16 "select tangent chain" first step): edges whose
 * overlay segments share endpoints (within 1e-6 mm), flood-filled from the
 * seed edge. Works purely on committed overlay buffers.
 */
export function connectedEdgeIds(
  meshes: Record<string, CoreMeshData>,
  edgeId: string,
): string[] {
  const cut = edgeId.indexOf(":");
  if (cut < 0) return [edgeId];
  const bodyId = edgeId.slice(0, cut);
  const mesh = meshes[bodyId];
  if (!mesh || mesh.edges.length === 0) return [edgeId];

  // Segment endpoints per edge id (from the overlay vertex ranges).
  const endpoints = new Map<string, [number, number, number][]>();
  for (const e of mesh.edges) {
    const pts: [number, number, number][] = [];
    for (let v = e.vertexStart; v < e.vertexStart + e.vertexCount; v++) {
      pts.push([
        mesh.edgeVertices[v * 3]!,
        mesh.edgeVertices[v * 3 + 1]!,
        mesh.edgeVertices[v * 3 + 2]!,
      ]);
    }
    if (pts.length > 0) {
      endpoints.set(e.persistentEdgeId, [pts[0]!, pts[pts.length - 1]!]);
    }
  }
  const near = (
    a: [number, number, number],
    b: [number, number, number],
  ): boolean =>
    Math.abs(a[0] - b[0]) < 1e-6 &&
    Math.abs(a[1] - b[1]) < 1e-6 &&
    Math.abs(a[2] - b[2]) < 1e-6;

  const seen = new Set<string>([edgeId]);
  const queue = [edgeId];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    const ends = endpoints.get(cur);
    if (!ends) continue;
    for (const [other, otherEnds] of endpoints) {
      if (seen.has(other)) continue;
      if (
        ends.some((p) => otherEnds.some((q) => near(p, q)))
      ) {
        seen.add(other);
        queue.push(other);
      }
    }
  }
  return [...seen];
}
