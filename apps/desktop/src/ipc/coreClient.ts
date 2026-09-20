// Typed IPC client (§8): framed transport, requestId correlation, version
// check, timeout + cancellation. Never blocks the render thread (§40).

import {
  CommandType,
  CoreMeshData,
  PROTOCOL_VERSION,
  decodeMeshFrame,
  decodeMeshResponse,
  frameMessage,
  isJsonResponse,
  FrameDecoder,
} from "@kreoda/protocol";
import { z } from "zod";
import { useDocumentUiStore } from "../stores";

export interface CoreInfo {
  coreVersion: string;
  occtVersion: string;
  protocolVersion: number;
  undos: number;
  redos: number;
}

export interface CreatedFeature {
  featureId: string;
  type: string;
  paramsMm: number[];
  dependsOn: string[];
  refExtra: string;
  expressions: Record<string, string>;
  volumeMm3: number;
  bboxMm: [number, number, number, number, number, number];
  revision: number;
}

export interface FeatureSummary {
  featureId: string;
  type: string;
  paramsMm: number[];
  volumeMm3: number;
  dependsOn: string[];
  refExtra: string;
  /** Formulas per parameter (§22): {} when the feature is fully numeric. */
  expressions: Record<string, string>;
}

export interface SketchSummary {
  featureId: string;
  planeKind: string;
  points: number;
  lines: number;
  circles: number;
  constraints: number;
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const CreatedFeatureSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: z.string(),
  status: z.string(),
  featureId: z.string(),
  type: z.string(),
  paramsMm: z.array(z.number()).default([]),
  dependsOn: z.array(z.string()).default([]),
  refExtra: z.string().default(""),
  expressions: z.record(z.string(), z.string()).default({}),
  volumeMm3: z.number(),
  bboxMm: z.tuple([
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
  ]),
  revision: z.number().int().nonnegative(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});

const FeatureListSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: z.string(),
  status: z.string(),
  path: z.string().optional(),
  features: z
    .array(
      z.object({
        featureId: z.string(),
        type: z.string(),
        paramsMm: z.array(z.number()),
        volumeMm3: z.number(),
        dependsOn: z.array(z.string()).default([]),
        refExtra: z.string().default(""),
        expressions: z.record(z.string(), z.string()).default({}),
      }),
    )
    .default([]),
  sketches: z
    .array(
      z.object({
        featureId: z.string(),
        type: z.string().default("Sketch"),
        planeKind: z.string().default("XY"),
        points: z.number().default(0),
        lines: z.number().default(0),
        circles: z.number().default(0),
        constraints: z.number().default(0),
      }),
    )
    .default([]),
  revision: z.number().int().nonnegative().default(0),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});

