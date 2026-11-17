// Central command execution (§19): toolbar, context menu, palette,
// shortcuts, AI tools and plugins invoke THIS — one definition, one path.
// Every call validates params (zod), checks selection availability, runs the
// typed core command, then re-syncs the read-only projection (§9).

import {
  COMMANDS,
  type CommandContext,
} from "@kreoda/command-schema";
import {
  coreClient,
  type CreatedFeature,
  type DirectFaceHistoryCommandId,
  type DirectFaceHistoryContext,
  type FeatureSummary,
} from "../ipc/coreClient";
import { SketchModelSchema, type CoreMeshData, type DatumDescriptor } from "@kreoda/protocol";
import { CommandType } from "@kreoda/protocol";
import {
  pullFeatureMesh,
  syncFromCoreList,
  updateFeatureSummary,
} from "../model/sync";
import {
  selectionKindOf,
  isSketchId,
  surfaceFeatureIds,
  useDocumentUiStore,
  usePreferencesStore,
  useSelectionStore,
} from "../stores";
import type { SketchModel } from "@kreoda/protocol";
import { t } from "../i18n";
import { localizeReason } from "../i18n/commands";
import { isSurfaceCommandId, type SurfaceCommandContext, type SurfaceCommandId } from "./surface-commands";

function commandContext(): CommandContext {
  const sel = useSelectionStore.getState();
  return {
    selection: sel.selectedIds.map((id) => {
      const kind = selectionKindOf(id);
      const mapped = kind === "body" && isSketchId(id) ? "sketch" : kind;
      return { kind: mapped, persistentId: id };
    }),
    beginnerMode: usePreferencesStore.getState().beginnerMode,
  };
}

function selectedDatumPlanes(context: CommandContext): string[] {
  const selected = new Set(context.selection.filter(item => item.kind === "datumPlane").map(item => item.persistentId));
  return useDocumentUiStore.getState().datums
    .filter(datum => datum.kind === "DatumPlane" && datum.status === "ok" && selected.has(datum.featureId))
    .map(datum => datum.featureId);
}

function optionalBindingAvailability(def: (typeof COMMANDS)[number], context: CommandContext): { available: boolean; reason?: string } {
  const planes = context.selection.filter(item => item.kind === "datumPlane").map(item => item.persistentId);
  for (const binding of Object.values(def.optionalSelectionBindings ?? {})) {
    if (binding !== "datumPlane" || planes.length === 0) continue;
    const healthy = new Set(selectedDatumPlanes(context));
    if (planes.some(id => !healthy.has(id))) return { available: false, reason: "BROKEN_REFERENCE" };
    if (planes.length > 1) return { available: false, reason: "AMBIGUOUS_REFERENCE" };
  }
  return { available: true };
}

function applyOptionalSelectionBindings(def: (typeof COMMANDS)[number], parameters: Record<string, unknown>, context: CommandContext): void {
  for (const [name, binding] of Object.entries(def.optionalSelectionBindings ?? {})) {
    if (parameters[name] !== undefined || binding !== "datumPlane") continue;
    const planes = selectedDatumPlanes(context);
    if (planes.length > 1) throw new Error("AMBIGUOUS_REFERENCE");
    if (planes.length === 1) parameters[name] = planes[0];
  }
}

function appendFeature(entry: FeatureSummary, revision: number): void {
  // Minor race: two parallel pullAndAppend (CreateBox ×2) used a
  // revision-gated replace that could drop the loser's entry (winner's
  // snapshot predates loser). Merge keyed + ignore stale revisions.
  const s = useDocumentUiStore.getState();
  if (revision < s.revision) {
    // Stale revision: still ensure the entry exists (never drop), but don't
    // roll the revision back.
    if (!s.features.some((f) => f.featureId === entry.featureId)) {
      s.setFeatures([...s.features, entry], s.revision);
    }
    return;
  }
  const byId = new Map(s.features.map((f) => [f.featureId, f]));
  byId.set(entry.featureId, entry);
  s.setFeatures([...byId.values()], revision);
}

