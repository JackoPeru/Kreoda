import { QUERY_METHODS_CONTRACT, SESSION_SERVER_CAPABILITIES, DatumDescriptorSchema, SketchDescriptorSchema,
  SketchProjectionResultSchema, type DatumDescriptor, type SketchPlaneFrame } from "@kreoda/protocol";
// Session semantic query API (§11.7–§11.9, §11.11, §11.15): read-only
// projections over authoritative snapshots and native OCCT geometry.
// Transport-agnostic: the relay injects core access; unit tests inject
// fakes. Nothing here invents geometry — parameters come from the core
// summaries; accurate measures and reference validation come from OCCT.

import { COMMANDS, commandJsonSchema, SelectionKindSchema, type CommandContext } from "@kreoda/command-schema";
import { SketchModelSchema } from "@kreoda/protocol";

export interface SnapFeature {
  featureId: string;
  type: string;
  paramsMm: number[];
  volumeMm3?: number;
  geometryCurrent?: boolean;
  status?: string;
  error?: string;
  blockingSourceIds?: string[];
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
  plane?: SketchPlaneFrame;
  supportRef?: string;
  model?: Record<string, unknown>;
  projectionGroups?: unknown[];
  geometryCurrent?: boolean;
  status?: string;
  error?: string;
  blockingSourceIds?: string[];
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
  if (type === "Sketch" || type === "Instance" || type === "DatumPlane" || type === "DatumAxis" || type === "DatumPoint") return "none";
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
  datums?: DatumDescriptor[];
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
  currentValues: Record<string, number>;
  axis?: [number, number, number];
  basis?: [number, number, number][];
  xAxis?: [number, number, number];
  yAxis?: [number, number, number];
  normal?: [number, number, number];
  rotationConvention?: "extrinsic-ZYX";
  origin?: [number, number, number];
  unit: "mm" | "deg";
}

