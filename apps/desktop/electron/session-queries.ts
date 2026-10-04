import { QUERY_METHODS_CONTRACT, SESSION_SERVER_CAPABILITIES } from "@kreoda/protocol";
// Session semantic query API (§11.7–§11.9, §11.11, §11.15): read-only
// projections over authoritative snapshots and native OCCT geometry.
// Transport-agnostic: the relay injects core access; unit tests inject
// fakes. Nothing here invents geometry — parameters come from the core
// summaries; accurate measures and reference validation come from OCCT.

import { COMMANDS, commandJsonSchema } from "@kreoda/command-schema";

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

/**
 * Slice 6: real Body semantics over the feature-flat core wire (read-only
 * derivation — no core change). Same rule as BodyStore::rebuildFromRecords
 * (native/kreoda-core/src/model/body.h) and the renderer's buildBodies: a
 * Body is an ordered history of solid feature ids plus a tip (the visible
 * result). Feature ids are never renamed; bodies just group them.
 */
export interface SessionBody {
  bodyId: string;
  tip: string;
  history: string[];
}

/** Central feature→body semantics table (mirrors FeatureBodySemantics). */
export function sessionBodySemantics(type: string): "new" | "advances" | "none" {
  if (
    type === "Hole" ||
    type === "HolePattern" ||
    type === "Fillet" ||
    type === "Chamfer" ||
    type === "Union" ||
    type === "Subtract" ||
    type === "Intersect"
  ) {
    return "advances";
  }
  if (type === "Sketch" || type === "Instance") return "none";
  return "new";
}

export function sessionBodyIdForRoot(rootFeatureId: string): string {
  return `body-${rootFeatureId}`;
}

/** Deterministic grouping in creation order (mirrors rebuildFromRecords). */
export function buildSessionBodies(features: SnapFeature[]): SessionBody[] {
  const bodies: SessionBody[] = [];
  const memberOf = (id: string): SessionBody | undefined =>
    bodies.find((b) => b.history.includes(id));
  for (const f of features) {
    const sem = sessionBodySemantics(f.type);
    if (sem === "none" || memberOf(f.featureId)) continue;
    if (sem === "new") {
      bodies.push({
        bodyId: sessionBodyIdForRoot(f.featureId),
        tip: f.featureId,
        history: [f.featureId],
      });
      continue;
    }
    // AdvancesBody: join the deps[0] target's body; missing target roots a
    // fresh body so every solid feature belongs to exactly one body.
    const target = f.dependsOn[0];
    const owner = target !== undefined ? memberOf(target) : undefined;
    if (owner) {
      owner.history.push(f.featureId);
      owner.tip = f.featureId;
    } else {
      bodies.push({
        bodyId: sessionBodyIdForRoot(f.featureId),
        tip: f.featureId,
        history: [f.featureId],
      });
    }
  }
  return bodies;
}