async function pullAndAppend(created: CreatedFeature): Promise<void> {
  await pullFeatureMesh(created.featureId, created.revision);
  appendFeature(
    {
      featureId: created.featureId,
      type: created.type,
      paramsMm: created.paramsMm,
      dependsOn: created.dependsOn ?? [],
      refExtra: created.refExtra ?? "",
      expressions: created.expressions ?? {},
      volumeMm3: created.volumeMm3,
    },
    created.revision,
  );
}

export type CommandResult =
  | { kind: "created"; feature: CreatedFeature; refreshError?: string }
  | { kind: "mesh"; mesh: CoreMeshData }
  | { kind: "list"; features: FeatureSummary[]; revision: number }
  | { kind: "ok" };

const DIRECT_FACE_HISTORY_COMMANDS = new Set([
  "CreateMoveFace", "CreateOffsetFace", "CreateDeleteFace", "CreateReplaceFace",
]);

export async function executeCommand(
  id: string,
  params: unknown,
  opts: { skipAvailability?: boolean; surfaceContext?: SurfaceCommandContext;
    directFaceContext?: DirectFaceHistoryContext } = {},
): Promise<CommandResult> {
  const isSurface = isSurfaceCommandId(id);
  const isDirectFaceHistory = DIRECT_FACE_HISTORY_COMMANDS.has(id);
  if (opts.surfaceContext && !isSurface) throw new Error("surfaceContext is only valid for surface commands");
  if (opts.directFaceContext && !isDirectFaceHistory)
    throw new Error("directFaceContext is only valid for direct face history commands");
  if (isDirectFaceHistory && !opts.directFaceContext)
    throw new Error("direct face history commands require a captured face context");
  if (!useDocumentUiStore.getState().coreRunning) {
    throw new Error(t("cmd.engineOff"));
  }
  const def = COMMANDS.find((c) => c.id === id);
  if (!def) throw new Error(t("cmd.unknownId", { id }));
  // skipAvailability: plan expansion (provider.ts) resolves context
  // EXPLICITLY (target/face/edge ids in hand). Params are still
  // zod-validated, so the single typed path (§0.4) is preserved; only the
  // UI-context gate is the caller's responsibility. SAFETY: only
  // provider.ts may pass skipAvailability.
  const context = commandContext();
  if (!isSurface && !opts.skipAvailability) {
    const availability = def.availability(context);
    if (!availability.available) {
      throw new Error(localizeReason(availability.reason) ?? t("cmd.unavailable", { id }));
    }
  }
  const p = def.parameterSchema.parse(params) as Record<string, unknown>;
  let surfaceContext = opts.surfaceContext;
  if (isSurface) {
    const current = useDocumentUiStore.getState();
    surfaceContext ??= {
      documentId: current.documentId,
      revision: current.revision,
      epoch: current.epoch,
      connectionGeneration: current.connectionGeneration,
    };
    if (!opts.skipAvailability) validateSurfaceSources(id, p);
    if (!surfaceContextIsCurrent(surfaceContext, true)) throw new Error(t("surface.stale"));
    if (!opts.skipAvailability) {
      const availabilityContext = id === "CreateSurfaceSweep"
        ? { ...context, selection: [
            { kind: "sketch" as const, persistentId: p["profileSketchId"] as string },
            { kind: "sketch" as const, persistentId: p["pathSketchId"] as string },
          ] }
        : context;
      const availability = def.availability(availabilityContext);
      if (!availability.available) throw new Error(localizeReason(availability.reason) ?? t("cmd.unavailable", { id }));
    }
  }
  if (!isSurface && !opts.skipAvailability) {
    const explicitlyBound = Object.entries(def.optionalSelectionBindings ?? {}).some(([name]) => p[name] !== undefined);
    if (!explicitlyBound) {
      const availability = optionalBindingAvailability(def, context);
      if (!availability.available) throw new Error(availability.reason);
      applyOptionalSelectionBindings(def, p, context);
    }
  }
  if (isSurface && !surfaceContextIsCurrent(surfaceContext!, true)) throw new Error(t("surface.stale"));
  return dispatchCommand(id, p, def.nativeType, surfaceContext, opts.directFaceContext);
}



