// Canonical → renderer sync (§66): pull binary meshes for committed state.
// Preview meshes (§13) intentionally bypass the store — they never commit.

import {
  coreClient,
  type FeatureSummary,
  type SketchSummary,
} from "../ipc/coreClient";
import {
  useDocumentUiStore,
  useSelectionStore,
  visibleFeatureIds,
} from "../stores";

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
): Promise<void> {
  const s = useDocumentUiStore.getState();
  const epoch = s.epoch;
  s.setFeatures(features, revision, epoch);
  s.setSketches(
    sketches.map((k) => ({
      featureId: k.featureId,
      planeKind: k.planeKind,
      points: k.points,
      lines: k.lines,
      circles: k.circles,
      constraints: k.constraints,
      ...(k.model ? { model: k.model } : {}),
    })),
    revision,
    epoch,
  );
  // Bounded-parallel hydration: mesh round-trips are independent, so one
  // round-trip per VISIBLE feature (tips only) runs concurrently (6 lanes —
  // enough to saturate local IPC without bursting the sidecar). Per-feature
  // errors collected — fail-fast would strand the summaries behind (C4).
  // Historical meshes stay core-side, pulled on demand.
  const visible = visibleFeatureIds(features);
  const changed = changedMeshIds === null ? null : new Set(changedMeshIds);
  const hydrate = visible.filter((id) => changed === null || changed.has(id) || !s.meshes[id]);
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
  const meshes: Record<string, Parameters<typeof s.upsertMesh>[1]> = changed === null ? {} :
    Object.fromEntries(visible.filter((id) => !changed.has(id) && s.meshes[id]).map((id) => [id, s.meshes[id]!]));
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
