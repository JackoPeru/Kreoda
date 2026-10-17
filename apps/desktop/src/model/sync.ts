// Canonical → renderer sync (§66): pull binary meshes for committed state.
// Preview meshes (§13) intentionally bypass the store — they never commit.

import {
  coreClient,
  type FeatureSummary,
  type SketchProjectionMutation,
  type SketchSummary,
} from "../ipc/coreClient";
import {
  useDocumentUiStore,
  useSelectionStore,
  visibleFeatureIds,
} from "../stores";
import type { DatumDescriptor, SketchProjectionResult } from "@kreoda/protocol";

let refreshOpenedSession: (() => Promise<void>) | null = null;
const projectionTickets = new Map<string, number>();
let nextProjectionTicket = 0;

/** Open and recovery await the same queue that owns incoming session events. */
export function bindOpenedSessionRefresh(refresh: () => Promise<void>): () => void {
  refreshOpenedSession = refresh;
  return () => { if (refreshOpenedSession === refresh) refreshOpenedSession = null; };
}

export async function syncOpenedDocument(features: FeatureSummary[], revision: number, sketches: SketchSummary[], datums: DatumDescriptor[] = []): Promise<number> {
  if (refreshOpenedSession) {
    await refreshOpenedSession();
  } else {
    useDocumentUiStore.getState().resetDocument(coreClient.documentId);
    await syncFromCoreList(features, revision, sketches, null, datums);
  }
  return useDocumentUiStore.getState().epoch;
}

/** Read native projection curves only for the exact current session view. */
export async function refreshSketchProjection(featureId: string): Promise<SketchProjectionResult | null> {
  const ticket = ++nextProjectionTicket;
  projectionTickets.set(featureId, ticket);
  const initial = useDocumentUiStore.getState();
  const context = {
    documentId: initial.documentId,
    revision: initial.revision,
    epoch: initial.epoch,
    connectionGeneration: initial.connectionGeneration,
  };
  initial.clearSketchProjection(featureId);

  try {
    const before = await window.kreoda.sessionSnapshot() as { sessionId?: string; documentId: string; revision: number };
    if (projectionTickets.get(featureId) !== ticket) return null;
    const current = useDocumentUiStore.getState();
    if (before.documentId !== context.documentId || before.revision !== context.revision ||
        current.documentId !== context.documentId || current.revision !== context.revision ||
        current.epoch !== context.epoch || current.connectionGeneration !== context.connectionGeneration ||
        typeof before.sessionId !== "string" || coreClient.documentId !== context.documentId) return null;

    const response = await coreClient.requestSketchProjection(featureId);
    const after = await window.kreoda.sessionSnapshot() as { sessionId?: string; documentId: string; revision: number };
    const latest = useDocumentUiStore.getState();
    if (projectionTickets.get(featureId) !== ticket || response.documentId !== context.documentId ||
        response.revision !== context.revision || response.projection.featureId !== featureId ||
        after.sessionId !== before.sessionId || after.documentId !== context.documentId || after.revision !== context.revision ||
        latest.documentId !== context.documentId || latest.revision !== context.revision || latest.epoch !== context.epoch ||
        latest.connectionGeneration !== context.connectionGeneration) return null;

    const projection = response.projection.geometryCurrent ? response.projection : {
      ...response.projection,
      groups: response.projection.groups.map(group => ({ ...group, edges: [] })),
    };
    latest.setProjectionView({ ...context, sessionId: before.sessionId, projection });
    return projection;
  } catch (error) {
    if (projectionTickets.get(featureId) === ticket) {
      const current = useDocumentUiStore.getState();
      if (current.documentId === context.documentId && current.epoch === context.epoch &&
          current.revision === context.revision && current.connectionGeneration === context.connectionGeneration)
        current.clearSketchProjection(featureId);
    }
    throw error;
  }
}