export interface QueryEnv {
  sessionId?: () => string;
  previewSketch?: (documentId: string, featureId: string, model: unknown) => Promise<Record<string, unknown>>;
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

function featureAvailability(feature: SnapFeature): Record<string, unknown> {
  return {
    ...(feature.geometryCurrent === undefined ? {} : { geometryCurrent: feature.geometryCurrent }),
    ...(feature.status === undefined ? {} : { status: feature.status }),
    ...(feature.error === undefined ? {} : { error: feature.error }),
    ...(feature.blockingSourceIds === undefined ? {} : { blockingSourceIds: feature.blockingSourceIds }),
  };
}

function featureVolume(feature: SnapFeature): number | undefined {
  if (feature.geometryCurrent === false || feature.status === "unavailable") return undefined;
  return typeof feature.volumeMm3 === "number" && Number.isFinite(feature.volumeMm3) ? feature.volumeMm3 : undefined;
}

function sketchAvailability(sketch: SnapSketch): Record<string, unknown> {
  return {
    ...(sketch.geometryCurrent === undefined ? {} : { geometryCurrent: sketch.geometryCurrent }),
    ...(sketch.status === undefined ? {} : { status: sketch.status }),
    ...(sketch.error === undefined ? {} : { error: sketch.error }),
    ...(sketch.blockingSourceIds === undefined ? {} : { blockingSourceIds: sketch.blockingSourceIds }),
  };
}

function byTip(snapshot: SnapshotData, tip: string): SnapFeature | undefined {
  return snapshot.features.find(feature => feature.featureId === tip);
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
  const unavailable = o["geometryCurrent"] === false || o["status"] === "unavailable";
  const volumeMm3 = !unavailable && typeof o["volumeMm3"] === "number" && Number.isFinite(o["volumeMm3"])
    ? o["volumeMm3"] : undefined;
  return {
    featureId: o["featureId"] as string,
    type: o["type"] as string,
    paramsMm: params,
    ...(volumeMm3 === undefined ? {} : { volumeMm3 }),
    ...(typeof o["geometryCurrent"] === "boolean" ? { geometryCurrent: o["geometryCurrent"] } : {}),
    ...(typeof o["status"] === "string" ? { status: o["status"] } : {}),
    ...(typeof o["error"] === "string" ? { error: o["error"] } : {}),
    ...(Array.isArray(o["blockingSourceIds"]) ? { blockingSourceIds: o["blockingSourceIds"].filter((id): id is string => typeof id === "string") } : {}),
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
  datums: unknown[] = [],
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
    datums: datums.map(value => DatumDescriptorSchema.parse(value)),
    sketches: sketches
      .map((raw) => {
        if (typeof raw !== "object" || raw === null) return null;
        const o = raw as Record<string, unknown>;
        if (typeof o["featureId"] !== "string") return null;
        const sketch = {
          ...o,
          featureId: o["featureId"] as string,
          planeKind: str(o["planeKind"], "XY"),
          points: num(o["points"]),
          lines: num(o["lines"]),
          circles: num(o["circles"]),
          constraints: num(o["constraints"]),
        };
        return Array.isArray(o["projectionGroups"]) ? SketchDescriptorSchema.parse(sketch) : sketch;
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
): Promise<{ result: unknown; notify?: Record<string, unknown>; lineage?: { sessionId: string; documentId: string; revision: number } }> {
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
    case "previewSketch": {
      const featureId = needId(params["featureId"], "featureId");
      if (!Number.isSafeInteger(params["expectedRevision"]) || (params["expectedRevision"] as number) < 0)
        throw coded("BAD_PARAMS", "sketch preview requires a current revision");
      const proposed = SketchModelSchema.safeParse(params["model"]);
      if (!proposed.success) throw coded("BAD_PARAMS", "invalid canonical sketch model");
      const lineage = env.sessionId?.(), before = await snap();
      if (before.documentId !== documentId || before.revision !== params["expectedRevision"] || env.sessionId?.() !== lineage)
        throw coded("NEED_FULL_SNAPSHOT", "sketch preview is stale");
      if (!before.sketches.some(sketch => sketch.featureId === featureId)) throw coded("NOT_FOUND", "sketch preview owner is missing");
      if (!env.previewSketch) throw coded("NOT_IMPLEMENTED", "sketch preview is unavailable");
      const result = await env.previewSketch(documentId, featureId, proposed.data);
      const after = await snap();
      if (after.documentId !== documentId || after.revision !== before.revision || env.sessionId?.() !== lineage)
        throw coded("NEED_FULL_SNAPSHOT", "sketch preview changed during solve");
      return { result };
    }
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
            ...(byTip(s, b.tip) ? featureAvailability(byTip(s, b.tip)!) : {}),
          })),
          tips: s.tips,
          sketches: s.sketches.map((k) => ({
            id: k.featureId,
            planeKind: k.planeKind,
            ...sketchAvailability(k),
            ...(k.projectionGroups === undefined ? {} : { projectionGroups: k.projectionGroups }),
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
          datums: s.datums ?? [],
          bodies: s.bodies.map((b) => ({
            bodyId: b.bodyId,
            tip: b.tip,
            history: [...b.history],
            ...(byTip(s, b.tip) ? featureAvailability(byTip(s, b.tip)!) : {}),
          })),
          tips: s.tips,
        },
      };
    }
    case "getFeature": {
      return { result: await feature(needId(params["featureId"], "featureId")) };
    }
    case "getSketchProjection": {
      const featureId = needId(params["featureId"], "featureId");
      const groupId = params["groupId"] === undefined ? undefined : needId(params["groupId"], "groupId");
      const expectedRevision = params["expectedRevision"];
      if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0))
        throw coded("BAD_PARAMS", "expectedRevision must be a nonnegative safe integer");
      const sessionId = env.sessionId?.();
      const nativeValue = await env.geometry(documentId, "RequestSketchProjection", {
        featureId, ...(groupId === undefined ? {} : { groupId }),
      });
      const native = typeof nativeValue === "object" && nativeValue !== null && !Array.isArray(nativeValue)
        ? nativeValue as Record<string, unknown> : null;
      const revision = native?.["revision"];
      if (!native)
        throw coded("NEED_FULL_SNAPSHOT", "native projection query returned no object");
      if (native["documentId"] !== documentId)
        throw coded("NEED_FULL_SNAPSHOT", `native projection query returned document ${String(native["documentId"])}; expected ${documentId}`);
      if (!Number.isSafeInteger(revision) || (revision as number) < 0)
        throw coded("NEED_FULL_SNAPSHOT", "native projection query returned an invalid revision");
      if (!sessionId || env.sessionId?.() !== sessionId)
        throw coded("NEED_FULL_SNAPSHOT", "session lineage changed during native projection query");
      if (expectedRevision !== undefined && expectedRevision !== revision)
        throw coded("NEED_FULL_SNAPSHOT", "projection query belongs to an older model revision");
      let result: unknown;
      try { result = SketchProjectionResultSchema.parse(native["projection"]); }
      catch (error) { throw coded("CORE_FAILED", `native projection result is invalid: ${error instanceof Error ? error.message : String(error)}`); }
      if ((result as { featureId: string }).featureId !== featureId)
        throw coded("CORE_FAILED", "native projection feature identity differs from the request");
      return { result, lineage: { sessionId, documentId, revision: revision as number } };
    }
    case "getDatum": {
      const result = await env.geometry(documentId, "getDatum", { featureId: needId(params["featureId"], "featureId") });
      return { result: DatumDescriptorSchema.parse(result) };
    }
    case "getParameters": {
      const f = await feature(needId(params["featureId"], "featureId"));
      return { result: { featureId: f.featureId, paramsMm: f.paramsMm, expressions: f.expressions,
        ...featureAvailability(f) } };
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
            ...(featureVolume(f) === undefined ? {} : { volumeMm3: featureVolume(f) }),
            ...featureAvailability(f),
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
      if (Object.hasOwn(params, "baseRevision")) {
        const revision = params["baseRevision"];
        if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0)
          throw coded("BAD_PARAMS", "baseRevision must be a nonnegative safe integer");
        if ((await snap()).revision !== revision)
          throw coded("NEED_FULL_SNAPSHOT", "selection was picked on an older model revision");
      }
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
      const hasVolumeFilter = params["minVolumeMm3"] !== undefined;
      const minVolume = hasVolumeFilter ? params["minVolumeMm3"] as number : 0;
      const s = await snap();
      const byId = new Map(s.features.map((f) => [f.featureId, f]));
      return {
        result: {
          bodies: s.bodies
            .filter((b) => {
              const tip = byId.get(b.tip);
              if (!tip) return false;
              const volume = featureVolume(tip);
              return (!type || tip.type === type) && (hasVolumeFilter
                ? volume !== undefined && volume >= minVolume
                : true);
            })
            .map((b) => {
              const tip = byId.get(b.tip)!;
              const volume = featureVolume(tip);
              return {
                bodyId: b.bodyId,
                tip: b.tip,
                history: [...b.history],
                type: tip.type,
                ...featureAvailability(tip),
                ...(volume === undefined ? {} : { volumeMm3: volume }),
                confidence: 1.0,
                owner: b.bodyId,
                description: `${tip.type} body ${b.bodyId}`,
                ...(volume === undefined ? { diagnostic: tip.error ?? "current geometry measurement unavailable" }
                  : { geometricSummary: { volumeMm3: volume } }),
              };
            }),
        },
      };
    }
    case "listCommands": {
      let selection: CommandContext["selection"] = [];
      let referenceReason: string | undefined;
      let revision: number | undefined;
      let references: { id: string; kind?: string; owner?: string; role?: string }[] = [];
      const lineage = env.sessionId?.();
      if (params["beginnerMode"] !== undefined && typeof params["beginnerMode"] !== "boolean")
        throw coded("BAD_PARAMS", "beginnerMode must be a boolean");
      if (params["selectionIds"] !== undefined) {
        const ids = params["selectionIds"];
        if (!Array.isArray(ids) || ids.length > 64 || ids.some(id => typeof id !== "string" || !id.length || id.length > 512) ||
            new Set(ids).size !== ids.length || !Number.isSafeInteger(params["expectedRevision"]) || (params["expectedRevision"] as number) < 0)
          throw coded("BAD_PARAMS", "context requires bounded distinct references and a current revision");
        const before = await snap();revision = before.revision;
        if (before.documentId !== documentId || revision !== params["expectedRevision"] || env.sessionId?.() !== lineage)
          throw coded("NEED_FULL_SNAPSHOT", "selection context is stale");
        if (ids.length) {
          const raw = await env.geometry(documentId, "validateReferences", { ids });
          const result = raw as { valid?: boolean; checks?: { id: string; ok: boolean; kind?: string; confidence?: number; errorCode?: string; owner?: string; role?: string }[] };
          if (!result || !Array.isArray(result.checks) || result.checks.length !== ids.length ||
              result.checks.some((check, index) => !check || check.id !== ids[index]))
            throw coded("CORE_FAILED", "native reference validation is incomplete");
          const invalid = result.checks.find(check => check.ok !== true || (check.confidence !== undefined &&
            (!Number.isFinite(check.confidence) || check.confidence < .5)) || !SelectionKindSchema.safeParse(check.kind).success);
          if (invalid || result.valid !== true) referenceReason = invalid?.errorCode ?? "AMBIGUOUS_REFERENCE";
          else {
            references = result.checks;
            selection = result.checks.map(check => ({ persistentId: check.id, kind: check.kind as CommandContext["selection"][number]["kind"] }));
          }
        }
        const after = await snap();
        if (after.documentId !== documentId || after.revision !== revision || env.sessionId?.() !== lineage)
          throw coded("NEED_FULL_SNAPSHOT", "selection context changed during validation");
      }
      const context: CommandContext = { selection, beginnerMode: params["beginnerMode"] === true };
      // Command registry: the same definitions driving toolbar, palette and
      // AI tools — one surface for every client (§2.5).
      return {
        result: {
          sessionId: lineage, documentId, revision, contextValid: referenceReason === undefined,
          commands: COMMANDS.map((c) => {
            const availability = { ...c.availability(context) };
            const boundParameters: Record<string, unknown> = {};
            if (availability.available && referenceReason && Object.keys(c.optionalSelectionBindings ?? {}).length > 0) {
              availability.available = false;
              availability.reason = referenceReason;
            }
            if (availability.available) for (const [name, binding] of Object.entries(c.selectionBindings ?? {})) {
              if (binding === "owner") {
                const owners = [...new Set(references.map(r => r.owner).filter((owner): owner is string => typeof owner === "string" && owner.length > 0))];
                if (owners.length !== 1) { availability.available = false;availability.reason = "Selection must belong to one owner";break; }
                boundParameters[name] = owners[0];
              } else if (binding === "edges") boundParameters[name] = references.filter(r => r.kind === "edge").map(r => r.id);
              else if (binding === "faceRole") boundParameters[name] = references.find(r => r.kind === "face")?.role;
              else if (binding === "sketch") boundParameters[name] = references.find(r => r.kind === "sketch")?.id;
              if (boundParameters[name] === undefined) { availability.available = false;availability.reason = "Selected reference has no command binding";break; }
            }
            if (availability.available) for (const [name, binding] of Object.entries(c.optionalSelectionBindings ?? {})) {
              if (binding !== "datumPlane") continue;
              const planes = references.filter(reference => reference.kind === "datumPlane");
              if (planes.length > 1) { availability.available = false;availability.reason = "AMBIGUOUS_REFERENCE";break; }
              if (planes.length === 1) boundParameters[name] = planes[0]!.id;
            }
            return {
            id: c.id,
            label: c.label,
            description: c.description,
            supportsPreview: c.supportsPreview,
            boundParameters,
            available: availability.available,
            reason: availability.available ? undefined : referenceReason ?? availability.reason,
          }; }),
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
