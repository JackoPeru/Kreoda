// Typed IPC client (§8): framed transport, requestId correlation, version
// check, timeout + cancellation. Never blocks the render thread (§40).

import {
  CommandType,
  CoreMeshData,
  PROTOCOL_VERSION,
  type SketchModel,
  type SketchCurveDisplay,
  type DatumDescriptor,
  type SketchPlaneFrame,
  type SketchProjectionDefinition,
  type SketchProjectionGroupSummary,
  type SketchProjectionResult,
  DatumDescriptorSchema,
  SketchBodySchema,
  SketchPlaneFrameSchema,
  SketchModelSchema,
  SketchProjectionGroupSummarySchema,
  SketchProjectionResultSchema,
  SurfacePointResolveRequestSchema,
  SurfacePointResolveResultSchema,
  type SurfacePointResolveRequest,
  type SurfacePointResolveResult,
  decodeMeshFrame,
  decodeMeshResponse,
  frameMessage,
  isJsonResponse,
  FrameDecoder,
} from "@kreoda/protocol";
import { commandNativeRequest } from "@kreoda/command-schema";
import { z } from "zod";
import { useDocumentUiStore, useSelectionStore, selectionKindOf, surfaceFeatureIds } from "../stores";
import { loadReferences, serializeReferences } from "../reference/store";
import { isSurfaceCommandId, type SurfaceCommandContext, type SurfaceCommandId } from "../commands/surface-commands";

export interface CoreInfo {
  coreVersion: string;
  occtVersion: string;
  protocolVersion: number;
  undos: number;
  redos: number;
}

export interface MassProperties {
  volumeMm3: number;
  areaMm2: number;
  centroidMm: [number, number, number];
  massKg?: number;
}

const InterferenceAnalysisSchema = z.object({
  basis: z.literal("occt-common-volume"),
  componentCount: z.number().int().min(0).max(128),
  candidatePairCount: z.number().int().min(0).max(256),
  volumeToleranceMm3: z.number().finite().nonnegative(),
  skippedNonSolidFeatureIds: z.array(z.string().min(1)),
  interferences: z.array(z.object({
    featureA: z.string().min(1), featureB: z.string().min(1), bodyA: z.string(), bodyB: z.string(),
    volumeMm3: z.number().finite().positive(),
    centroidMm: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    bboxMm: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]),
  })).max(256),
});
export type InterferenceAnalysis = z.infer<typeof InterferenceAnalysisSchema>;

const ThicknessPoint = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const MinimumThicknessSchema = z.object({
  basis: z.literal("occt-sampled-normal-rays"), isGlobalMinimum: z.literal(false), featureId: z.string().min(1),
  requestedSamples: z.number().int().min(32).max(4096), solidCount: z.number().int().min(1).max(128),
  totalFaces: z.number().int().min(1).max(4096), sampledFaces: z.number().int().nonnegative(),
  attemptedSamples: z.number().int().nonnegative(), validSamples: z.number().int().nonnegative(),
  missedSamples: z.number().int().nonnegative(), timeBudgetExceeded: z.boolean(),
  minimumThicknessMm: z.number().finite().positive().nullable(),
  witness: z.object({ pointAMm: ThicknessPoint, pointBMm: ThicknessPoint }).nullable(),
}).refine(value => value.attemptedSamples <= value.requestedSamples && value.validSamples <= value.attemptedSamples &&
  value.missedSamples === value.attemptedSamples - value.validSamples && value.sampledFaces <= value.totalFaces &&
  value.sampledFaces <= value.validSamples && (value.validSamples === 0
    ? value.minimumThicknessMm === null && value.witness === null
    : value.minimumThicknessMm !== null && value.witness !== null && Math.abs(Math.hypot(...value.witness.pointAMm.map(
      (coordinate, axis) => coordinate - value.witness!.pointBMm[axis]!)) - value.minimumThicknessMm) <=
      Math.max(1e-6, value.minimumThicknessMm * 1e-6)), "Inconsistent sampled thickness result");
export type MinimumThicknessAnalysis = z.infer<typeof MinimumThicknessSchema>;

const MassPropertiesSchema = z.object({
  volumeMm3: z.number().finite().nonnegative(),
  areaMm2: z.number().finite().nonnegative(),
  centroidMm: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  massKg: z.number().finite().nonnegative().optional(),
});

export interface CreatedFeature {
  featureId: string;
  type: string;
  paramsMm: number[];
  dependsOn: string[];
  refExtra: string;
  expressions: Record<string, string>;
  volumeMm3?: number;
  bboxMm: [number, number, number, number, number, number];
  revision: number;
}

export interface FeatureSummary {
  featureId: string;
  bodyId?: string;
  bodyVisible?: boolean;
  bodyTip?: boolean;
  type: string;
  paramsMm: number[];
  volumeMm3?: number;
  dependsOn: string[];
  refExtra: string;
  geometryCurrent?: boolean;
  status?: string;
  error?: string;
  blockingSourceIds?: string[];
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
  model?: SketchModel;
  plane?: SketchPlaneFrame;
  supportRef?: string;
  projectionGroups?: SketchProjectionGroupSummary[];
  geometryCurrent?: boolean;
  status?: string;
  error?: string;
  blockingSourceIds?: string[];
}

export interface SketchCommandContext {
  documentId: string;
  revision: number;
  epoch: number;
  connectionGeneration: number;
  sessionId: string;
}

const AssemblyFaceBindingSchema = z.object({
  type: z.literal("face"), featureId: z.string().min(1).max(128),
  persistentFaceId: z.string().min(1).max(512), geometryKind: z.enum(["plane", "cylinder"]),
}).strict();
const AssemblyEdgeBindingSchema = z.object({
  type: z.literal("edge"), featureId: z.string().min(1).max(128),
  persistentEdgeId: z.string().min(1).max(512), geometryKind: z.enum(["circle", "line"]),
}).strict();
const AssemblySourceBindingSchema = z.discriminatedUnion("type", [AssemblyFaceBindingSchema, AssemblyEdgeBindingSchema]);
const DirectFaceReferenceSchema = z.object({
  type: z.literal("face"), featureId: z.string().min(1).max(128),
  persistentFaceId: z.string().min(1).max(512),
}).strict();
const DirectFaceQueryItemSchema = z.object({
  persistentId: z.string().min(1),
  captureRevision: z.number().int().nonnegative().refine(Number.isSafeInteger),
  ambiguous: z.boolean().optional(),
  featureId: z.string().optional(),
  sourceFace: DirectFaceReferenceSchema,
  surfaceType: z.string().min(1),
  centroidMm: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
}).passthrough();
const AssemblyGeometryItemSchema = z.object({
  persistentId: z.string().min(1),
  captureRevision: z.number().int().nonnegative().refine(Number.isSafeInteger),
  ambiguous: z.boolean().optional(),
  featureId: z.unknown().optional(),
  sourceBinding: z.unknown().optional(),
  sourceBindingUnavailableReason: z.unknown().optional(),
}).passthrough();