/** Consume direct 36/37 sketch state, then await ordered full snapshot sync. */
export async function syncSketchProjectionMutation(
  result: SketchProjectionMutation,
  documentId: string,
  epoch: number,
): Promise<void> {
  const state = useDocumentUiStore.getState();
  if (state.documentId !== documentId || state.epoch !== epoch || coreClient.documentId !== documentId || result.revision < state.revision) return;
  const model = { ...result.model, planeKind: result.planeKind, ...(result.plane ? { plane: result.plane } : {}), ...(result.supportRef !== undefined ? { supportRef: result.supportRef } : {}) };
  const sketch = state.sketches.find(item => item.featureId === result.featureId);
  state.setSketches([
    ...state.sketches.filter(item => item.featureId !== result.featureId),
    {
      ...sketch,
      featureId: result.featureId,
      planeKind: result.planeKind,
      plane: result.plane,
      supportRef: result.supportRef,
      points: model.points.length,
      lines: model.lines.length,
      circles: model.circles.length,
      constraints: model.constraints.length,
      projectionGroups: result.projectionGroups,
      geometryCurrent: result.geometryCurrent,
      status: result.status,
      error: result.error,
      blockingSourceIds: result.blockingSourceIds,
      model,
    },
  ], result.revision, epoch);
  state.clearSketchProjection(result.featureId);
  if (refreshOpenedSession) await refreshOpenedSession();
  else {
    const snapshot = await coreClient.requestSnapshot();
    await syncFromCoreList(snapshot.features, snapshot.revision, snapshot.sketches, null, snapshot.datums);
  }
}

/** Re-request + store the mesh for one feature at the given core revision. */
export async function pullFeatureMesh(
  featureId: string,
  revision: number,
): Promise<void> {
  const s = useDocumentUiStore.getState();
  const mesh = await coreClient.requestMesh(featureId, 1);
  useDocumentUiStore
    .getState()
    .upsertMesh(featureId, mesh, revision, s.epoch);
}

/** Replace a feature summary entry after a committed parameter edit. */
export function updateFeatureSummary(
  featureId: string,
  patch: {
    paramsMm?: number[];
    dependsOn?: string[];
    refExtra?: string;
    expressions?: Record<string, string>;
    volumeMm3?: number;
  },
  revision: number,
): void {
  const s = useDocumentUiStore.getState();
  s.setFeatures(
    s.features.map((f) =>
      f.featureId === featureId ? { ...f, ...patch } : f,
    ),
    revision,
  );
}

/**
 * Full rehydrate from a canonical feature list (open/undo/redo, §51):
 * replaces summaries + meshes wholesale so deleted features vanish too.
 * Sketches sync as summaries (full models pulled lazily by the editor).
 *
 * Slice 4 tip-only scene: summaries commit for EVERY feature (history +
 * recompute need them), but meshes hydrate ONLY for visible ids (body tips
 * + Instance occurrences). One Box→Hole→Fillet = 1 scene object; the
 * viewport reconciles the rest away (no ghosts on undo/redo tip steps).
 *
 * Split-brain rule (C4): summaries commit FIRST, then meshes best-effort —
 * a failed pull must never leave core-new/renderer-old. Missing meshes
 * simply don't render (the viewport skips absent ids); the collected error
 * still surfaces so callers can retry or report.
 */