async function dispatchCommand(
  id: string,
  p: Record<string, unknown>,
  nativeType: number,
  surfaceContext?: SurfaceCommandContext,
  directFaceContext?: DirectFaceHistoryContext,
): Promise<CommandResult> {
  switch (id) {
    case "CreateSurfaceExtrude":
    case "CreateSurfaceRevolve":
    case "CreateSurfaceLoft":
    case "CreateSurfaceSew":
    case "CreateSurfaceOffset":
    case "CreateSurfaceThicken":
    case "CreateSurfaceTrim":
    case "CreateSurfaceExtend":
    case "CreateSurfaceSweep": {
      if (!surfaceContext) throw new Error(t("surface.stale"));
      const created = await coreClient.createSurface(id as SurfaceCommandId, p, surfaceContext);
      if (!surfaceContextIsCurrent(surfaceContext, false)) return { kind: "created", feature: created };
      try {
        await refreshSurfaceSnapshot(surfaceContext);
        return { kind: "created", feature: created };
      } catch (error) {
        if (!surfaceContextIsCurrent(surfaceContext, false)) return { kind: "created", feature: created };
        return { kind: "created", feature: created, refreshError: error instanceof Error ? error.message : String(error) };
      }
    }
    case "CreateMoveFace":
    case "CreateOffsetFace":
    case "CreateDeleteFace":
    case "CreateReplaceFace": {
      if (!directFaceContext) throw new Error("direct face history context expired");
      let created: CreatedFeature;
      try {
        created = await coreClient.createDirectFaceHistory(id as DirectFaceHistoryCommandId, p, directFaceContext);
      } catch (error) {
        let recoveredRevision = directFaceContext.revision;
        try {
          const recovered = await refreshDirectFaceHistorySnapshot(directFaceContext, directFaceContext.revision);
          recoveredRevision = recovered.revision;
        } catch (recoveryError) {
          throw new Error(`${t("directFaceHistory.outcomeUnknown")} (${recoveryError instanceof Error
            ? recoveryError.message : String(recoveryError)})`);
        }
        if (recoveredRevision > directFaceContext.revision)
          throw new Error(t("directFaceHistory.outcomeUnknown"));
        throw error;
      }
      try {
        await refreshDirectFaceHistorySnapshot(directFaceContext, created.revision);
        return { kind: "created", feature: created };
      } catch (error) {
        return { kind: "created", feature: created,
          refreshError: error instanceof Error ? error.message : String(error) };
      }
    }
    case "CreateBox": {
      const created = await coreClient.createBox(
        p as { widthMm: number; heightMm: number; depthMm: number },
      );
      await pullAndAppend(created);
      return { kind: "created", feature: created };
    }
    case "CreateCylinder": {
      const created = await coreClient.createCylinder(
        p as { radiusMm: number; heightMm: number },
      );
      await pullAndAppend(created);
      return { kind: "created", feature: created };
    }
    case "CreateSphere": {
      const created = await coreClient.createSphere(
        p as { radiusMm: number },
      );
      await pullAndAppend(created);
      return { kind: "created", feature: created };
    }
    case "CreateSketch": {
      const { planeKind, model, supportRef } = p as { planeKind: "XY" | "XZ" | "YZ"; model?: SketchModel; supportRef?: string };
      const { featureId, revision } = await coreClient.createSketch({
        planeKind: planeKind ?? "XY",
        model: model ?? emptySketchModel(),
        supportRef,
      });
      const full = await coreClient.requestSketch(featureId);
      useDocumentUiStore.getState().upsertSketch({
        featureId,
        planeKind: full.planeKind,
        plane: full.plane,
        supportRef: full.supportRef,
        points: full.points.length,
        lines: full.lines.length,
        circles: full.circles.length,
        constraints: full.constraints.length,
        model: full,
      });
      useDocumentUiStore.getState().setFeatures(
        useDocumentUiStore.getState().features,
        revision,
      );
      return { kind: "ok" };
    }
    case "CreateExtrude": {
      const created = await coreClient.createExtrude(
        p as { sketchId: string; distanceMm: number },
      );
      await pullAndAppend(created);
      return { kind: "created", feature: created };
    }
    case "CreateRevolve": {
      const created = await coreClient.createRevolve(p as { sketchId: string; angleDeg: number });
      await pullAndAppend(created);
      return { kind: "created", feature: created };
    }
    case "UpdateSketch": {
      const { featureId, model } = p as { featureId: string; model: SketchModel };
      await coreClient.updateSketch({ featureId, model });
      const snapshot = await coreClient.requestSnapshot();
      await syncFromCoreList(snapshot.features, snapshot.revision, snapshot.sketches, null, snapshot.datums);
      return { kind: "list", features: snapshot.features, revision: snapshot.revision };
    }
    case "DeleteFeature": {
      const result = await coreClient.deleteFeature(p["featureId"] as string);
      await syncFromCoreList(result.features, result.revision, result.sketches, null, result.datums);
      return { kind: "list", features: result.features, revision: result.revision };
    }
    case "CreateBoolean": {
      const created = await coreClient.createBoolean(
        p as { op: "fuse" | "cut" | "common"; targetId: string; toolId: string },
      );
      await pullAndAppend(created);
      return { kind: "created", feature: created };
    }
    case "CreateHole": {
      const created = await coreClient.createHole(
        p as {
          insertBeforeId?: string;
          targetId: string;
          faceRole: string;
          xMm: number;
          yMm: number;
          diameterMm: number;
          depthMode: "throughAll" | "blind";
          depthMm: number;
        },
      );
      if (created.features) await syncFromCoreList(created.features, created.revision, created.sketches);
      else await pullAndAppend(created);
      return { kind: "created", feature: created };
    }
    case "CreateHolePattern": {
      // M11: one core transaction for the whole pattern (one Undo step).
      const { targetId, faceRole, pointsMm, diameterMm, depthMode, depthMm, featureIds } =
        p as {
          targetId: string;
          faceRole: string;
          pointsMm: number[];
          diameterMm: number;
          depthMode: "throughAll" | "blind";
          depthMm: number;
          featureIds: string[];
        };
      if (pointsMm.length % 2 !== 0) throw new Error(t("cmd.pointsPairs"));
      // m11: fail fast locally (no wasted round-trip) when ids don't match
      // points 1:1 — the core re-checks and answers BAD_PARAMS anyway.
      if (featureIds.length * 2 !== pointsMm.length) {
        throw new Error(t("cmd.patternIds"));
      }
      const points: [number, number][] = [];
      for (let i = 0; i < pointsMm.length; i += 2) {
        points.push([pointsMm[i]!, pointsMm[i + 1]!]);
      }
      const { features, sketches, revision } =
        await coreClient.createHolePattern({
          targetId,
          faceRole,
          points,
          diameterMm,
          depthMode,
          depthMm,
          featureIds,
        });
      await syncFromCoreList(features, revision, sketches);
      return { kind: "list", features, revision };
    }
    case "CreateFillet": {
      const created = await coreClient.createFillet(
        p as { targetId: string; edgeIds: string[]; radiusMm: number },
      );
      await pullAndAppend(created);
      return { kind: "created", feature: created };
    }
    case "CreateChamfer": {
      const created = await coreClient.createChamfer(
        p as { targetId: string; edgeIds: string[]; distanceMm: number },
      );
      await pullAndAppend(created);
      return { kind: "created", feature: created };
    }
    case "CreateShell": {
      const created = await coreClient.createShell(
        p as { targetId: string; faceRole: string; thicknessMm: number },
      );
      await pullAndAppend(created);
      return { kind: "created", feature: created };
    }
    case "CreateInstance": {
      const created = await coreClient.createInstance(
        p as {
          targetId: string;
          txMm?: number;
          tyMm?: number;
          tzMm?: number;
          rxDeg?: number;
          ryDeg?: number;
          rzDeg?: number;
        },
      );
      await pullAndAppend(created);
      return { kind: "created", feature: created };
    }
    case "CreateMirror": {
      const created = await coreClient.createMirror(
        p as {
          targetId: string;
          planeKind?: "XY" | "XZ" | "YZ";
          datumId?: string;
        },
      );
      await pullAndAppend(created);
      return { kind: "created", feature: created };
    }
    case "CreateBodyPattern": {
      const created = await coreClient.createBodyPattern(
        p as {
          targetId: string;
          axis: "X" | "Y" | "Z";
          count: number;
          spacingMm: number;
        },
      );
      await pullAndAppend(created);
      return { kind: "created", feature: created };
    }
    case "CreateCircularBodyPattern": {
      const created = await coreClient.createCircularBodyPattern(
        p as {
          targetId: string;
          axis: "X" | "Y" | "Z";
          count: number;
          angleDeg: number;
        },
      );
      await pullAndAppend(created);
      return { kind: "created", feature: created };
    }
    case "SetDimension": {
      const { featureId, paramName, valueMm, expression } = p as {
        featureId: string;
        paramName: string;
        valueMm?: number;
        expression?: string;
      };
      if(useDocumentUiStore.getState().datums.some(datum => datum.featureId === featureId)) {
        const result = await coreClient.datumCommand(CommandType.SetFeatureParameter,{ featureId,paramName,valueMm, ...(expression ? { expression } : {}) });
        await syncFromCoreList(result.features,result.revision,result.sketches,null,result.datums);
        return { kind: "list", features: result.features, revision: result.revision };
      }
      const updated = await coreClient.setFeatureParameter(
        featureId,
        paramName,
        valueMm ?? 0,
        false,
        expression ?? "",
      );
      if ("positions" in updated) {
        // Preview meshes never commit — no store update by design (§13).
        return { kind: "mesh", mesh: updated };
      }
      // C2: cross-feature expressions / instance reflow move OTHER features —
      // sync every summary from the full list, pull meshes for all that moved.
      const list = (updated as { features?: FeatureSummary[] }).features;
      if (list && list.length > 0) {
        const sketches =
          (updated as { sketches?: import("../ipc/coreClient").SketchSummary[] }).sketches ?? [];
        const datums = updated.datums ?? null;
        await syncFromCoreList(list, updated.revision, sketches, null, datums);
      } else {
        await pullFeatureMesh(featureId, updated.revision);
        updateFeatureSummary(
          featureId,
          {
            paramsMm: updated.paramsMm,
            dependsOn: updated.dependsOn ?? [],
            refExtra: updated.refExtra ?? "",
            expressions: updated.expressions ?? {},
            volumeMm3: updated.volumeMm3,
          },
          updated.revision,
        );
      }
      return { kind: "created", feature: updated };
    }
    case "Undo": {
      const { features, sketches, datums, revision } = await coreClient.undo();
      await syncFromCoreList(features, revision, sketches, null, datums);
      return { kind: "list", features, revision };
    }
    case "Redo": {
      const { features, sketches, datums, revision } = await coreClient.redo();
      await syncFromCoreList(features, revision, sketches, null, datums);
      return { kind: "list", features, revision };
    }
    case "CreateDatumPlane":
    case "CreateDatumAxis":
    case "CreateDatumPoint":
    case "UpdateDatum": {
      const result = await coreClient.datumCommand(nativeType,p as Record<string,unknown>);
      await syncFromCoreList(result.features,result.revision,result.sketches,null,result.datums);
      return { kind: "list", features: result.features, revision: result.revision };
    }
    default:
      // Registered but not yet implemented (e.g. future Phase 8 ops).
      // Honest Phase-8 pointer, not jargon (§63.10).
      throw new Error(t("cmd.noExecutor", { id }));
  }
}