export type AssemblySourceBinding = z.infer<typeof AssemblySourceBindingSchema>;
export interface AssemblyGeometryCapture {
  persistentId: string;
  captureRevision: number;
  sourceBinding: AssemblySourceBinding;
}
export interface AssemblyMateContext {
  documentId: string;
  revision: number;
  epoch: number;
  connectionGeneration: number;
  meshRevision: number;
  sessionId: string;
}
export interface DirectFaceHistoryContext {
  documentId: string;
  revision: number;
  epoch: number;
  connectionGeneration: number;
  meshRevision: number;
  sessionId: string;
}
export interface DirectFaceReference {
  type: "face";
  featureId: string;
  persistentFaceId: string;
}
export interface DirectFaceCapture {
  sourceFace: DirectFaceReference;
  persistentId: string;
  captureRevision: number;
  surfaceType: string;
  centroidMm: [number, number, number];
  context: DirectFaceHistoryContext;
}
export type DirectFaceHistoryCommandId =
  | "CreateMoveFace" | "CreateOffsetFace" | "CreateDeleteFace" | "CreateReplaceFace";
export type AssemblyConstraintRequest =
  | { constraintId: string; kind: "ground"; movingId: string }
  | { constraintId: string; kind: "coincident"; movingId: string; fixedId: string }
  | { constraintId: string; kind: "distance"; movingId: string; fixedId: string; axis: 0 | 1 | 2; distanceMm: number }
  | { constraintId: string; kind: "parallel" | "perpendicular" | "concentric"; movingId: string; fixedId: string;
      captureRevision: number; movingPickId: string; fixedPickId: string;
      movingSourceBinding: AssemblySourceBinding; fixedSourceBinding: AssemblySourceBinding }
  | { constraintId: string; kind: "angle"; movingId: string; fixedId: string;
      captureRevision: number; movingPickId: string; fixedPickId: string; angleDeg: number;
      movingSourceBinding: AssemblySourceBinding; fixedSourceBinding: AssemblySourceBinding };

export interface SketchProjectionMutation {
  featureId: string;
  planeKind: string;
  revision: number;
  model: SketchModel;
  plane?: SketchPlaneFrame;
  supportRef?: string;
  projectionGroups: SketchProjectionGroupSummary[];
  geometryCurrent?: boolean;
  status?: string;
  error?: string;
  blockingSourceIds?: string[];
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
  volumeMm3: z.number().finite().nonnegative().optional(),
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
  datums: z.array(DatumDescriptorSchema).default([]),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: z.string(),
  status: z.string(),
  path: z.string().optional(),
  referencePlanesJson: z.string().default("[]"),
  features: z
    .array(
      z.object({
        featureId: z.string(),
        bodyId: z.string().optional(),
        bodyVisible: z.boolean().optional(),
        bodyTip: z.boolean().optional(),
        type: z.string(),
        paramsMm: z.array(z.number()),
        volumeMm3: z.number().optional(),
        dependsOn: z.array(z.string()).default([]),
        refExtra: z.string().default(""),
        expressions: z.record(z.string(), z.string()).default({}),
        geometryCurrent: z.boolean().optional(),
        status: z.string().optional(),
        error: z.string().optional(),
        blockingSourceIds: z.array(z.string()).optional(),
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
        plane: SketchPlaneFrameSchema.optional(),
        supportRef: z.string().optional(),
        projectionGroups: z.array(SketchProjectionGroupSummarySchema).default([]),
        geometryCurrent: z.boolean().optional(),
        status: z.string().optional(),
        error: z.string().optional(),
        blockingSourceIds: z.array(z.string()).optional(),
      }),
    )
    .default([]),
  revision: z.number().int().nonnegative().default(0),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});

const SketchProjectionQuerySchema = z.object({
  documentId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  projection: SketchProjectionResultSchema,
});