export interface SnapshotData {
  documentId: string;
  revision: number;
  features: SnapFeature[];
  sketches: SnapSketch[];
  /** Slice 6: real bodies derived from the feature history (never N shapes). */
  bodies: SessionBody[];
  /** Slice 6: visible results — one tip feature id per body. */
  tips: string[];
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
  geometry: (documentId: string, method: string, params: Record<string, unknown>) => Promise<unknown>;
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
  get: (clientId: string, requesterId: string) => string[];
  set: (clientId: string, ids: string[], publish: boolean) => void;
  clear: (clientId: string, publish: boolean) => void;
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
  const list = features
    .map(asFeature)
    .filter((f): f is SnapFeature => f !== null);
  const bodies = buildSessionBodies(list);
  return {
    documentId,
    revision,
    features: list,
    bodies,
    tips: bodies.map((b) => b.tip),
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

export const QUERY_METHODS = QUERY_METHODS_CONTRACT;

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
  if ((method === "setSelection" || method === "clearSelection") && Object.hasOwn(params, "publish") && typeof params["publish"] !== "boolean") throw coded("BAD_PARAMS", "publish must be a boolean");
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
          bodies: s.bodies.length,
          features: s.features.length,
          sketches: s.sketches.length,
          tips: s.tips,
        },
      };
    }
    // Slice 6: real bodies — one entry per Body (bodyId/tip/history), not
    // one per historical shape. Feature history lives under getFeatures.
    case "getBodies":
    case "getModelTree": {
      const s = await snap();
      return {
        result: {
          revision: s.revision,
          bodies: s.bodies.map((b) => ({
            bodyId: b.bodyId,
            tip: b.tip,
            history: [...b.history],
          })),
          tips: s.tips,
          sketches: s.sketches.map((k) => ({
            id: k.featureId,
            planeKind: k.planeKind,
          })),
        },
      };
    }
    // Slice 6: feature history, optionally scoped to one body. Item shapes
    // are unchanged (featureId/type/paramsMm/volumeMm3/dependsOn/...); the
    // bodies grouping says which history each feature belongs to.
    case "getFeatures": {
      const s = await snap();
      const only =
        typeof params["bodyId"] === "string" && params["bodyId"] !== ""
          ? (params["bodyId"] as string)
          : null;
      if (only) {
        const b = s.bodies.find((x) => x.bodyId === only);
        if (!b) throw coded("NOT_FOUND", `unknown body ${only}`);
        const member = new Set(b.history);
        return {
          result: {
            revision: s.revision,
            bodyId: b.bodyId,
            tip: b.tip,
            history: [...b.history],
            features: s.features.filter((f) => member.has(f.featureId)),
          },
        };
      }
      return {
        result: {
          revision: s.revision,
          features: s.features,
          bodies: s.bodies.map((b) => ({
            bodyId: b.bodyId,
            tip: b.tip,
            history: [...b.history],
          })),
          tips: s.tips,
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
          bodies: s.bodies.length,
          features: s.features.length,
          sketches: s.sketches.length,
          types: byType,
          tips: s.tips,
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
      return { result: { clientId: target, ids: selections.get(target, clientId) } };
    }
    case "setSelection": {
      if (!Array.isArray(params["ids"])) {
        throw coded("BAD_PARAMS", "ids must be an array of persistent ids");
      }
      const rawIds = params["ids"] as unknown[];
      if (rawIds.some(id => typeof id !== "string" || id.length === 0)) {
        throw coded("BAD_PARAMS", "ids must contain non-empty strings");
      }
      const ids = [...new Set(rawIds as string[])];
      const validation = await env.geometry(documentId, "validateReferences", { ids }) as { valid: boolean; checks: unknown[] };
      if (validation.valid !== true) throw coded("BAD_PARAMS", "selection contains unresolved or ambiguous references");
      selections.set(clientId, ids, params["publish"] === true);
      return {
        result: { clientId, ids },
        ...(params["publish"] === true ? { notify: { event: "selection", clientId, ids } } : {}),
      };
    }
    case "clearSelection": {
      selections.clear(clientId, params["publish"] === true);
      return {
        result: { clientId, ids: [] as string[] },
        ...(params["publish"] === true ? { notify: { event: "selection", clientId, ids: [] as string[] } } : {}),
      };
    }
    case "getManipulators":
    case "findFaces":
    case "findEdges":
    case "measureVolume":
    case "measureArea":
    case "getBoundingBox":
    case "measureDistance":
    case "measureAngle":
    case "measureRadius":
    case "measureDiameter":
    case "validateDocument":
    case "validateBody":
    case "validateFeature":
    case "validateReferences": {
      return { result: await env.geometry(documentId, method, params) };
    }
    case "findBodies": {
      if (params["type"] !== undefined && (typeof params["type"] !== "string" || params["type"].length === 0)) {
        throw coded("BAD_PARAMS", "type must be a non-empty string");
      }
      if (params["minVolumeMm3"] !== undefined && (typeof params["minVolumeMm3"] !== "number" || !Number.isFinite(params["minVolumeMm3"]) || params["minVolumeMm3"] < 0)) {
        throw coded("BAD_PARAMS", "minVolumeMm3 must be a finite non-negative number");
      }
      const type =
        typeof params["type"] === "string" && params["type"] !== ""
          ? (params["type"] as string)
          : null;
      const minVolume =
        typeof params["minVolumeMm3"] === "number" ? (params["minVolumeMm3"] as number) : 0;
      const s = await snap();
      const byId = new Map(s.features.map((f) => [f.featureId, f]));
      return {
        result: {
          bodies: s.bodies
            .filter((b) => {
              const tip = byId.get(b.tip);
              if (!tip) return false;
              return (!type || tip.type === type) && tip.volumeMm3 >= minVolume;
            })
            .map((b) => {
              const tip = byId.get(b.tip)!;
              return {
                bodyId: b.bodyId,
                tip: b.tip,
                history: [...b.history],
                type: tip.type,
                volumeMm3: tip.volumeMm3,
                confidence: 1.0,
                owner: b.bodyId,
                description: `${tip.type} body ${b.bodyId}`,
                geometricSummary: { volumeMm3: tip.volumeMm3 },
              };
            }),
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
      if (params["id"] === undefined) return { result: { commands: COMMANDS.map(command => commandJsonSchema(command.id)) } };
      if (typeof params["id"] !== "string") throw coded("BAD_PARAMS", "command id must be a string");
      const schema = commandJsonSchema(params["id"]);
      if (!schema) throw coded("NOT_FOUND", "unknown command id");
      return { result: schema };
    }
    case "getCapabilities": {
      return {
        result: {
          protocolVersion: 1,
          serverCapabilities: [...SESSION_SERVER_CAPABILITIES],
          mutations: true,
          queries: [...QUERY_METHODS],
          previews: true,
          transactions: true,
          multiClient: true,
          notes: ["requestMeshLOD returns a JSON identity header followed by unchanged cad_protocol.fbs MeshUpdate bytes"],
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