/** Fenced, read-only refresh shared by post-create and the panel's Retry action. */
export async function refreshSurfaceSnapshot(context: SurfaceCommandContext): Promise<{ features: FeatureSummary[]; revision: number }> {
  if (!surfaceContextIsCurrent(context, false)) throw new Error(t("surface.stale"));
  const native = await coreClient.requestSnapshot(context);
  if (!surfaceContextIsCurrent(context, false)) throw new Error(t("surface.stale"));
  let features = native.features;
  let sketches = native.sketches;
  let datums: DatumDescriptor[] | null = native.datums;
  let revision = native.revision;

  if (sketches.some(sketch => !SketchModelSchema.safeParse(sketch.model).success)) {
    const readSession = window.kreoda?.sessionSnapshot;
    if (!readSession) throw new Error(t("surface.fullSnapshotUnavailable"));
    const session = await readSession();
    if (!surfaceContextIsCurrent(context, false) || session.documentId !== context.documentId || session.revision < native.revision) {
      throw new Error(t("surface.stale"));
    }
    const fullSketches = session.sketches as unknown as typeof native.sketches;
    if (fullSketches.some(sketch => !SketchModelSchema.safeParse(sketch.model).success)) {
      throw new Error(t("surface.fullSnapshotUnavailable"));
    }
    features = session.features as unknown as FeatureSummary[];
    sketches = fullSketches;
    datums = session.datums ? session.datums as unknown as DatumDescriptor[] : [];
    revision = session.revision;
  }

  if (!surfaceContextIsCurrent(context, false)) throw new Error(t("surface.stale"));
  await syncFromCoreList(features, revision, sketches, null, datums, () => surfaceContextIsCurrent(context, false));
  if (!surfaceContextIsCurrent(context, false)) throw new Error(t("surface.stale"));
  return { features, revision };
}