export async function syncFromCoreList(
  features: FeatureSummary[],
  revision: number,
  sketches: SketchSummary[] = [],
  changedMeshIds: readonly string[] | null = null,
  datums: DatumDescriptor[] | null = null,
): Promise<void> {
  // Native Undo/Redo returns counts only. Use the session's ordered full-model
  // refresh instead of replacing a supported sketch cache with an empty model.
  if (refreshOpenedSession && sketches.some(sketch => !sketch.model)) {
    await refreshOpenedSession();
    return;
  }
  const s = useDocumentUiStore.getState();
  const epoch = s.epoch;
  s.setFeatures(features, revision, epoch);
  if(datums !== null)s.setDatums(datums,revision,epoch);
  s.setSketches(
    sketches.map((k) => {
      const cached = k.model as (typeof k.model & {
        plane?: SketchSummary["plane"];
        supportRef?: string;
      }) | undefined;
      const plane = k.plane ?? cached?.plane;
      const supportRef = k.supportRef !== undefined ? k.supportRef : cached?.supportRef;
      return {
        featureId: k.featureId,
        planeKind: k.planeKind,
        points: k.points,
        lines: k.lines,
        circles: k.circles,
        constraints: k.constraints,
        ...(k.projectionGroups !== undefined ? { projectionGroups: k.projectionGroups } : {}),
        geometryCurrent: k.geometryCurrent,
        status: k.status,
        error: k.error,
        blockingSourceIds: k.blockingSourceIds,
        ...(k.model ? { model: {
          ...k.model,
          planeKind: k.planeKind,
          ...(plane !== undefined ? { plane } : {}),
          ...(supportRef !== undefined ? { supportRef } : {}),
        } } : {}),
        ...(plane !== undefined ? { plane } : {}),
        ...(supportRef !== undefined ? { supportRef } : {}),
      };
    }),
    revision,
    epoch,
  );
  // Bounded-parallel hydration: mesh round-trips are independent, so one
  // round-trip per VISIBLE feature (tips only) runs concurrently (6 lanes —
  // enough to saturate local IPC without bursting the sidecar). Per-feature
  // errors collected — fail-fast would strand the summaries behind (C4).
  // Historical meshes stay core-side, pulled on demand.
  // Persisted documents can contain broken dependents whose native feature
  // summaries intentionally omit volume and geometry. Keep their history in
  // the model tree, but do not request or retain a stale viewport mesh.
  const unavailable = new Set(features.filter(feature =>
    feature.geometryCurrent === false || feature.status === "unavailable").map(feature => feature.featureId));
  const visible = visibleFeatureIds(features).filter(id => !unavailable.has(id));
  const changed = changedMeshIds === null ? null : new Set(changedMeshIds);
  const hydrate = visible.filter((id) => changed === null || changed.has(id) || !s.meshes[id]);
  // Only retained unchanged buffers are valid while changed geometry hydrates.
  // Their native creation revision may precede this document revision.
  const retained = changed === null ? {} : Object.fromEntries(
    visible.filter(id => !changed.has(id) && s.meshes[id]).map(id => [id, s.meshes[id]!]));
  s.replaceAllMeshes(retained, revision, epoch);
  const results: (
    | { ok: true; id: string; mesh: Awaited<ReturnType<typeof coreClient.requestMesh>> }
    | { ok: false; id: string; error: string }
  )[] = new Array(hydrate.length);
  const LANES = 6;
  let cursor = 0;
  async function lane(): Promise<void> {
    while (cursor < hydrate.length) {
      const i = cursor++;
      const id = hydrate[i]!;
      try {
        results[i] = { ok: true, id, mesh: await coreClient.requestMesh(id, 1) };
      } catch (e) {
        results[i] = { ok: false, id, error: e instanceof Error ? e.message : "mesh failed" };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(LANES, hydrate.length) }, lane));
  const meshes: Record<string, Parameters<typeof s.upsertMesh>[1]> = { ...retained };
  const failed: string[] = [];
  for (const r of results) {
    if (r.ok) meshes[r.id] = r.mesh;
    else failed.push(`${r.id}: ${r.error}`);
  }
  useDocumentUiStore.getState().replaceAllMeshes(meshes, revision, epoch);
  if (failed.length > 0) {
    throw new Error(
      `Hydrated ${results.length - failed.length}/${results.length} meshes: ${failed.join("; ")}`,
    );
  }
  // Drop selections pointing at features that no longer exist (solids AND
  // sketches — sketch nouns select by bare UUID too, §26).
  const current = useDocumentUiStore.getState();
  if (current.epoch !== epoch || current.revision !== revision) return;
  const alive = new Set([
    ...features.map((f) => f.featureId),
    ...sketches.map((k) => k.featureId),
    ...(datums ?? current.datums).map(datum => datum.featureId),
  ]);
  const sel = useSelectionStore.getState();
  const kept = sel.selectedIds.filter((id) => {
    const cut = id.indexOf(":");
    return alive.has(cut < 0 ? id : id.slice(0, cut));
  });
  if (kept.length !== sel.selectedIds.length) {
    sel.clear();
    for (const id of kept) sel.select(id, true);
  }
}
