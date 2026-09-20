// Session semantic query API (§11.7–§11.9, §11.11, §11.15): read-only
// projections over the authoritative snapshot plus manipulator metadata.
// Transport-agnostic: the relay injects core access; unit tests inject
// fakes. Nothing here invents geometry — parameters come from the core
// summaries, axes/origins from mesh bboxes and face frames.

import { COMMANDS } from "@kreoda/command-schema";

export interface SnapFeature {
  featureId: string;
  type: string;
  paramsMm: number[];
  volumeMm3: number;
  dependsOn: string[];
  refExtra: string;
  expressions: Record<string, string>;
}

export interface SnapSketch {
  featureId: string;
  planeKind: string;
  points: number;
  lines: number;
  circles: number;
  constraints: number;
}

export interface SnapshotData {
  documentId: string;
  revision: number;
  features: SnapFeature[];
  sketches: SnapSketch[];
}

export interface MeshFace {
  persistentFaceId: string;
  triangleStart: number;
  triangleCount: number;
}

export interface MeshEdge {
  persistentEdgeId: string;
  vertexStart: number;
  vertexCount: number;
}

export interface MeshData {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
  faces: MeshFace[];
  edges: MeshEdge[];
  bboxMm: [number, number, number, number, number, number];
  volumeMm3: number;
}

export interface FaceFrame {
  originMm: [number, number, number];
  xAxis: [number, number, number];
  yAxis: [number, number, number];
  normal: [number, number, number];
}

export interface Manipulator {
  id: string;
  type: "linear" | "radial" | "angular" | "planar" | "position";
  parameter?: string;
  parameters?: string[];
  axis?: [number, number, number];
  origin?: [number, number, number];
  unit: "mm" | "deg";
}