async function refreshDirectFaceHistorySnapshot(
  context: DirectFaceHistoryContext,
  minimumRevision: number,
): Promise<{ features: FeatureSummary[]; revision: number }> {
  const current = () => {
    const state = useDocumentUiStore.getState();
    return state.coreRunning && coreClient.documentId === context.documentId &&
      state.documentId === context.documentId && state.epoch === context.epoch &&
      state.connectionGeneration === context.connectionGeneration;
  };
  if (!current()) throw new Error(t("directFaceHistory.stale"));
  let native = await coreClient.requestDirectFaceHistorySnapshot(context, minimumRevision);
  let features = native.features;
  let sketches = native.sketches;
  let datums: DatumDescriptor[] = native.datums;
  let revision = native.revision;
  const latestUiRevision = useDocumentUiStore.getState().revision;
  const fullSketches = sketches.every(sketch => SketchModelSchema.safeParse(sketch.model).success);
  if (revision < Math.max(minimumRevision, latestUiRevision) || !fullSketches) {
    const readSession = window.kreoda?.sessionSnapshot;
    if (!readSession) throw new Error(t("directFaceHistory.snapshotUnavailable"));
    const session = await readSession() as {
      sessionId?: unknown; documentId?: unknown; revision?: unknown;
      features?: unknown; sketches?: unknown; datums?: unknown;
    };
    if (!current() || session.documentId !== context.documentId || session.sessionId !== context.sessionId ||
        typeof session.revision !== "number" || !Number.isSafeInteger(session.revision) ||
        session.revision < Math.max(minimumRevision, useDocumentUiStore.getState().revision, revision))
      throw new Error(t("directFaceHistory.stale"));
    const sessionFeatures = session.features as FeatureSummary[] | undefined;
    const sessionSketches = session.sketches as import("../ipc/coreClient").SketchSummary[] | undefined;
    if (!Array.isArray(sessionFeatures) || !Array.isArray(sessionSketches) ||
        !sessionSketches.every(sketch => SketchModelSchema.safeParse(sketch.model).success))
      throw new Error(t("directFaceHistory.snapshotUnavailable"));
    features = sessionFeatures;
    sketches = sessionSketches;
    datums = Array.isArray(session.datums) ? session.datums as DatumDescriptor[] : [];
    revision = session.revision;
  }
  if (!current() || revision < Math.max(minimumRevision, useDocumentUiStore.getState().revision))
    throw new Error(t("directFaceHistory.stale"));
  const contextGuard = () => current() && useDocumentUiStore.getState().revision <= revision;
  await syncFromCoreList(features, revision, sketches, null, datums, contextGuard);
  if (!contextGuard()) throw new Error(t("directFaceHistory.stale"));
  return { features, revision };
}