function newFeatureId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export class CoreClient {
  private seq = 0;
  decoder = new FrameDecoder();
  documentId = "doc-phase1";

  async getCoreInfo(): Promise<CoreInfo> {
    const parsed = await this.invoke(CommandType.GetCoreInfo, "", {});
    if (parsed.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error("protocol version mismatch");
    }
    return {
      coreVersion: (parsed.coreVersion as string) ?? "0.1.0-stub",
      occtVersion: (parsed.occtVersion as string) ?? "unlinked",
      protocolVersion: parsed.protocolVersion as number,
      undos: (parsed.undos as number) ?? 0,
      redos: (parsed.redos as number) ?? 0,
    };
  }

  async createDocument(documentId: string): Promise<void> {
    this.documentId = documentId;
    await this.invoke(CommandType.CreateDocument, documentId, {});
  }

  async createBox(params: {
    widthMm: number;
    heightMm: number;
    depthMm: number;
  }): Promise<CreatedFeature> {
    const featureId = newFeatureId("box");
    const parsed = await this.invoke(CommandType.CreateBox, this.documentId, {
      featureId,
      ...params,
    });
    return CreatedFeatureSchema.parse(parsed);
  }

  async createCylinder(params: {
    radiusMm: number;
    heightMm: number;
  }): Promise<CreatedFeature> {
    const featureId = newFeatureId("cyl");
    const parsed = await this.invoke(CommandType.CreateCylinder, this.documentId, {
      featureId,
      ...params,
    });
    return CreatedFeatureSchema.parse(parsed);
  }

  async createSphere(params: { radiusMm: number }): Promise<CreatedFeature> {
    const featureId = newFeatureId("sph");
    const parsed = await this.invoke(CommandType.CreateSphere, this.documentId, {
      featureId,
      ...params,
    });
    return CreatedFeatureSchema.parse(parsed);
  }

  async requestMesh(featureId: string, lod = 1): Promise<CoreMeshData> {
    const raw = await this.roundTrip({
      protocolVersion: PROTOCOL_VERSION,
      requestId: `req-${++this.seq}`,
      documentId: this.documentId,
      type: CommandType.RequestMesh,
      featureId,
      lod,
    });
    // Mesh successes are FlatBuffers (§8), errors stay JSON — the decoder
    // verifies first and only falls back to JSON when that fails.
    return decodeMeshFrame(raw);
  }

  /**
   * Typed dimension edit (§12, §22). Commits exactly one transaction unless
   * isPreview, which returns the would-be mesh without touching the model.
   * C2: the commit response carries the edited record PLUS the full
   * feature list (cross-feature expressions / instance reflow move others).
   */
  async setFeatureParameter(
    featureId: string,
    paramName: string,
    valueMm: number,
    isPreview = false,
    expression = "",
  ): Promise<(CreatedFeature & { features?: FeatureSummary[]; sketches?: SketchSummary[] }) | CoreMeshData> {
    const raw = await this.roundTrip({
      protocolVersion: PROTOCOL_VERSION,
      requestId: `req-${++this.seq}`,
      documentId: this.documentId,
      type: CommandType.SetFeatureParameter,
      featureId,
      paramName,
      valueMm,
      isPreview,
      ...(expression ? { expression } : {}),
    });
    // Preview meshes are FlatBuffers (§8); errors + commits stay JSON.
    if (isPreview) return decodeMeshFrame(raw);
    const parsed = JSON.parse(new TextDecoder().decode(raw));
    if (parsed.status === "error") {
      throw new Error(parsed.errorMessage ?? "set parameter failed");
    }
    const base = CreatedFeatureSchema.parse(parsed);
    // Optional full-list sidecar (C2) — validated leniently, never fatal.
    let features: FeatureSummary[] | undefined;
    let sketches: SketchSummary[] | undefined;
    try {
      const list = FeatureListSchema.parse(parsed);
      if (Array.isArray(list.features) && list.features.length > 0) {
        features = list.features;
      }
      if (Array.isArray(list.sketches)) sketches = list.sketches;
    } catch {
      // Old core without the list: single-id path still works.
    }
    return { ...base, ...(features ? { features } : {}), ...(sketches ? { sketches } : {}) };
  }

  async saveDocument(path: string): Promise<{
    features: FeatureSummary[];
    sketches: SketchSummary[];
  }> {
    const parsed = await this.invoke(CommandType.SaveDocument, this.documentId, {
      path,
    });
    const checked = FeatureListSchema.parse(parsed);
    if (checked.status !== "ok") {
      throw new Error(
        (parsed as { errorMessage?: string }).errorMessage ?? "save failed",
      );
    }
    return { features: checked.features, sketches: checked.sketches };
  }

  async openDocument(
    path: string,
  ): Promise<{
    features: FeatureSummary[];
    sketches: SketchSummary[];
    revision: number;
  }> {
    const parsed = await this.invoke(CommandType.OpenDocument, this.documentId, {
      path,
    });
    const checked = FeatureListSchema.parse(parsed);
    if (checked.status !== "ok") {
      throw new Error(
        (parsed as { errorMessage?: string }).errorMessage ?? "open failed",
      );
    }
    return {
      features: checked.features,
      sketches: checked.sketches,
      revision: checked.revision,
    };
  }

  async undo(): Promise<{
    features: FeatureSummary[];
    sketches: SketchSummary[];
    revision: number;
  }> {
    const parsed = await this.invoke(CommandType.Undo, this.documentId, {});
    const checked = FeatureListSchema.parse(parsed);
    if (checked.status !== "ok") {
      throw new Error(
        (parsed as { errorMessage?: string }).errorMessage ?? "undo failed",
      );
    }
    return {
      features: checked.features,
      sketches: checked.sketches,
      revision: checked.revision,
    };
  }

  async redo(): Promise<{
    features: FeatureSummary[];
    sketches: SketchSummary[];
    revision: number;
  }> {
    const parsed = await this.invoke(CommandType.Redo, this.documentId, {});
    const checked = FeatureListSchema.parse(parsed);
    if (checked.status !== "ok") {
      throw new Error(
        (parsed as { errorMessage?: string }).errorMessage ?? "redo failed",
      );
    }
    return {
      features: checked.features,
      sketches: checked.sketches,
      revision: checked.revision,
    };
  }

  // ── Sketches (§21) ──────────────────────────────────────────────

  async createSketch(params: {
    planeKind: "XY" | "XZ" | "YZ";
    model: import("@kreoda/protocol").SketchModel;
  }): Promise<{ featureId: string; revision: number }> {
    const featureId = newFeatureId("sk");
    const parsed = await this.invoke(
      CommandType.CreateSketch,
      this.documentId,
      { featureId, planeKind: params.planeKind, model: params.model },
    );
    return {
      featureId: parsed.featureId as string,
      revision: parsed.revision as number,
    };
  }

  async updateSketch(params: {
    featureId: string;
    model: import("@kreoda/protocol").SketchModel;
    isPreview?: boolean;
    dragPointId?: string;
    dragX?: number;
    dragY?: number;
  }): Promise<{
    revision?: number;
    solved?: import("@kreoda/protocol").SketchModel;
    residual?: number;
    dofs?: number;
    conflicting?: string[];
  }> {
    const parsed = await this.invoke(
      CommandType.UpdateSketch,
      this.documentId,
      { ...params },
    );
    const sketch = parsed.sketch as {
      model?: import("@kreoda/protocol").SketchModel;
    } | undefined;
    return {
      revision: parsed.revision as number | undefined,
      solved: sketch?.model,
      residual: parsed.residual as number | undefined,
      dofs: parsed.dofs as number | undefined,
      conflicting: (parsed.conflicting as string[] | undefined) ?? [],
    };
  }

  async requestSketch(
    featureId: string,
  ): Promise<import("@kreoda/protocol").SketchModel & { planeKind: string }> {
    const parsed = await this.invoke(
      CommandType.RequestSketch,
      this.documentId,
      { featureId },
    );
    const sketch = parsed.sketch as {
      planeKind?: string;
      model?: import("@kreoda/protocol").SketchModel;
    };
    if (!sketch?.model) throw new Error("sketch response missing model");
    return { ...(sketch.model as object), planeKind: sketch.planeKind ?? "XY" } as
      import("@kreoda/protocol").SketchModel & { planeKind: string };
  }

  async createExtrude(params: {
    sketchId: string;
    distanceMm: number;
  }): Promise<CreatedFeature> {
    const featureId = newFeatureId("ex");
    const parsed = await this.invoke(
      CommandType.CreateExtrude,
      this.documentId,
      { featureId, ...params },
    );
    return CreatedFeatureSchema.parse(parsed);
  }

  async createRevolve(params: {
    sketchId: string;
    angleDeg: number;
  }): Promise<CreatedFeature> {
    const featureId = newFeatureId("rv");
    const parsed = await this.invoke(
      CommandType.CreateRevolve,
      this.documentId,
      { featureId, ...params },
    );
    return CreatedFeatureSchema.parse(parsed);
  }

  async createBoolean(params: {
    op: "fuse" | "cut" | "common";
    targetId: string;
    toolId: string;
  }): Promise<CreatedFeature> {
    const featureId = newFeatureId(
      params.op === "fuse" ? "un" : params.op === "cut" ? "cu" : "in",
    );
    const parsed = await this.invoke(
      CommandType.CreateBoolean,
      this.documentId,
      { featureId, ...params },
    );
    return CreatedFeatureSchema.parse(parsed);
  }

  async createHole(params: {
    targetId: string;
    faceRole: string;
    xMm: number;
    yMm: number;
    diameterMm: number;
    depthMode: "throughAll" | "blind";
    depthMm: number;
  }): Promise<CreatedFeature> {
    const featureId = newFeatureId("ho");
    const parsed = await this.invoke(
      CommandType.CreateHole,
      this.documentId,
      { featureId, ...params },
    );
    return CreatedFeatureSchema.parse(parsed);
  }

  /**
   * M11: 1–4 holes in exactly one core transaction (one Undo step).
   * Frontend owns the ids (same `ho-uuid` scheme); points are flat
   * [x0,y0,…] with 2 entries per id. Returns the full list for sync.
   */
  async createHolePattern(params: {
    targetId: string;
    faceRole: string;
    points: [number, number][];
    diameterMm: number;
    depthMode: "throughAll" | "blind";
    depthMm: number;
    featureIds?: string[];
  }): Promise<{
    features: FeatureSummary[];
    sketches: SketchSummary[];
    revision: number;
  }> {
    if (params.points.length < 1 || params.points.length > 4) {
      throw new Error("hole pattern needs 1..4 points");
    }
    // M2: frontend owns the ids — a caller mismatch is a bug, never
    // silently papered over with fresh ids (the caller would sync ids it
    // never owned).
    if (params.featureIds !== undefined &&
        params.featureIds.length !== params.points.length) {
      throw new Error("hole pattern featureIds must match points 1:1");
    }
    const featureIds =
      params.featureIds ?? params.points.map(() => newFeatureId("ho"));
    const pointsMm = params.points.flat();
    const parsed = await this.invoke(
      CommandType.CreateHolePattern,
      this.documentId,
      {
        targetId: params.targetId,
        faceRole: params.faceRole,
        featureIds,
        points: pointsMm,
        diameterMm: params.diameterMm,
        depthMode: params.depthMode,
        depthMm: params.depthMm,
      },
    );
    const checked = FeatureListSchema.parse(parsed);
    if (checked.status !== "ok") {
      throw new Error(
        (parsed as { errorMessage?: string }).errorMessage ?? "hole pattern failed",
      );
    }
    return {
      features: checked.features,
      sketches: checked.sketches,
      revision: checked.revision,
    };
  }

  async createFillet(params: {
    targetId: string;
    edgeIds: string[];
    radiusMm: number;
  }): Promise<CreatedFeature> {
    const featureId = newFeatureId("fi");
    const parsed = await this.invoke(
      CommandType.CreateFillet,
      this.documentId,
      { featureId, ...params },
    );
    return CreatedFeatureSchema.parse(parsed);
  }

  async createChamfer(params: {
    targetId: string;
    edgeIds: string[];
    distanceMm: number;
  }): Promise<CreatedFeature> {
    const featureId = newFeatureId("ch");
    const parsed = await this.invoke(
      CommandType.CreateChamfer,
      this.documentId,
      { featureId, ...params },
    );
    return CreatedFeatureSchema.parse(parsed);
  }

  /** Rigid placed copy of a solid (Phase 9d): translation mm + ZYX degrees. */
  async createInstance(params: {
    targetId: string;
    txMm?: number;
    tyMm?: number;
    tzMm?: number;
    rxDeg?: number;
    ryDeg?: number;
    rzDeg?: number;
  }): Promise<CreatedFeature> {
    const featureId = newFeatureId("in");
    const parsed = await this.invoke(
      CommandType.CreateInstance,
      this.documentId,
      { featureId, ...params },
    );
    return CreatedFeatureSchema.parse(parsed);
  }

  /** Face plane frame in world coords (hole positioning, §10). */
  async requestFaceInfo(
    featureId: string,
    faceRole: string,
  ): Promise<{
    originMm: [number, number, number];
    xAxis: [number, number, number];
    yAxis: [number, number, number];
    normal: [number, number, number];
  }> {
    const parsed = await this.invoke(
      CommandType.RequestFaceInfo,
      this.documentId,
      { featureId, faceRole },
    );
    const vec = (v: unknown): [number, number, number] => {
      const a = v as number[];
      return [a[0]!, a[1]!, a[2]!];
    };
    return {
      originMm: vec(parsed.originMm),
      xAxis: vec(parsed.xAxis),
      yAxis: vec(parsed.yAxis),
      normal: vec(parsed.normal),
    };
  }

  private async invoke(
    type: number,
    documentId: string,
    fields: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const raw = await this.roundTrip({
      protocolVersion: PROTOCOL_VERSION,
      requestId: `req-${++this.seq}`,
      documentId,
      type,
      ...fields,
    });
    // Non-mesh responses are JSON by contract; a binary frame here means a
    // protocol mismatch — honest error, never a SyntaxError.
    if (!isJsonResponse(raw)) {
      throw new Error("protocol mismatch: binary frame on a JSON path");
    }
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as Record<
      string,
      unknown
    >;
    if (parsed.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error("protocol version mismatch");
    }
    // Undo depth rides on every state-changing response (§12); the UI
    // enables Undo/Redo from it without an extra round-trip.
    if (
      typeof parsed.undos === "number" &&
      typeof parsed.redos === "number"
    ) {
      useDocumentUiStore
        .getState()
        .setUndoDepth(parsed.undos, parsed.redos);
    }
    if (parsed.status === "error") {
      throw new Error(
        (parsed.errorMessage as string | undefined) ?? "core error",
      );
    }
    return parsed;
  }

  private async roundTrip(envelope: unknown): Promise<Uint8Array> {
    const bytes = new TextEncoder().encode(JSON.stringify(envelope));
    const framed = frameMessage(bytes);
    const resB64 = await window.kreoda.invoke(b64encode(framed));
    return b64decode(resB64);
  }
}

export const coreClient = new CoreClient();