export interface QueryEnv {
  snapshot: (documentId: string) => Promise<SnapshotData>;
  mesh: (documentId: string, featureId: string) => Promise<MeshData>;
  faceInfo: (
    documentId: string,
    featureId: string,
    role: string,
  ) => Promise<FaceFrame>;
  previewBegin: (
    clientId: string,
    documentId: string,
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  previewUpdate: (
    clientId: string,
    previewId: string,
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  previewCommit: (
    clientId: string,
    previewId: string,
  ) => Promise<Record<string, unknown>>;
  previewCancel: (clientId: string, previewId: string) => Promise<unknown>;
}

/** Selection registry: client-local ids, published as shared metadata. */
export interface SelectionRegistry {
  get: (clientId: string) => string[];
  set: (clientId: string, ids: string[]) => void;
  clear: (clientId: string) => void;
  drop: (clientId: string) => void;
}

export function coded(code: string, message: string): Error {
  const err = new Error(message) as Error & { code?: string };
  err.code = code;
  return err;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** Coerce a raw core feature object into the structural shape (never throws). */
export function asFeature(raw: unknown): SnapFeature | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o["featureId"] !== "string" || typeof o["type"] !== "string") {
    return null;
  }
  const params = Array.isArray(o["paramsMm"])
    ? (o["paramsMm"] as unknown[]).map((v) => num(v))
    : [];
  const deps = Array.isArray(o["dependsOn"])
    ? (o["dependsOn"] as unknown[]).filter(
        (v): v is string => typeof v === "string",
      )
    : [];
  const expr = o["expressions"];
  const expressions: Record<string, string> =
    typeof expr === "object" && expr !== null
      ? Object.fromEntries(
          Object.entries(expr as Record<string, unknown>)
            .filter(([, v]) => typeof v === "string")
            .map(([k, v]) => [k, v as string]),
        )
      : {};
  return {
    featureId: o["featureId"] as string,
    type: o["type"] as string,
    paramsMm: params,
    volumeMm3: num(o["volumeMm3"]),
    dependsOn: deps,
    refExtra: str(o["refExtra"]),
    expressions,
  };
}

export function normalizeSnapshot(
  documentId: string,
  revision: number,
  features: unknown[],
  sketches: unknown[],
): SnapshotData {
  return {
    documentId,
    revision,
    features: features
      .map(asFeature)
      .filter((f): f is SnapFeature => f !== null),
    sketches: sketches
      .map((raw) => {
        if (typeof raw !== "object" || raw === null) return null;
        const o = raw as Record<string, unknown>;
        if (typeof o["featureId"] !== "string") return null;
        return {
          featureId: o["featureId"] as string,
          planeKind: str(o["planeKind"], "XY"),
          points: num(o["points"]),
          lines: num(o["lines"]),
          circles: num(o["circles"]),
          constraints: num(o["constraints"]),
        };
      })
      .filter((s): s is SnapSketch => s !== null),
  };
}

// Canonical parameter slots per type (mirror the core evaluator).
function slot(type: string, param: string, params: number[]): number {
  const tables: Record<string, Record<string, number>> = {
    Box: { widthMm: 0, heightMm: 1, depthMm: 2 },
    Cylinder: { radiusMm: 0, heightMm: 1 },
    Sphere: { radiusMm: 0 },
    Extrude: { distanceMm: 0 },
    Revolve: { angleDeg: 0 },
    Hole: { diameterMm: 0, depthMm: 1 },
    Fillet: { radiusMm: 0 },
    Chamfer: { distanceMm: 0 },
    Instance: { txMm: 0, tyMm: 1, tzMm: 2, rxDeg: 3, ryDeg: 4, rzDeg: 5 },
  };
  const idx = tables[type]?.[param];
  if (idx === undefined || idx < 0 || idx >= params.length) return NaN;
  return params[idx]!;
}

function holeFaceRole(refExtra: string): string | null {
  for (const part of refExtra.split(";")) {
    if (part.startsWith("face=")) {
      const role = part.slice(5);
      return role.length > 0 ? role : null;
    }
  }
  return null;
}

function sketchNormal(planeKind: string): [number, number, number] {
  // Documented principal frames (mirror sketch_store PrincipalPlane).
  if (planeKind === "XZ") return [0, -1, 0];
  if (planeKind === "YZ") return [1, 0, 0];
  return [0, 0, 1];
}

function bboxCenter(bbox: MeshData["bboxMm"]): [number, number, number] {
  return [
    (bbox[0]! + bbox[3]!) / 2,
    (bbox[1]! + bbox[4]!) / 2,
    (bbox[2]! + bbox[5]!) / 2,
  ];
}

function faceTriangles(
  mesh: MeshData,
  faceId: string,
): { range: MeshFace; owner: string } | null {
  const range = mesh.faces.find((f) => f.persistentFaceId === faceId);
  if (!range || range.triangleCount === 0) return null;
  const cut = faceId.indexOf(":");
  return { range, owner: cut < 0 ? faceId : faceId.slice(0, cut) };
}

function triangleArea(
  p: MeshData["positions"],
  idx: MeshData["indices"],
  tri: number,
): number {
  const a = idx[tri * 3]! * 3;
  const b = idx[tri * 3 + 1]! * 3;
  const c = idx[tri * 3 + 2]! * 3;
  const abx = p[b]! - p[a]!;
  const aby = p[b + 1]! - p[a + 1]!;
  const abz = p[b + 2]! - p[a + 2]!;
  const acx = p[c]! - p[a]!;
  const acy = p[c + 1]! - p[a + 1]!;
  const acz = p[c + 2]! - p[a + 2]!;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  return Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
}

function faceStats(
  mesh: MeshData,
  faceId: string,
): { area: number; centroid: [number, number, number]; normal: [number, number, number] } | null {
  const hit = faceTriangles(mesh, faceId);
  if (!hit) return null;
  const { range } = hit;
  let area = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const p = mesh.positions;
  const idx = mesh.indices;
  const tris = Math.min(range.triangleCount, 512);
  for (let t = 0; t < tris; t++) {
    const tri = range.triangleStart + t;
    const a = idx[tri * 3]! * 3;
    const b = idx[tri * 3 + 1]! * 3;
    const c = idx[tri * 3 + 2]! * 3;
    const abx = p[b]! - p[a]!;
    const aby = p[b + 1]! - p[a + 1]!;
    const abz = p[b + 2]! - p[a + 2]!;
    const acx = p[c]! - p[a]!;
    const acy = p[c + 1]! - p[a + 1]!;
    const acz = p[c + 2]! - p[a + 2]!;
    const fx = aby * acz - abz * acy;
    const fy = abz * acx - abx * acz;
    const fz = abx * acy - aby * acx;
    const ar = Math.sqrt(fx * fx + fy * fy + fz * fz) / 2;
    if (!(ar > 0)) continue;
    area += ar;
    nx += fx / 2;
    ny += fy / 2;
    nz += fz / 2;
    cx += (p[a]! + p[b]! + p[c]!) / 3;
    cy += (p[a + 1]! + p[b + 1]! + p[c + 1]!) / 3;
    cz += (p[a + 2]! + p[b + 2]! + p[c + 2]!) / 3;
  }
  if (!(area > 0)) return null;
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  const n = tris || 1;
  return {
    area,
    centroid: [cx / n, cy / n, cz / n],
    normal: [nx / nl, ny / nl, nz / nl],
  };
}

function splitFaceId(full: string): { owner: string; role: string } | null {
  const cut = full.indexOf(":");
  if (cut < 0) return null;
  return { owner: full.slice(0, cut), role: full.slice(cut + 1) };
}

async function manipulatorsFor(
  env: QueryEnv,
  documentId: string,
  feature: SnapFeature,
  sketches: SnapSketch[],
): Promise<Manipulator[]> {
  const t = feature.type;
  const P = feature.paramsMm;
  if (t === "Box" && P.length >= 3) {
    const mesh = await env.mesh(documentId, feature.featureId);
    const [x0, y0, z0, x1, y1, z1] = mesh.bboxMm;
    return [
      { id: "width", type: "linear", parameter: "widthMm", axis: [1, 0, 0], origin: [x1, (y0! + y1!) / 2, (z0! + z1!) / 2], unit: "mm" },
      { id: "height", type: "linear", parameter: "heightMm", axis: [0, 1, 0], origin: [(x0! + x1!) / 2, y1, (z0! + z1!) / 2], unit: "mm" },
      { id: "depth", type: "linear", parameter: "depthMm", axis: [0, 0, 1], origin: [(x0! + x1!) / 2, (y0! + y1!) / 2, z1], unit: "mm" },
    ];
  }
  if (t === "Cylinder" && P.length >= 2) {
    const h = P[1]!;
    return [
      { id: "radius", type: "radial", parameter: "radiusMm", origin: [0, 0, h / 2], unit: "mm" },
      { id: "height", type: "linear", parameter: "heightMm", axis: [0, 0, 1], origin: [0, 0, h], unit: "mm" },
    ];
  }
  if (t === "Sphere" && P.length >= 1) {
    return [{ id: "radius", type: "radial", parameter: "radiusMm", origin: [0, 0, 0], unit: "mm" }];
  }
  if (t === "Extrude" && P.length >= 1) {
    const sketchId = feature.dependsOn[0] ?? "";
    const sketch = sketches.find((s) => s.featureId === sketchId);
    const axis = sketchNormal(sketch?.planeKind ?? "XY");
    const mesh = await env.mesh(documentId, feature.featureId);
    return [
      { id: "distance", type: "linear", parameter: "distanceMm", axis, origin: bboxCenter(mesh.bboxMm), unit: "mm" },
    ];
  }
  if (t === "Revolve" && P.length >= 1) {
    return [{ id: "angle", type: "angular", parameter: "angleDeg", unit: "deg" }];
  }
  if (t === "Hole" && P.length >= 2) {
    const out: Manipulator[] = [
      { id: "diameter", type: "radial", parameter: "diameterMm", unit: "mm" },
    ];
    const role = holeFaceRole(feature.refExtra);
    if (role) {
      try {
        const frame = await env.faceInfo(documentId, feature.dependsOn[0] ?? feature.featureId, role);
        out.push({
          id: "depth",
          type: "linear",
          parameter: "depthMm",
          axis: frame.normal,
          origin: frame.originMm,
          unit: "mm",
        });
      } catch {
        // Degraded but honest: depth without a resolved axis.
        out.push({ id: "depth", type: "linear", parameter: "depthMm", unit: "mm" });
      }
    } else {
      out.push({ id: "depth", type: "linear", parameter: "depthMm", unit: "mm" });
    }
    return out;
  }
  if (t === "Fillet" && P.length >= 1) {
    return [{ id: "radius", type: "radial", parameter: "radiusMm", unit: "mm" }];
  }
  if (t === "Chamfer" && P.length >= 1) {
    return [{ id: "distance", type: "linear", parameter: "distanceMm", unit: "mm" }];
  }
  if (t === "Instance" && P.length >= 6) {
    return [
      { id: "position", type: "position", parameters: ["txMm", "tyMm", "tzMm"], unit: "mm" },
      { id: "rotation", type: "angular", parameters: ["rxDeg", "ryDeg", "rzDeg"], unit: "deg" },
    ];
  }
  return [];
}

export const QUERY_METHODS = [
  "getDocumentInfo",
  "getBodies",
  "getFeature",
  "getParameters",
  "getDependencies",
  "getModelTree",
  "describeModel",
  "getSelection",
  "setSelection",
  "clearSelection",
  "findFaces",
  "findEdges",
  "findBodies",
  "getManipulators",
  "measureVolume",
  "measureArea",
  "getBoundingBox",
  "measureDistance",
  "measureAngle",
  "measureRadius",
  "measureDiameter",
  "validateDocument",
  "validateBody",
  "validateFeature",
  "listCommands",
  "getCapabilities",
  "previewBegin",
  "previewUpdate",
  "previewCommit",
  "previewCancel",
] as const;

export type QueryMethod = (typeof QUERY_METHODS)[number];

/**
 * Run one read-only session query (§11.7–§11.9, §11.15). Mutations,
 * transactions and command schemas stay on their own paths (invoke,
 * getCommandSchema). Returns the result plus an optional client broadcast
 * event (selection sharing) for the transport to fan out.
 */
export async function runSessionQuery(
  env: QueryEnv,
  selections: SelectionRegistry,
  clientId: string,
  method: string,
  params: Record<string, unknown>,
  documentId: string,
): Promise<{ result: unknown; notify?: Record<string, unknown> }> {
  const needId = (v: unknown, what: string): string => {
    if (typeof v !== "string" || v.length === 0) {
      throw coded("BAD_PARAMS", `${what} must be a non-empty string`);
    }
    return v;
  };
  const snap = async (): Promise<SnapshotData> => env.snapshot(documentId);
  const feature = async (id: string): Promise<SnapFeature> => {
    const s = await snap();
    const f = s.features.find((x) => x.featureId === id);
    if (!f) throw coded("NOT_FOUND", `unknown feature ${id}`);
    return f;
  };

  switch (method) {
    case "getDocumentInfo": {
      const s = await snap();
      return {
        result: {
          documentId: s.documentId,
          revision: s.revision,
          bodies: s.features.length,
          sketches: s.sketches.length,
        },
      };
    }
    case "getBodies":
    case "getModelTree": {
      const s = await snap();
      return {
        result: {
          revision: s.revision,
          bodies: s.features.map((f) => ({
            id: f.featureId,
            type: f.type,
            paramsMm: f.paramsMm,
            volumeMm3: f.volumeMm3,
            dependsOn: f.dependsOn,
          })),
          sketches: s.sketches.map((k) => ({
            id: k.featureId,
            planeKind: k.planeKind,
          })),
        },
      };
    }
    case "getFeature": {
      return { result: await feature(needId(params["featureId"], "featureId")) };
    }
    case "getParameters": {
      const f = await feature(needId(params["featureId"], "featureId"));
      return { result: { featureId: f.featureId, paramsMm: f.paramsMm, expressions: f.expressions } };
    }
    case "getDependencies": {
      const f = await feature(needId(params["featureId"], "featureId"));
      const s = await snap();
      const known = new Set([
        ...s.features.map((x) => x.featureId),
        ...s.sketches.map((x) => x.featureId),
      ]);
      return {
        result: {
          featureId: f.featureId,
          dependsOn: f.dependsOn.map((d) => ({
            id: d,
            known: known.has(d),
          })),
        },
      };
    }
    case "describeModel": {
      const s = await snap();
      const byType: Record<string, number> = {};
      for (const f of s.features) byType[f.type] = (byType[f.type] ?? 0) + 1;
      return {
        result: {
          documentId: s.documentId,
          revision: s.revision,
          bodies: s.features.length,
          sketches: s.sketches.length,
          types: byType,
          // Compact semantic summary for AI/Quest UI (§11.7): ids, types,
          // volumes — never raw B-Rep.
          summary: s.features.map((f) => ({
            id: f.featureId,
            type: f.type,
            volumeMm3: f.volumeMm3,
            formulaParams: Object.keys(f.expressions),
          })),
        },
      };
    }
    case "getSelection": {
      const target =
        typeof params["clientId"] === "string" && params["clientId"] !== ""
          ? (params["clientId"] as string)
          : clientId;
      return { result: { clientId: target, ids: selections.get(target) } };
    }
    case "setSelection": {
      if (!Array.isArray(params["ids"])) {
        throw coded("BAD_PARAMS", "ids must be an array of persistent ids");
      }
      const ids = (params["ids"] as unknown[]).filter(
        (v): v is string => typeof v === "string" && v.length > 0,
      );
      // Shared metadata must reference real entities (§11.8: never invent
      // ids). Bare ids resolve against features+sketches; face/edge ids
      // resolve by owner body.
      const s = await snap();
      const known = new Set([
        ...s.features.map((f) => f.featureId),
        ...s.sketches.map((k) => k.featureId),
      ]);
      for (const id of ids) {
        const cut = id.indexOf(":");
        const owner = cut < 0 ? id : id.slice(0, cut);
        if (!known.has(owner)) {
          throw coded("BAD_PARAMS", `unknown selection target ${owner}`);
        }
      }
      selections.set(clientId, ids);
      return {
        result: { clientId, ids },
        notify: { event: "selection", clientId, ids },
      };
    }
    case "clearSelection": {
      selections.clear(clientId);
      return {
        result: { clientId, ids: [] as string[] },
        notify: { event: "selection", clientId, ids: [] as string[] },
      };
    }
    case "findFaces": {
      const owner =
        typeof params["ownerBody"] === "string" ? (params["ownerBody"] as string) : null;
      const role =
        typeof params["role"] === "string" && params["role"] !== ""
          ? (params["role"] as string)
          : null;
      const minTriangles =
        typeof params["minTriangles"] === "number" ? (params["minTriangles"] as number) : 0;
      const s = await snap();
      const bodies = owner
        ? s.features.filter((f) => f.featureId === owner)
        : s.features;
      if (owner && bodies.length === 0) throw coded("NOT_FOUND", `unknown body ${owner}`);
      const out: {
        persistentFaceId: string;
        ownerBody: string;
        triangleCount: number;
        confidence: number;
      }[] = [];
      for (const b of bodies) {
        let mesh: MeshData;
        try {
          mesh = await env.mesh(documentId, b.featureId);
        } catch {
          continue;
        }
        for (const f of mesh.faces) {
          if (f.triangleCount < minTriangles) continue;
          const full = f.persistentFaceId;
          const cut = full.indexOf(":");
          const faceRole = cut < 0 ? full : full.slice(cut + 1);
          let confidence = 0.5;
          if (role) {
            if (faceRole === role) confidence = 1.0;
            else if (faceRole.includes(role) || role.includes(faceRole)) confidence = 0.7;
            else continue;
          }
          out.push({
            persistentFaceId: full,
            ownerBody: b.featureId,
            triangleCount: f.triangleCount,
            confidence,
          });
        }
      }
      out.sort((a, b) => b.confidence - a.confidence);
      return { result: { faces: out } };
    }
    case "findEdges": {
      const owner =
        typeof params["ownerBody"] === "string" ? (params["ownerBody"] as string) : null;
      const role =
        typeof params["role"] === "string" && params["role"] !== ""
          ? (params["role"] as string)
          : null;
      const s = await snap();
      const bodies = owner
        ? s.features.filter((f) => f.featureId === owner)
        : s.features;
      if (owner && bodies.length === 0) throw coded("NOT_FOUND", `unknown body ${owner}`);
      const out: {
        persistentEdgeId: string;
        ownerBody: string;
        vertexCount: number;
        confidence: number;
      }[] = [];
      for (const b of bodies) {
        let mesh: MeshData;
        try {
          mesh = await env.mesh(documentId, b.featureId);
        } catch {
          continue;
        }
        for (const e of mesh.edges) {
          const full = e.persistentEdgeId;
          let confidence = 0.5;
          if (role) {
            if (full.endsWith(role) || full.includes(role)) confidence = 0.7;
            else continue;
          }
          out.push({
            persistentEdgeId: full,
            ownerBody: b.featureId,
            vertexCount: e.vertexCount,
            confidence,
          });
        }
      }
      out.sort((a, b) => b.confidence - a.confidence);
      return { result: { edges: out } };
    }
    case "findBodies": {
      const type =
        typeof params["type"] === "string" && params["type"] !== ""
          ? (params["type"] as string)
          : null;
      const minVolume =
        typeof params["minVolumeMm3"] === "number" ? (params["minVolumeMm3"] as number) : 0;
      const s = await snap();
      return {
        result: {
          bodies: s.features
            .filter((f) => (!type || f.type === type) && f.volumeMm3 >= minVolume)
            .map((f) => ({
              id: f.featureId,
              type: f.type,
              volumeMm3: f.volumeMm3,
              confidence: 1.0,
            })),
        },
      };
    }
    case "getManipulators": {
      const f = await feature(needId(params["featureId"], "featureId"));
      const s = await snap();
      return {
        result: {
          featureId: f.featureId,
          manipulators: await manipulatorsFor(env, documentId, f, s.sketches),
        },
      };
    }
    case "measureVolume": {
      if (typeof params["featureId"] === "string" && params["featureId"] !== "") {
        const f = await feature(params["featureId"] as string);
        return { result: { featureId: f.featureId, volumeMm3: f.volumeMm3 } };
      }
      const s = await snap();
      return {
        result: {
          volumeMm3: s.features.reduce((a, f) => a + f.volumeMm3, 0),
        },
      };
    }
    case "measureArea": {
      const f = await feature(needId(params["featureId"], "featureId"));
      const mesh = await env.mesh(documentId, f.featureId);
      let area = 0;
      const tris = mesh.indices.length / 3;
      for (let t = 0; t < tris; t++) area += triangleArea(mesh.positions, mesh.indices, t);
      return { result: { featureId: f.featureId, areaMm2: area } };
    }
    case "getBoundingBox": {
      const f = await feature(needId(params["featureId"], "featureId"));
      const mesh = await env.mesh(documentId, f.featureId);
      return {
        result: {
          featureId: f.featureId,
          bboxMm: [...mesh.bboxMm],
          volumeMm3: mesh.volumeMm3,
        },
      };
    }
    case "measureDistance": {
      const a = needId(params["a"], "a");
      const b = needId(params["b"], "b");
      const pa = splitFaceId(a);
      const pb = splitFaceId(b);
      if (!pa || !pb) {
        throw coded("BAD_PARAMS", "a/b must be persistent face ids (<body>:<role>)");
      }
      const [ma, mb] = await Promise.all([
        env.mesh(documentId, pa.owner),
        env.mesh(documentId, pb.owner),
      ]);
      const sa = faceStats(ma, a);
      const sb = faceStats(mb, b);
      if (!sa || !sb) throw coded("NOT_FOUND", "face has no tessellated area");
      const dx = sa.centroid[0]! - sb.centroid[0]!;
      const dy = sa.centroid[1]! - sb.centroid[1]!;
      const dz = sa.centroid[2]! - sb.centroid[2]!;
      return {
        result: { a, b, distanceMm: Math.sqrt(dx * dx + dy * dy + dz * dz) },
      };
    }
    case "measureAngle": {
      const a = needId(params["a"], "a");
      const b = needId(params["b"], "b");
      const pa = splitFaceId(a);
      const pb = splitFaceId(b);
      if (!pa || !pb) {
        throw coded("BAD_PARAMS", "a/b must be persistent face ids (<body>:<role>)");
      }
      const [ma, mb] = await Promise.all([
        env.mesh(documentId, pa.owner),
        env.mesh(documentId, pb.owner),
      ]);
      const sa = faceStats(ma, a);
      const sb = faceStats(mb, b);
      if (!sa || !sb) throw coded("NOT_FOUND", "face has no tessellated area");
      const dot =
        sa.normal[0]! * sb.normal[0]! +
        sa.normal[1]! * sb.normal[1]! +
        sa.normal[2]! * sb.normal[2]!;
      const angle =
        (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
      return { result: { a, b, angleDeg: angle } };
    }
    case "measureRadius":
    case "measureDiameter": {
      const f = await feature(needId(params["featureId"], "featureId"));
      const factor = method === "measureDiameter" ? 2 : 1;
      const radiusOf = (type: string, ps: number[]): number | null => {
        if (
          type === "Cylinder" ||
          type === "Sphere" ||
          type === "Fillet"
        ) {
          const v = slot(type, "radiusMm", ps);
          return Number.isFinite(v) ? v : null;
        }
        if (type === "Hole") {
          const d = slot(type, "diameterMm", ps);
          return Number.isFinite(d) ? d / 2 : null;
        }
        return null;
      };
      const r = radiusOf(f.type, f.paramsMm);
      if (r === null) {
        throw coded("BAD_PARAMS", `${method} needs a round feature (Cylinder/Sphere/Hole/Fillet)`);
      }
      return {
        result: {
          featureId: f.featureId,
          ...(method === "measureDiameter"
            ? { diameterMm: r * factor }
            : { radiusMm: r }),
        },
      };
    }
    case "validateDocument":
    case "validateBody":
    case "validateFeature": {
      // Structural validation (never a kernel verdict): ids unique, deps
      // resolve, params finite, volumes sane, meshes fetchable on demand.
      const s = await snap();
      const scope =
        method === "validateDocument"
          ? s.features
          : s.features.filter(
              (f) => f.featureId === params["featureId"] || f.featureId === params["bodyId"],
            );
      if (method !== "validateDocument" && scope.length === 0) {
        throw coded("NOT_FOUND", "unknown feature");
      }
      const checks: { code: string; ok: boolean; detail: string }[] = [];
      const seen = new Set<string>();
      for (const f of s.features) {
        if (seen.has(f.featureId)) {
          checks.push({ code: "duplicate-id", ok: false, detail: f.featureId });
        }
        seen.add(f.featureId);
      }
      if (method === "validateDocument" && checks.length === 0) {
        checks.push({ code: "unique-ids", ok: true, detail: `${seen.size} features` });
      }
      const known = new Set([
        ...s.features.map((f) => f.featureId),
        ...s.sketches.map((k) => k.featureId),
      ]);
      for (const f of scope) {
        for (const d of f.dependsOn) {
          checks.push({
            code: "dep-resolves",
            ok: known.has(d),
            detail: `${f.featureId} → ${d}`,
          });
        }
        const badParam = f.paramsMm.some((v) => !Number.isFinite(v));
        checks.push({
          code: "params-finite",
          ok: !badParam,
          detail: f.featureId,
        });
        if (!(f.volumeMm3 > 0)) {
          checks.push({
            code: "volume-positive",
            ok: false,
            detail: `${f.featureId}: ${f.volumeMm3}`,
          });
        }
        try {
          const mesh = await env.mesh(documentId, f.featureId);
          checks.push({
            code: "mesh-fetchable",
            ok: mesh.indices.length > 0,
            detail: `${f.featureId}: ${mesh.indices.length / 3} tris`,
          });
        } catch {
          checks.push({ code: "mesh-fetchable", ok: false, detail: f.featureId });
        }
      }
      return {
        result: {
          scope: "structural",
          valid: checks.every((c) => c.ok),
          checks,
        },
      };
    }
    case "listCommands": {
      // Command registry: the same definitions driving toolbar, palette and
      // AI tools — one surface for every client (§2.5).
      return {
        result: {
          commands: (
            COMMANDS as {
              id: string;
              label: string;
              description: string;
              supportsPreview: boolean;
            }[]
          ).map((c) => ({
            id: c.id,
            label: c.label,
            description: c.description,
            supportsPreview: c.supportsPreview,
          })),
        },
      };
    }
    case "getCommandSchema": {
      // Full zod→JSON-Schema conversion arrives with the agent slice
      // (Phase 14); listCommands already exposes the surface honestly.
      throw coded(
        "NOT_IMPLEMENTED",
        "per-command JSON schemas arrive with the agent slice (listCommands works now)",
      );
    }
    case "getCapabilities": {
      return {
        result: {
          protocolVersion: 1,
          mutations: true,
          queries: [...QUERY_METHODS],
          previews: true,
          transactions: true,
          multiClient: true,
          notes: [
            "binary mesh streaming stays sidecar-direct until Phase 12",
          ],
        },
      };
    }
    case "previewBegin":
      return {
        result: await env.previewBegin(clientId, documentId, params),
      };
    case "previewUpdate":
      return {
        result: await env.previewUpdate(
          clientId,
          needId(params["previewId"], "previewId"),
          params,
        ),
      };
    case "previewCommit":
      return {
        result: await env.previewCommit(
          clientId,
          needId(params["previewId"], "previewId"),
        ),
      };
    case "previewCancel":
      return {
        result: await env.previewCancel(
          clientId,
          needId(params["previewId"], "previewId"),
        ),
      };
    default:
      throw coded(
        "NOT_IMPLEMENTED",
        `unknown session method: ${method} (typed mutations go through invoke)`,
      );
  }
}