function surfaceContextIsCurrent(context: SurfaceCommandContext, requireRevision: boolean): boolean {
  const state = useDocumentUiStore.getState();
  return state.coreRunning && coreClient.documentId === context.documentId &&
    state.documentId === context.documentId && state.epoch === context.epoch &&
    state.connectionGeneration === context.connectionGeneration &&
    (!requireRevision || state.revision === context.revision);
}

function healthySurfaceSource(source: {
  geometryCurrent?: boolean;
  status?: string;
  error?: string;
  blockingSourceIds?: string[];
}): boolean {
  return source.geometryCurrent !== false && (source.status === undefined || source.status === "ok") &&
    !source.error?.trim() && !source.blockingSourceIds?.length;
}

function validateSurfaceSources(id: string, parameters: Record<string, unknown>): void {
  const state = useDocumentUiStore.getState();
  const sketches = new Map(state.sketches.map(sketch => [sketch.featureId, sketch]));
  const surfaceIds = surfaceFeatureIds(state.features);
  const surfaces = new Map(state.features.map(feature => [feature.featureId, feature]));
  const requireSketch = (featureId: string): void => {
    const source = sketches.get(featureId);
    if (!source || !healthySurfaceSource(source)) throw new Error(t("surface.sourceUnavailable"));
  };
  const requireSurface = (featureId: string): void => {
    const source = surfaces.get(featureId);
    if (!source || !surfaceIds.has(featureId) || source.type === "SurfaceSewnSolid" || source.type === "SurfaceFaceThicken" ||
        !healthySurfaceSource(source)) throw new Error(t("surface.sourceUnavailable"));
  };
  switch (id) {
    case "CreateSurfaceExtrude":
    case "CreateSurfaceRevolve":
      requireSketch(parameters["sketchId"] as string);
      return;
    case "CreateSurfaceLoft":
      (parameters["sketchIds"] as string[]).forEach(requireSketch);
      return;
    case "CreateSurfaceSew":
      (parameters["featureIds"] as string[]).forEach(requireSurface);
      return;
    case "CreateSurfaceOffset":
    case "CreateSurfaceThicken":
      requireSurface(parameters["targetId"] as string);
      return;
    case "CreateSurfaceTrim": {
      const targetId = parameters["targetId"] as string;
      const toolId = parameters["toolId"] as string;
      if (targetId === toolId) throw new Error(t("surface.sourceUnavailable"));
      requireSurface(targetId);
      const datum = state.datums.find(item => item.featureId === toolId);
      if (datum?.kind === "DatumPlane" && datum.status === "ok" && !datum.error?.trim()) return;
      requireSurface(toolId);
      return;
    }
    case "CreateSurfaceExtend":
      requireSurface(parameters["targetId"] as string);
      return;
    case "CreateSurfaceSweep": {
      const profile = parameters["profileSketchId"] as string;
      const path = parameters["pathSketchId"] as string;
      if (profile === path) throw new Error(t("surface.sourceUnavailable"));
      requireSketch(profile);
      requireSketch(path);
      return;
    }
  }
}

/** Registry entries visible in the current UI mode (drives the toolbar). */
export function visibleCommands() {
  const beginner = usePreferencesStore.getState().beginnerMode;
  return COMMANDS.filter((c) =>
    beginner ? c.beginnerVisible : c.advancedVisible,
  );
}

/** Availability of one command in the current selection context. */
export function commandAvailability(id: string): {
  available: boolean;
  reason?: string;
} {
  // Crashed/restarting engine (M11): every mutating command is unavailable
  // with one honest reason — buttons grey out instead of committing into a
  // fresh empty engine while the user restores.
  if (!useDocumentUiStore.getState().coreRunning) {
    return { available: false, reason: t("cmd.engineOff") };
  }
  const def = COMMANDS.find((c) => c.id === id);
  if (!def) return { available: false, reason: t("cmd.reasonUnknown") };
  const context = commandContext();
  const availability = def.availability(context);
  if (!availability.available) return availability;
  const optionalAvailability = optionalBindingAvailability(def, context);
  if (!optionalAvailability.available) return optionalAvailability;
  return availability;
}

function emptySketchModel(): SketchModel {
  return { points: [], lines: [], circles: [], arcs: [], constraints: [] };
}