function newFeatureId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export class CoreClient {
  private seq = 0;
  decoder = new FrameDecoder();
  documentId = "doc-phase1";

  async captureSketchContext(): Promise<SketchCommandContext> {
    const before = useDocumentUiStore.getState();
    if (!before.coreRunning || !before.documentId || this.documentId !== before.documentId)
      throw new Error("sketch document is not ready");
    const snapshot = await window.kreoda.sessionSnapshot() as { sessionId?: unknown; documentId?: unknown; revision?: unknown };
    const current = useDocumentUiStore.getState();
    if (!current.coreRunning || current.documentId !== before.documentId || current.epoch !== before.epoch ||
        current.connectionGeneration !== before.connectionGeneration || current.revision !== before.revision ||
        snapshot.documentId !== before.documentId || snapshot.revision !== before.revision ||
        typeof snapshot.sessionId !== "string" || !z.string().uuid().safeParse(snapshot.sessionId).success)
      throw new Error("stale sketch context; refresh the document snapshot");
    return {
      documentId: before.documentId,
      revision: before.revision,
      epoch: before.epoch,
      connectionGeneration: before.connectionGeneration,
      sessionId: snapshot.sessionId,
    };
  }

  async captureAssemblyMateContext(): Promise<AssemblyMateContext> {
    const before = useDocumentUiStore.getState();
    if (!before.coreRunning || !before.documentId || this.documentId !== before.documentId ||
        !Number.isSafeInteger(before.revision) || before.revision < 0)
      throw new Error("Documento assemblaggio non pronto");
    const snapshot = await window.kreoda.sessionSnapshot() as { sessionId?: unknown; documentId?: unknown; revision?: unknown };
    const current = useDocumentUiStore.getState();
    if (!current.coreRunning || current.documentId !== before.documentId || current.epoch !== before.epoch ||
        current.connectionGeneration !== before.connectionGeneration || current.revision !== before.revision ||
        current.meshRevision !== before.meshRevision || this.documentId !== before.documentId ||
        snapshot.documentId !== before.documentId || snapshot.revision !== before.revision ||
        typeof snapshot.sessionId !== "string" || !z.string().uuid().safeParse(snapshot.sessionId).success)
      throw new Error("Contesto assemblaggio scaduto; aggiorna la selezione");
    return { documentId: before.documentId, revision: before.revision, epoch: before.epoch,
      connectionGeneration: before.connectionGeneration, meshRevision: before.meshRevision,
      sessionId: snapshot.sessionId };
  }

  async captureAssemblyGeometrySelection(instanceId: string, pickId: string,
    context: AssemblyMateContext): Promise<AssemblyGeometryCapture> {
    const selectionKind = selectionKindOf(pickId);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(instanceId) ||
        !pickId.startsWith(`${instanceId}:`) || (selectionKind !== "face" && selectionKind !== "edge") ||
        !this.assemblyContextIsCurrent(context, [context.revision], true) ||
        !this.assemblySelectionIsCurrent(pickId))
      throw new Error("Seleziona una faccia o un bordo corrente dell'istanza scelta");
    const method = selectionKind === "edge" ? "findEdges" : "findFaces";
    let captured: AssemblyGeometryCapture | undefined;
    const isCurrent = () => this.assemblyContextIsCurrent(context, [context.revision], true) &&
      this.assemblySelectionIsCurrent(pickId);
    await this.invoke(CommandType.RequestSessionQuery, context.documentId,
      { method, params: { featureId: instanceId } }, isCurrent,
      { expectedRevision: context.revision, expectedSessionId: context.sessionId },
      async response => {
        if (response.status === "error") return;
        if (response.documentId !== context.documentId || response.revision !== context.revision ||
            response.sessionId !== context.sessionId)
          throw new Error("Risposta geometria assemblaggio fuori revision o sessione");
        const result = z.object({
          faces: z.array(AssemblyGeometryItemSchema).optional(),
          edges: z.array(AssemblyGeometryItemSchema).optional(),
        }).strict().parse(response.result);
        const candidates = method === "findEdges" ? result.edges : result.faces;
        const matches = candidates?.filter(item => item.persistentId === pickId) ?? [];
        if (matches.length !== 1 || matches[0]!.ambiguous || !matches[0]!.sourceBinding)
          throw new Error("La selezione non ha un binding nativo univoco");
        const item = matches[0]!;
        if (item.featureId !== undefined && item.featureId !== instanceId)
          throw new Error("La selezione geometrica appartiene a un’altra istanza");
        const sourceBinding = AssemblySourceBindingSchema.parse(item.sourceBinding);
        if (item.captureRevision !== context.revision || sourceBinding.type !== selectionKind)
          throw new Error("La selezione geometrica non coincide con il contesto corrente");
        const instance = useDocumentUiStore.getState().features.find(feature =>
          feature.featureId === instanceId && feature.type === "Instance");
        if (!instance || !instance.dependsOn.includes(sourceBinding.featureId) ||
            !useDocumentUiStore.getState().features.some(feature => feature.featureId === sourceBinding.featureId))
          throw new Error("Il riferimento nativo non appartiene alla sorgente dell’istanza");
        captured = { persistentId: item.persistentId, captureRevision: item.captureRevision, sourceBinding };
        const live = await window.kreoda.sessionSnapshot() as { sessionId?: unknown; documentId?: unknown; revision?: unknown };
        if (live.sessionId !== context.sessionId || live.documentId !== context.documentId || live.revision !== context.revision)
          throw new Error("La sessione o la revisione è cambiata durante la cattura");
      },
      isCurrent,
    );
    if (!captured || !isCurrent()) throw new Error("Cattura geometria scaduta");
    return captured;
  }

  async captureDirectFaceContext(): Promise<DirectFaceHistoryContext> {
    const before = useDocumentUiStore.getState();
    if (!before.coreRunning || !before.documentId || this.documentId !== before.documentId ||
        !Number.isSafeInteger(before.revision) || before.revision < 0 ||
        !Number.isSafeInteger(before.meshRevision) || before.meshRevision < 0)
      throw new Error("Documento faccia diretta non pronto");
    const snapshot = await window.kreoda.sessionSnapshot() as { sessionId?: unknown; documentId?: unknown; revision?: unknown };
    const current = useDocumentUiStore.getState();
    if (!current.coreRunning || current.documentId !== before.documentId || current.epoch !== before.epoch ||
        current.connectionGeneration !== before.connectionGeneration || current.revision !== before.revision ||
        current.meshRevision !== before.meshRevision || this.documentId !== before.documentId ||
        snapshot.documentId !== before.documentId || snapshot.revision !== before.revision ||
        typeof snapshot.sessionId !== "string" || !z.string().uuid().safeParse(snapshot.sessionId).success)
      throw new Error("Contesto faccia diretta scaduto; aggiorna la selezione");
    return { documentId: before.documentId, revision: before.revision, epoch: before.epoch,
      connectionGeneration: before.connectionGeneration, meshRevision: before.meshRevision,
      sessionId: snapshot.sessionId };
  }

  async captureDirectFaceSelection(
    pickId: string,
    context: DirectFaceHistoryContext,
    role: "source" | "support",
  ): Promise<DirectFaceCapture> {
    const separator = pickId.indexOf(":");
    const featureId = separator > 0 ? pickId.slice(0, separator) : "";
    if ((role !== "source" && role !== "support") ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(featureId) || selectionKindOf(pickId) !== "face" ||
        !this.directFaceContextIsCurrent(context, false, true) || !this.directFaceSelectionIsCurrent(pickId))
      throw new Error("Seleziona una faccia solida corrente");
    const state = useDocumentUiStore.getState();
    const feature = state.features.find(item => item.featureId === featureId);
    const healthy = !!feature && feature.geometryCurrent !== false &&
      (feature.status === undefined || feature.status === "ok") &&
      !surfaceFeatureIds(state.features).has(featureId);
    const visibleSupport = feature?.type === "Instance"
      ? !!state.meshes[featureId]
      : feature?.bodyVisible === true;
    if (!healthy || (role === "source"
        ? feature!.type === "Instance" || feature!.bodyTip !== true || !feature!.bodyId
        : !visibleSupport || (feature!.type !== "Instance" && feature!.bodyTip !== true)))
      throw new Error(role === "source"
        ? "La faccia sorgente deve appartenere alla punta corrente di un solido"
        : "La faccia di sostituzione deve appartenere a un solido visibile corrente");

    let captured: DirectFaceCapture | undefined;
    const isCurrent = () => this.directFaceContextIsCurrent(context, false, true) &&
      this.directFaceSelectionIsCurrent(pickId);
    await this.invoke(CommandType.RequestSessionQuery, context.documentId,
      { method: "findFaces", params: { featureId } }, isCurrent,
      { expectedRevision: context.revision, expectedSessionId: context.sessionId },
      async response => {
        if (response.status === "error") return;
        if (response.documentId !== context.documentId || response.revision !== context.revision ||
            response.sessionId !== context.sessionId)
          throw new Error("Risposta faccia diretta fuori revisione o sessione");
        const result = z.object({ faces: z.array(DirectFaceQueryItemSchema).optional() }).passthrough()
          .parse(response.result);
        const matches = result.faces?.filter(item => item.persistentId === pickId) ?? [];
        if (matches.length !== 1 || matches[0]!.ambiguous === true ||
            matches[0]!.captureRevision !== context.revision ||
            (matches[0]!.featureId !== undefined && matches[0]!.featureId !== featureId) ||
            matches[0]!.sourceFace.featureId !== featureId)
          throw new Error("La faccia selezionata non ha un binding diretto univoco e corrente");
        const item = matches[0]!;
        captured = { sourceFace: item.sourceFace, persistentId: item.persistentId,
          captureRevision: item.captureRevision, surfaceType: item.surfaceType,
          centroidMm: item.centroidMm, context };
        const live = await window.kreoda.sessionSnapshot() as { sessionId?: unknown; documentId?: unknown; revision?: unknown };
        if (live.sessionId !== context.sessionId || live.documentId !== context.documentId ||
            live.revision !== context.revision || !isCurrent())
          throw new Error("La sessione, revisione o selezione è cambiata durante la cattura");
      }, isCurrent);
    if (!captured || !isCurrent()) throw new Error("Cattura faccia diretta scaduta");
    return captured;
  }

  async createDirectFaceHistory(
    id: DirectFaceHistoryCommandId,
    parameters: Record<string, unknown>,
    context: DirectFaceHistoryContext,
  ): Promise<CreatedFeature> {
    if (!this.directFaceContextIsCurrent(context, false, false))
      throw new Error("Contesto faccia diretta scaduto");
    const nextRevision = context.revision + 1;
    if (!Number.isSafeInteger(nextRevision)) throw new Error("Revisione faccia diretta non incrementabile");
    const command = commandNativeRequest(id, parameters, newFeatureId("face"));
    const isCurrent = () => this.directFaceContextIsCurrent(context, true, false);
    const parsed = await this.invoke(command.type, context.documentId, command.fields, isCurrent,
      { expectedRevision: context.revision, expectedSessionId: context.sessionId },
      async response => {
        if (response.status === "error") return;
        if (response.documentId !== context.documentId || response.sessionId !== context.sessionId ||
            response.revision !== nextRevision)
          throw new Error("Risposta faccia diretta senza avanzamento atomico atteso");
        const live = await window.kreoda.sessionSnapshot() as { sessionId?: unknown; documentId?: unknown; revision?: unknown };
        if (live.sessionId !== context.sessionId || live.documentId !== context.documentId ||
            typeof live.revision !== "number" || !Number.isSafeInteger(live.revision) || live.revision < nextRevision)
          throw new Error("Esito faccia diretta non confermato dalla sessione");
      }, isCurrent);
    const created = CreatedFeatureSchema.parse(parsed);
    if (created.revision !== nextRevision) throw new Error("Revisione risultato faccia diretta non valida");
    return created;
  }

  async requestDirectFaceHistorySnapshot(
    context: DirectFaceHistoryContext,
    minimumRevision: number,
  ): Promise<{ features: FeatureSummary[]; sketches: SketchSummary[]; datums: DatumDescriptor[]; revision: number }> {
    if (!Number.isSafeInteger(minimumRevision) || minimumRevision < context.revision ||
        !this.directFaceContextIsCurrent(context, true, false))
      throw new Error("Contesto aggiornamento faccia diretta scaduto");
    let checked: z.infer<typeof FeatureListSchema> | undefined;
    await this.invoke(CommandType.RequestSnapshot, context.documentId, {},
      () => this.directFaceContextIsCurrent(context, true, false),
      { expectedSessionId: context.sessionId }, async response => {
        if (response.status === "error") return;
        let snapshot = FeatureListSchema.parse(response);
        if (response.documentId !== context.documentId || response.sessionId !== context.sessionId ||
            !Number.isSafeInteger(snapshot.revision) || snapshot.revision < minimumRevision)
          throw new Error("Snapshot faccia diretta vecchio o fuori sessione");
        const live = await window.kreoda.sessionSnapshot() as { sessionId?: unknown; documentId?: unknown; revision?: unknown };
        if (live.sessionId !== context.sessionId || live.documentId !== context.documentId ||
            typeof live.revision !== "number" || !Number.isSafeInteger(live.revision) ||
            live.revision < snapshot.revision || live.revision < minimumRevision)
          throw new Error("Snapshot faccia diretta non confermato dalla sessione");
        if (useDocumentUiStore.getState().revision > snapshot.revision) {
          const full = await window.kreoda.sessionSnapshot() as {
            sessionId?: unknown; documentId?: unknown; revision?: unknown;
            features?: unknown; sketches?: unknown; datums?: unknown;
          };
          const floor = useDocumentUiStore.getState().revision;
          if (full.sessionId !== context.sessionId || full.documentId !== context.documentId ||
              typeof full.revision !== "number" || !Number.isSafeInteger(full.revision) || full.revision < floor ||
              full.revision < minimumRevision || !Array.isArray(full.features) || !Array.isArray(full.sketches))
            throw new Error("Snapshot completo faccia diretta non raggiunge la revisione visualizzata");
          const parsedFull = FeatureListSchema.parse({ protocolVersion: PROTOCOL_VERSION,
            requestId: "direct-face-history-snapshot", status: "ok", features: full.features,
            sketches: full.sketches, datums: Array.isArray(full.datums) ? full.datums : [], revision: full.revision });
          const fullSketches = (full.sketches as SketchSummary[])
            .map(sketch => ({ ...sketch, type: "Sketch" }));
          snapshot = { ...parsedFull, sketches: fullSketches as typeof parsedFull.sketches };
        }
        checked = snapshot;
      }, () => this.directFaceContextIsCurrent(context, true, false) &&
        !!checked && useDocumentUiStore.getState().revision <= checked.revision);
    if (!checked || useDocumentUiStore.getState().revision > checked.revision)
      throw new Error("Snapshot faccia diretta non disponibile o arretrato");
    return { features: checked.features, sketches: checked.sketches, datums: checked.datums, revision: checked.revision };
  }

  private directFaceContextIsCurrent(
    context: DirectFaceHistoryContext,
    allowRevisionAdvance: boolean,
    requireMesh: boolean,
  ): boolean {
    const current = useDocumentUiStore.getState();
    return current.coreRunning && this.documentId === context.documentId &&
      current.documentId === context.documentId && current.epoch === context.epoch &&
      current.connectionGeneration === context.connectionGeneration &&
      (allowRevisionAdvance ? current.revision >= context.revision : current.revision === context.revision) &&
      (!requireMesh || current.meshRevision === context.meshRevision);
  }

  private directFaceSelectionIsCurrent(pickId: string): boolean {
    const selected = useSelectionStore.getState().selectedIds;
    return selected.length === 1 && selected[0] === pickId;
  }

  private assemblyContextIsCurrent(context: AssemblyMateContext, allowedRevisions: readonly number[], requireMesh: boolean): boolean {
    const current = useDocumentUiStore.getState();
    return current.coreRunning && this.documentId === context.documentId &&
      current.documentId === context.documentId && current.epoch === context.epoch &&
      current.connectionGeneration === context.connectionGeneration && allowedRevisions.includes(current.revision) &&
      (!requireMesh || current.meshRevision === context.meshRevision);
  }

  private assemblySelectionIsCurrent(pickId: string): boolean {
    const selected = useSelectionStore.getState().selectedIds;
    return selected.length === 1 && selected[0] === pickId;
  }

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

  async measureMassProperties(scope: { featureId?: string; bodyId?: string; densityKgPerM3?: number }): Promise<MassProperties> {
    if (!!scope.featureId === !!scope.bodyId) throw new Error("Specify exactly one featureId or bodyId");
    if (scope.densityKgPerM3 !== undefined && (!Number.isFinite(scope.densityKgPerM3) || scope.densityKgPerM3 < 0))
      throw new Error("Density must be a nonnegative finite number");
    const reply = await this.invoke(CommandType.RequestSessionQuery, this.documentId,
      { method: "measureMassProperties", params: scope });
    return MassPropertiesSchema.parse(reply.result);
  }

  async validateCadGeometry(scope: { featureId?: string; bodyId?: string } = {}): Promise<{
    valid: boolean; checks: { code: string; detail: string; ok: boolean }[];
  }> {
    if (scope.featureId && scope.bodyId) throw Error("Select either a body or a feature");
    const method = scope.bodyId ? "validateBody" : scope.featureId ? "validateFeature" : "validateDocument";
    const reply = await this.invoke(CommandType.RequestSessionQuery, this.documentId, { method, params: scope });
    return z.object({ valid: z.boolean(), checks: z.array(z.object({ code: z.string(), detail: z.string(), ok: z.boolean() })) }).parse(reply.result);
  }

  async measureMinimumThickness(params: { featureId?: string; bodyId?: string; maxSamples?: number }): Promise<MinimumThicknessAnalysis> {
    const input = z.object({ featureId: z.string().regex(/^[A-Za-z0-9_-]+$/).max(128).optional(),
      bodyId: z.string().regex(/^[A-Za-z0-9_-]+$/).max(128).optional(),
      maxSamples: z.number().int().min(32).max(4096).optional(),
    }).refine(value => !!value.featureId !== !!value.bodyId, "Select exactly one feature or body").parse(params);
    const reply = await this.invoke(CommandType.RequestSessionQuery, this.documentId,
      { method: "measureMinimumThickness", params: input });
    const measured = MinimumThicknessSchema.parse(reply.result);
    if (input.featureId && measured.featureId !== input.featureId) throw Error("Thickness response target mismatch");
    return measured;
  }

  async measureInterferences(params: { featureIds?: string[]; includeHidden?: boolean; volumeToleranceMm3?: number } = {}): Promise<InterferenceAnalysis> {
    const input = z.object({
      featureIds: z.array(z.string().regex(/^[A-Za-z0-9_-]+$/).max(128)).min(2).max(128)
        .refine(ids => new Set(ids).size === ids.length, "Duplicate components").optional(),
      includeHidden: z.boolean().optional(),
      volumeToleranceMm3: z.number().finite().nonnegative().optional(),
    }).refine(value => value.featureIds === undefined || value.includeHidden === undefined,
      "includeHidden is only available for document scope").parse(params);
    const reply = await this.invoke(CommandType.RequestSessionQuery, this.documentId,
      { method: "measureInterferences", params: input });
    return InterferenceAnalysisSchema.parse(reply.result);
  }

  async measureDraftAngles(params: { featureId?: string; bodyId?: string; pullDirection: [number, number, number]; neutralToleranceDeg?: number }): Promise<{
    basis?: unknown;
    faces: { referenceId: string; featureId: string; draftAngleDeg: number; classification: string; normal: [number, number, number] }[];
  }> {
    if (params.featureId && params.bodyId) throw Error("Specify only one analysis scope");
    const v = params.pullDirection;
    if (v.length !== 3 || !v.every(Number.isFinite) || Math.hypot(...v) < 1e-12) throw Error("Pull direction must be a nonzero finite 3D vector");
    if (params.neutralToleranceDeg !== undefined && (!Number.isFinite(params.neutralToleranceDeg) || params.neutralToleranceDeg < 0 || params.neutralToleranceDeg > 90))
      throw Error("Invalid neutral draft tolerance");
    const reply = await this.invoke(CommandType.RequestSessionQuery, this.documentId, { method: "measureDraftAngles", params });
    return z.object({ basis: z.unknown(), faces: z.array(z.object({
      referenceId: z.string().min(1), featureId: z.string().min(1), draftAngleDeg: z.number().finite(),
      classification: z.string().min(1), normal: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    })) }).parse(reply.result);
  }

  async createDocument(documentId: string): Promise<void> {
    await this.invoke(CommandType.CreateDocument, documentId, {});
    this.documentId = documentId;
    await loadReferences("[]");
  }

  async readReferences(documentId: string): Promise<string> {
    const parsed = await this.invoke(CommandType.RequestSnapshot, documentId,
      { includeReferencePlanes: true });
    if (parsed.documentId !== documentId) throw new Error("document changed while loading reference images");
    return FeatureListSchema.parse(parsed).referencePlanesJson;
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
  ): Promise<(CreatedFeature & { features?: FeatureSummary[]; sketches?: SketchSummary[]; datums?: DatumDescriptor[] }) | CoreMeshData> {
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
    let datums: DatumDescriptor[] | undefined;
    try {
      const list = FeatureListSchema.parse(parsed);
      if (Array.isArray(list.features) && list.features.length > 0) {
        features = list.features;
      }
      if (Array.isArray(list.sketches)) sketches = list.sketches;
      if (Array.isArray(parsed.datums)) datums = list.datums;
    } catch {
      // Old core without the list: single-id path still works.
    }
    return { ...base, ...(features ? { features } : {}), ...(sketches ? { sketches } : {}), ...(datums ? { datums } : {}) };
  }

  cancelPreview(featureId: string): Promise<void> {
    return window.kreoda.sessionCancelEdit(featureId);
  }

  async saveDocument(path: string): Promise<{
    features: FeatureSummary[];
    sketches: SketchSummary[];
    datums: DatumDescriptor[];
  }> {
    const parsed = await this.invoke(CommandType.SaveDocument, this.documentId, {
      path,
      ...(/\.icad$/i.test(path) ? { referencePlanesJson: serializeReferences() } : {}),
    });
    const checked = FeatureListSchema.parse(parsed);
    if (checked.status !== "ok") {
      throw new Error(
        (parsed as { errorMessage?: string }).errorMessage ?? "save failed",
      );
    }
    return { features: checked.features, sketches: checked.sketches, datums: checked.datums };
  }

  async openDocument(
    path: string,
  ): Promise<{
    features: FeatureSummary[];
    sketches: SketchSummary[];
    datums: DatumDescriptor[];
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
    await loadReferences(checked.referencePlanesJson);
    return {
      features: checked.features,
      sketches: checked.sketches, datums: checked.datums,
      revision: checked.revision,
    };
  }

  async undo(): Promise<{
    features: FeatureSummary[];
    sketches: SketchSummary[];
    datums: DatumDescriptor[];
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
      sketches: checked.sketches, datums: checked.datums,
      revision: checked.revision,
    };
  }

  async redo(): Promise<{
    features: FeatureSummary[];
    sketches: SketchSummary[];
    datums: DatumDescriptor[];
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
      sketches: checked.sketches, datums: checked.datums,
      revision: checked.revision,
    };
  }

  async deleteFeature(featureId: string): Promise<{ features: FeatureSummary[]; sketches: SketchSummary[]; datums: DatumDescriptor[]; revision: number }> {
    const parsed = await this.invoke(CommandType.DeleteFeature, this.documentId, { featureId });
    const checked = FeatureListSchema.parse(parsed);
    return { features: checked.features, sketches: checked.sketches, datums: checked.datums, revision: checked.revision };
  }

  async requestSnapshot(surfaceContext?: SurfaceCommandContext): Promise<{ features: FeatureSummary[]; sketches: SketchSummary[]; datums: DatumDescriptor[]; revision: number }> {
    if (surfaceContext && !this.surfaceContextIsCurrent(surfaceContext, false)) {
      throw new Error("stale surface snapshot context");
    }
    const parsed = await this.invoke(
      CommandType.RequestSnapshot,
      surfaceContext?.documentId ?? this.documentId,
      {},
      surfaceContext ? () => this.surfaceContextIsCurrent(surfaceContext, false) : undefined,
    );
    const checked = FeatureListSchema.parse(parsed);
    return { features: checked.features, sketches: checked.sketches, datums: checked.datums, revision: checked.revision };
  }

  async setBodyVisibility(bodyId: string, visible: boolean): Promise<void> {
    if (!bodyId || typeof visible !== "boolean") throw Error("Invalid body visibility");
    await this.invoke(CommandType.SetBodyVisibility, this.documentId, { bodyId, visible });
  }

  async queryConfigurations(): Promise<{ active: string; named: Record<string, Record<string, Record<string, number>>>; revision: number }> {
    const raw = await this.invoke(CommandType.QueryConfigurations, this.documentId, {});
    return z.object({ active: z.string(), named: z.record(z.record(z.record(z.number().finite()))), revision: z.number().int().nonnegative() }).parse(raw);
  }

  async configurationCommand(type: typeof CommandType.DefineConfiguration | typeof CommandType.ActivateConfiguration,
    fields: { name: string; overrides?: Record<string, Record<string, number>> }): Promise<void> {
    await this.invoke(type, this.documentId, fields);
  }

  async createOutwardFacePush(sourceFeatureId: string, faceRole: string, distanceMm: number): Promise<CreatedFeature> {
    if (!sourceFeatureId || !faceRole || !Number.isFinite(distanceMm) || distanceMm <= 0)
      throw new Error("A persistent face and positive distance are required");
    const parsed = await this.invoke(CommandType.CreateOutwardFacePush, this.documentId,
      { featureId: newFeatureId("push"), sourceFeatureId, faceRole, distanceMm });
    return CreatedFeatureSchema.parse(parsed);
  }

  async createInwardFacePocket(sourceFeatureId: string, faceRole: string, distanceMm: number): Promise<CreatedFeature> {
    if (!sourceFeatureId || !faceRole || !Number.isFinite(distanceMm) || distanceMm <= 0)
      throw new Error("A persistent face and positive pocket depth are required");
    const parsed = await this.invoke(CommandType.CreateInwardFacePocket, this.documentId,
      { featureId: newFeatureId("pocket"), sourceFeatureId, faceRole, distanceMm });
    return CreatedFeatureSchema.parse(parsed);
  }
  async createSurfaceFaceThicken(sourceFeatureId: string, faceRole: string, thicknessMm: number): Promise<CreatedFeature> {
    if (!sourceFeatureId || !faceRole || !Number.isFinite(thicknessMm) || thicknessMm <= 0)
      throw new Error("A persistent planar face and positive thickness are required");
    const parsed = await this.invoke(CommandType.CreateSurfaceFaceThicken, this.documentId,
      { featureId: newFeatureId("thicken"), sourceFeatureId, faceRole, thicknessMm });
    return CreatedFeatureSchema.parse(parsed);
  }

  async defineAssemblyConstraint(params: AssemblyConstraintRequest, context?: AssemblyMateContext): Promise<{ revision: number }> {
    const command = commandNativeRequest("DefineAssemblyConstraint", params as unknown as Record<string, unknown>);
    if (!context) {
      const response = await this.invoke(command.type, this.documentId, command.fields);
      if (typeof response.revision !== "number" || !Number.isSafeInteger(response.revision))
        throw new Error("Risposta accoppiamento senza revisione valida");
      return { revision: response.revision };
    }
    if (!this.assemblyContextIsCurrent(context, [context.revision], false))
      throw new Error("Contesto assemblaggio scaduto; aggiorna il documento");
    const nextRevision = context.revision + 1;
    if (!Number.isSafeInteger(nextRevision)) throw new Error("Revisione assemblaggio non incrementabile");
    let responseRevision: number | undefined;
    const current = () => this.assemblyContextIsCurrent(context, [context.revision, nextRevision], false);
    await this.invoke(command.type, context.documentId, command.fields, current,
      { expectedRevision: context.revision, expectedSessionId: context.sessionId },
      async response => {
        if (response.status === "error") return;
        const revision = response.revision;
        if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision !== nextRevision)
          throw new Error("Risposta accoppiamento fuori revisione");
        responseRevision = revision;
        const live = await window.kreoda.sessionSnapshot() as { sessionId?: unknown; documentId?: unknown; revision?: unknown };
        if (live.sessionId !== context.sessionId || live.documentId !== context.documentId || live.revision !== revision)
          throw new Error("La sessione o la revisione è cambiata durante il comando");
      }, current);
    if (responseRevision === undefined || !current()) throw new Error("Risposta accoppiamento scaduta");
    return { revision: responseRevision };
  }

  // ── Sketches (§21) ──────────────────────────────────────────────

  async createSketch(params: {
    planeKind: "XY" | "XZ" | "YZ";
    model: import("@kreoda/protocol").SketchModel;
    supportRef?: string;
  }): Promise<{ featureId: string; revision: number }> {
    const featureId = newFeatureId("sk");
    const parsed = await this.invoke(
      CommandType.CreateSketch,
      this.documentId,
      { featureId, planeKind: params.planeKind, model: params.model, ...(params.supportRef ? { supportRef: params.supportRef } : {}) },
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
  }, context?: SketchCommandContext): Promise<{
    revision?: number;
    solved?: import("@kreoda/protocol").SketchModel;
    curveDisplay?: SketchCurveDisplay;
    context?: SketchCommandContext;
    residual?: number;
    dofs?: number;
    conflicting?: string[];
  }> {
    let responseContext: SketchCommandContext | undefined;
    if (context) await this.validateSketchLineage(context, context.revision);
    const parsed = await this.invoke(
      CommandType.UpdateSketch,
      context?.documentId ?? this.documentId,
      { ...params },
      context ? () => this.sketchContextIsCurrent(context, false) : undefined,
      context ? { expectedRevision: context.revision, expectedSessionId: context.sessionId } : undefined,
      context ? async response => {
        if (response.status === "error") {
          await this.validateSketchLineage(context, context.revision);
          return;
        }
        const body = SketchBodySchema.parse(response);
        const expectedResponseRevision = params.isPreview ? context.revision : body.revision;
        responseContext = await this.validateSketchResponse(
          context,
          response,
          expectedResponseRevision,
          !params.isPreview,
        );
      } : undefined,
      context ? () => this.sketchContextMatchesRevisions(context,
        responseContext ? [context.revision, responseContext.revision] : [context.revision]) : undefined,
    );
    const body = SketchBodySchema.parse(parsed);
    return {
      revision: body.revision,
      solved: body.sketch.model,
      curveDisplay: body.curveDisplay,
      context: responseContext,
      residual: parsed.residual as number | undefined,
      dofs: parsed.dofs as number | undefined,
      conflicting: (parsed.conflicting as string[] | undefined) ?? [],
    };
  }

  async requestSketch(
    featureId: string,
    context?: SketchCommandContext,
  ): Promise<SketchModel & { planeKind: string; plane?: SketchPlaneFrame; supportRef?: string; revision: number; projectionGroups: SketchProjectionGroupSummary[]; curveDisplay?: SketchCurveDisplay; geometryCurrent?: boolean; status?: string; error?: string; blockingSourceIds?: string[] }> {
    if (context) await this.validateSketchLineage(context, context.revision);
    let responseContext: SketchCommandContext | undefined;
    const parsed = await this.invoke(
      CommandType.RequestSketch,
      context?.documentId ?? this.documentId,
      { featureId },
      context ? () => this.sketchContextIsCurrent(context, false) : undefined,
      context ? { expectedRevision: context.revision, expectedSessionId: context.sessionId } : undefined,
      context ? async response => {
        if (response.status === "error") {
          await this.validateSketchLineage(context, context.revision);
          return;
        }
        responseContext = await this.validateSketchResponse(context, response, context.revision);
      } : undefined,
      context ? () => this.sketchContextMatchesRevisions(context,
        responseContext ? [context.revision, responseContext.revision] : [context.revision]) : undefined,
    );
    const body = SketchBodySchema.parse(parsed);
    if(body.planeKind === "Datum" && (!body.sketch.plane || !body.sketch.supportRef))throw new Error("datum sketch response missing native support frame");
    return {
      ...body.sketch.model,
      planeKind: body.planeKind,
      plane: body.sketch.plane,
      supportRef: body.sketch.supportRef,
      revision: body.revision,
      projectionGroups: body.sketch.projectionGroups,
      curveDisplay: body.curveDisplay,
      geometryCurrent: body.geometryCurrent,
      status: body.geometryStatus,
      error: body.error,
      blockingSourceIds: body.blockingSourceIds,
    };
  }

  async requestSketchProjection(featureId: string, groupId?: string): Promise<{
    documentId: string; revision: number; projection: SketchProjectionResult;
  }> {
    const command = commandNativeRequest("RequestSketchProjection", {
      featureId, ...(groupId !== undefined ? { groupId } : {}),
    });
    const parsed = await this.invoke(command.type, this.documentId, command.fields);
    const result = SketchProjectionQuerySchema.parse(parsed);
    if (result.projection.featureId !== featureId) throw new Error("projection response target mismatch");
    return result;
  }

  async setSketchProjection(featureId: string, groupId: string, definition: SketchProjectionDefinition): Promise<SketchProjectionMutation> {
    const command = commandNativeRequest("SetSketchProjection", { featureId, groupId, definition });
    return this.parseSketchProjectionMutation(await this.invoke(command.type, this.documentId, command.fields));
  }

  async removeSketchProjection(featureId: string, groupId: string): Promise<SketchProjectionMutation> {
    const command = commandNativeRequest("RemoveSketchProjection", { featureId, groupId });
    return this.parseSketchProjectionMutation(await this.invoke(command.type, this.documentId, command.fields));
  }

  private parseSketchProjectionMutation(parsed: Record<string, unknown>): SketchProjectionMutation {
    const body = SketchBodySchema.parse(parsed);
    return {
      featureId: body.featureId,
      planeKind: body.planeKind,
      revision: body.revision,
      model: body.sketch.model,
      plane: body.sketch.plane,
      supportRef: body.sketch.supportRef,
      projectionGroups: body.sketch.projectionGroups,
      geometryCurrent: body.geometryCurrent,
      status: body.geometryStatus,
      error: body.error,
      blockingSourceIds: body.blockingSourceIds,
    };
  }

  async datumCommand(type: number, fields: Record<string, unknown>): Promise<{ features: FeatureSummary[]; sketches: SketchSummary[]; datums: DatumDescriptor[]; revision: number }> {
    const creation = type === CommandType.CreateDatumPlane || type === CommandType.CreateDatumAxis || type === CommandType.CreateDatumPoint;
    const parsed = await this.invoke(type,this.documentId,{ ...(creation ? { featureId: newFeatureId("datum") } : {}), ...fields });
    return FeatureListSchema.parse(parsed);
  }

  async createSurface(
    commandId: SurfaceCommandId,
    parameters: Record<string, unknown>,
    context: SurfaceCommandContext,
  ): Promise<CreatedFeature> {
    if (!isSurfaceCommandId(commandId)) throw new Error("unsupported surface command");
    if (context.sessionId !== undefined && !z.string().uuid().safeParse(context.sessionId).success)
      throw new Error("invalid surface command session context");
    if (!this.surfaceContextIsCurrent(context, true)) throw new Error("stale surface command context");
    const command = commandNativeRequest(commandId, parameters, newFeatureId("surface"));
    const parsed = await this.invoke(
      command.type,
      context.documentId,
      command.fields,
      () => this.surfaceContextIsCurrent(context, false),
      { expectedRevision: context.revision, ...(context.sessionId ? { expectedSessionId: context.sessionId } : {}) },
    );
    return CreatedFeatureSchema.parse(parsed);
  }

  async resolveSurfacePoint(
    request: SurfacePointResolveRequest,
    context: SurfaceCommandContext,
  ): Promise<{ result: SurfacePointResolveResult; context: SurfaceCommandContext & { sessionId: string } }> {
    const input = SurfacePointResolveRequestSchema.parse(request);
    const captured = { ...context };
    if (!Number.isSafeInteger(captured.revision) || captured.revision < 0 ||
        (captured.sessionId !== undefined && !z.string().uuid().safeParse(captured.sessionId).success))
      throw new Error("invalid surface point context");
    if (!this.surfaceContextIsCurrent(captured, true)) throw new Error("stale surface point context");

    let result: SurfacePointResolveResult | undefined;
    let acquiredSessionId: string | undefined;
    await this.invoke(
      CommandType.RequestSessionQuery,
      captured.documentId,
      { method: "resolveSurfacePoint", params: input },
      () => this.surfaceContextIsCurrent(captured, true),
      { expectedRevision: captured.revision, ...(captured.sessionId ? { expectedSessionId: captured.sessionId } : {}) },
      response => {
        if (response.status === "error") return;
        const responseSessionId = response.sessionId;
        if (response.documentId !== captured.documentId || response.revision !== captured.revision ||
            typeof responseSessionId !== "string" || !z.string().uuid().safeParse(responseSessionId).success ||
            (captured.sessionId !== undefined && responseSessionId.toLowerCase() !== captured.sessionId.toLowerCase()))
          throw new Error("stale surface point response lineage");
        let parsedResult: SurfacePointResolveResult;
        try { parsedResult = SurfacePointResolveResultSchema.parse(response.result); }
        catch (error) { throw new Error(`invalid surface point result: ${error instanceof Error ? error.message : String(error)}`); }
        const qualifyFace = (featureId: string, persistentFaceId: string) =>
          persistentFaceId.includes(":") ? persistentFaceId : `${featureId}:${persistentFaceId}`;
        if (parsedResult.keepFace.featureId !== input.targetId ||
            (input.persistentFaceId !== undefined &&
              qualifyFace(input.targetId, parsedResult.keepFace.persistentFaceId) !== qualifyFace(input.targetId, input.persistentFaceId)) ||
            parsedResult.projectionDistanceMm > input.maxDistanceMm)
          throw new Error("surface point result does not match the requested owner, hint, or tolerance");
        result = parsedResult;
        acquiredSessionId = responseSessionId;
      },
    );
    if (!this.surfaceContextIsCurrent(captured, true) || !result || !acquiredSessionId)
      throw new Error("stale surface point response");
    return { result, context: { ...captured, sessionId: acquiredSessionId } };
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
    insertBeforeId?: string;
    targetId: string;
    faceRole: string;
    xMm: number;
    yMm: number;
    diameterMm: number;
    depthMode: "throughAll" | "blind";
    depthMm: number;
  }): Promise<CreatedFeature & { features?: FeatureSummary[]; sketches?: SketchSummary[] }> {
    const featureId = newFeatureId("ho");
    const parsed = await this.invoke(
      CommandType.CreateHole,
      this.documentId,
      { featureId, ...params },
    );
    const created = CreatedFeatureSchema.parse(parsed);
    if (!params.insertBeforeId) return created;
    const list = FeatureListSchema.parse(parsed);
    return { ...created, features: list.features, sketches: list.sketches };
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
    datums: DatumDescriptor[];
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
      sketches: checked.sketches, datums: checked.datums,
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

  async createShell(params: {
    targetId: string;
    faceRole: string;
    thicknessMm: number;
  }): Promise<CreatedFeature> {
    const featureId = newFeatureId("sh");
    const parsed = await this.invoke(
      CommandType.CreateShell,
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

  private surfaceContextIsCurrent(context: SurfaceCommandContext, requireRevision: boolean): boolean {
    const current = useDocumentUiStore.getState();
    return current.coreRunning && this.documentId === context.documentId &&
      current.documentId === context.documentId && current.epoch === context.epoch &&
      current.connectionGeneration === context.connectionGeneration &&
      (!requireRevision || current.revision === context.revision);
  }

  private sketchContextIsCurrent(context: SketchCommandContext, requireRevision: boolean): boolean {
    return this.sketchContextMatchesRevisions(context, requireRevision ? [context.revision] : undefined);
  }

  private sketchContextMatchesRevisions(
    context: SketchCommandContext,
    allowedRevisions?: readonly number[],
  ): boolean {
    const current = useDocumentUiStore.getState();
    return current.coreRunning && this.documentId === context.documentId &&
      current.documentId === context.documentId && current.epoch === context.epoch &&
      current.connectionGeneration === context.connectionGeneration &&
      (!allowedRevisions || allowedRevisions.includes(current.revision));
  }

  private async validateSketchResponse(
    context: SketchCommandContext,
    response: Record<string, unknown>,
    expectedRevision: number,
    allowSingleRevisionAdvance = false,
  ): Promise<SketchCommandContext> {
    const expectedRevisionAllowed = expectedRevision === context.revision ||
      (allowSingleRevisionAdvance && expectedRevision === context.revision + 1);
    const allowedUiRevisions = allowSingleRevisionAdvance
      ? [context.revision, expectedRevision]
      : [context.revision];
    if (!Number.isSafeInteger(expectedRevision) || !expectedRevisionAllowed ||
        response.revision !== expectedRevision || !this.sketchContextMatchesRevisions(context, allowedUiRevisions))
      throw new Error("stale sketch response revision");
    await this.validateSketchLineage(context, expectedRevision, allowedUiRevisions);
    return { ...context, revision: expectedRevision };
  }

  private async validateSketchLineage(
    context: SketchCommandContext,
    expectedRevision: number,
    allowedUiRevisions: readonly number[] = [context.revision],
  ): Promise<void> {
    if (!this.sketchContextMatchesRevisions(context, allowedUiRevisions))
      throw new Error("stale sketch command context");
    const snapshot = await window.kreoda.sessionSnapshot() as { sessionId?: unknown; documentId?: unknown; revision?: unknown };
    if (!this.sketchContextMatchesRevisions(context, allowedUiRevisions) || snapshot.documentId !== context.documentId ||
        snapshot.sessionId !== context.sessionId || snapshot.revision !== expectedRevision)
      throw new Error("stale sketch response lineage");
  }

  private async invoke(
    type: number,
    documentId: string,
    fields: Record<string, unknown>,
    currentContextGuard?: () => boolean | Promise<boolean>,
    controlMetadata?: { expectedRevision?: number; expectedSessionId?: string },
    responseValidator?: (parsed: Record<string, unknown>) => void | Promise<void>,
    postValidationGuard?: () => boolean | Promise<boolean>,
  ): Promise<Record<string, unknown>> {
    const raw = await this.roundTrip({
      protocolVersion: PROTOCOL_VERSION,
      requestId: `req-${++this.seq}`,
      documentId,
      type,
      ...fields,
      ...controlMetadata,
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
    const assertGuard = (guard?: () => boolean | Promise<boolean>): void | Promise<void> => {
      if (!guard) return;
      const result = guard();
      if (result && typeof result === "object" && "then" in result && typeof result.then === "function")
        return result.then(isCurrent => {
          if (!isCurrent) throw new Error("stale command response");
        });
      if (!result) throw new Error("stale command response");
    };
    let awaitedGuard = false;
    const initialGuard = assertGuard(currentContextGuard);
    if (initialGuard) {
      awaitedGuard = true;
      await initialGuard;
    }
    const validation = responseValidator?.(parsed);
    const awaitedValidation = !!validation && typeof validation === "object" &&
      "then" in validation && typeof validation.then === "function";
    if (awaitedValidation) await validation;
    if (awaitedValidation || awaitedGuard) {
      const finalGuard = assertGuard(postValidationGuard ?? currentContextGuard);
      if (finalGuard) await finalGuard;
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
