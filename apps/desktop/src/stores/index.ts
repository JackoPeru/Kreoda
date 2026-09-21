// Zustand stores by concern (§35). Never one giant store.
// Renderer owns UI/camera/selection state + read-only summaries (§9).

import { create } from "zustand";
import type { CoreMeshData, SketchModel } from "@kreoda/protocol";
import type { FeatureSummary, SketchSummary } from "../ipc/coreClient";

export interface SketchEntry extends SketchSummary {
  model?: SketchModel & { planeKind?: string };
}

export interface ModelTreeItem {
  id: string;
  name: string;
  kind: "body" | "feature" | "sketch";
  children?: ModelTreeItem[];
}

/**
 * Slice 4: Body/Feature projection (renderer mirror of core BodyStore,
 * native/kreoda-core/src/model/body.h — same rule, no core wire change:
 * no IPC response carries a bodies section, only manifest.json inside the
 * .icad file does; BodiesMatchRecords enforces tip == history.back() in
 * every valid state, so this deterministic derivation EQUALS the
 * authoritative model. One Box→Hole→Fillet = 1 body, tip = visible result.
 */
export interface BodyInfo {
  bodyId: string;
  history: string[];
  tipFeatureId: string;
}

/** Central feature→body semantics table (mirrors FeatureBodySemantics). */
export function featureBodySemantics(
  type: string,
): "new" | "advances" | "none" {
  if (
    type === "Hole" ||
    type === "HolePattern" || // Slice 5: one cumulative record, same advance
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

export function bodyIdForRoot(rootFeatureId: string): string {
  return `body-${rootFeatureId}`;
}

/** Deterministic grouping in creation order (mirrors rebuildFromRecords). */
export function buildBodies(features: FeatureSummary[]): BodyInfo[] {
  const bodies: BodyInfo[] = [];
  const memberOf = (id: string): BodyInfo | undefined =>
    bodies.find((b) => b.history.includes(id));
  for (const f of features) {
    const sem = featureBodySemantics(f.type);
    if (sem === "none" || memberOf(f.featureId)) continue;
    if (sem === "new") {
      bodies.push({
        bodyId: bodyIdForRoot(f.featureId),
        history: [f.featureId],
        tipFeatureId: f.featureId,
      });
      continue;
    }
    // AdvancesBody: join the deps[0] target's body; missing target roots a
    // fresh body so every solid feature belongs to exactly one body.
    const target = f.dependsOn[0];
    const owner = target !== undefined ? memberOf(target) : undefined;
    if (owner) {
      owner.history.push(f.featureId);
      owner.tipFeatureId = f.featureId;
    } else {
      bodies.push({
        bodyId: bodyIdForRoot(f.featureId),
        history: [f.featureId],
        tipFeatureId: f.featureId,
      });
    }
  }
  return bodies;
}

/**
 * Renderable feature ids: body tips plus NonBody solids with their own mesh
 * (Instance assembly occurrences, Phase 9d). Sketches render as overlays,
 * never B-Rep meshes. Historical (non-tip) features keep their summaries
 * for history/recompute but never enter the scene map.
 */
export function visibleFeatureIds(features: FeatureSummary[]): string[] {
  const ids = buildBodies(features).map((b) => b.tipFeatureId);
  for (const f of features) {
    if (f.type === "Instance") ids.push(f.featureId);
  }
  return ids;
}

interface DocumentUiState {
  documentId: string;
  revision: number;
  /** Bumped on every document reset; stale async sets carry the old one. */
  epoch: number;
  coreRunning: boolean;
  coreVersion: string | null;
  /** Read-only projection of canonical features (§9). */
  features: FeatureSummary[];
  /**
   * Slice 4: Body projection derived from features (see buildBodies).
   * Authoritative grouping — the tree and the tip-only scene map read this,
   * never a renderer-side regrouping.
   */
  bodies: BodyInfo[];
  /** Sketches (2D, rendered as overlay — never B-Rep meshes). */
  sketches: SketchEntry[];
  /** Render buffers keyed by feature UUID — replaced wholesale per update. */
  meshes: Record<string, CoreMeshData>;
  meshRevision: number;
  undos: number;
  redos: number;
  setUndoDepth: (undos: number, redos: number) => void;
  setCoreStatus: (running: boolean, version?: string | null) => void;
  setFeatures: (
    features: FeatureSummary[],
    revision: number,
    epoch?: number,
  ) => void;
  setSketches: (sketches: SketchEntry[], revision?: number, epoch?: number) => void;
  upsertSketch: (sketch: SketchEntry) => void;
  upsertMesh: (
    featureId: string,
    mesh: CoreMeshData,
    revision: number,
    epoch?: number,
  ) => void;
  replaceAllMeshes: (
    meshes: Record<string, CoreMeshData>,
    revision: number,
    epoch?: number,
  ) => void;
  resetDocument: (documentId: string) => void;
}

function featureLabel(f: FeatureSummary): string {
  if (f.paramsMm.length > 0) return `${f.type} ${f.paramsMm.join("×")}`;
  if (f.dependsOn.length > 0) {
    return `${f.type} ← ${f.dependsOn.length} input${f.dependsOn.length > 1 ? "s" : ""}`;
  }
  return f.type;
}

function toTreeItems(
  features: FeatureSummary[],
  sketches: SketchEntry[],
  bodies: BodyInfo[],
): ModelTreeItem[] {
  const skItems = sketches.map((s) => ({
    id: s.featureId,
    name: `Sketch ${s.planeKind} (${s.points}p/${s.constraints}c)`,
    kind: "sketch" as const,
  }));
  const byId = new Map(features.map((f) => [f.featureId, f]));
  const covered = new Set<string>();
  const bodyItems: ModelTreeItem[] = bodies.map((b, i) => {
    for (const id of b.history) covered.add(id);
    // Single-root body: flat row exactly as before (no nesting noise).
    if (b.history.length === 1) {
      const f = byId.get(b.history[0]!);
      return {
        id: b.history[0]!,
        name: f ? featureLabel(f) : b.history[0]!,
        kind: "body" as const,
      };
    }
    return {
      id: b.bodyId,
      name: `Body ${i + 1}`,
      kind: "body" as const,
      children: b.history.map((id) => ({
        id,
        name: byId.get(id) ? featureLabel(byId.get(id)!) : id,
        kind: "feature" as const,
      })),
    };
  });
  // NonBody solids outside any body (Instance occurrences) keep flat rows.
  const extraItems = features
    .filter((f) => !covered.has(f.featureId))
    .map((f) => ({ id: f.featureId, name: featureLabel(f), kind: "body" as const }));
  return [...skItems, ...bodyItems, ...extraItems];
}

export const useDocumentUiStore = create<DocumentUiState>((set) => ({
  documentId: "doc-phase1",
  revision: 0,
  epoch: 0,
  coreRunning: false,
  coreVersion: null,
  features: [],
  bodies: [],
  sketches: [],
  meshes: {},
  meshRevision: 0,
  undos: 0,
  redos: 0,
  setUndoDepth: (undos, redos) => set({ undos, redos }),
  setCoreStatus: (running, version = null) =>
    set({ coreRunning: running, coreVersion: version ?? null }),
  // Staleness guards (C5): async hydrations race (open/autosave/undo).
  // A set carrying an older revision — or an epoch from before a document
  // reset — is dropped instead of overwriting newer state.
  setFeatures: (features, revision, epoch) =>
    set((s) => {
      if (epoch !== undefined && epoch !== s.epoch) return s;
      if (revision < s.revision) return s;
      const bodies = buildBodies(features);
      // Tip swap without ghosts (Slice 4): a superseded tip's mesh leaves
      // the scene map the moment the model moves on (undo/redo tip steps
      // update the rendered object the same way). History summaries stay —
      // only render buffers are pruned.
      const visible = new Set<string>(bodies.map((b) => b.tipFeatureId));
      for (const f of features) {
        if (f.type === "Instance") visible.add(f.featureId);
      }
      let meshes = s.meshes;
      if (Object.keys(meshes).some((id) => !visible.has(id))) {
        meshes = Object.fromEntries(
          Object.entries(meshes).filter(([id]) => visible.has(id)),
        );
      }
      return {
        features,
        revision,
        bodies,
        ...(meshes !== s.meshes
          ? { meshes, meshRevision: s.meshRevision + 1 }
          : {}),
      };
    }),
  setSketches: (sketches, revision, epoch) =>
    set((s) => {
      if (epoch !== undefined && epoch !== s.epoch) return s;
      if (revision !== undefined && revision < s.revision) return s;
      return { sketches };
    }),
  upsertSketch: (sketch) =>
    set((s) => ({
      sketches: [
        ...s.sketches.filter((x) => x.featureId !== sketch.featureId),
        sketch,
      ],
    })),
  upsertMesh: (featureId, mesh, revision, epoch) =>
    set((s) => {
      if (epoch !== undefined && epoch !== s.epoch) return s;
      // The mesh carries its own core revision: an older mesh must never
      // overwrite a newer document (C5).
      if (mesh.revision < s.revision || revision < s.revision) return s;
      return {
        meshes: { ...s.meshes, [featureId]: mesh },
        meshRevision: s.meshRevision + 1,
        revision,
      };
    }),
  replaceAllMeshes: (meshes, revision, epoch) =>
    set((s) => {
      if (epoch !== undefined && epoch !== s.epoch) return s;
      if (revision < s.revision) return s;
      // Summaries are owned by setFeatures (authoritative list, always
      // committed first) — meshes only fill render buffers, so a partial
      // hydration never drops bodies from the tree (C4).
      return {
        meshes,
        meshRevision: s.meshRevision + 1,
        revision,
      };
    }),
  resetDocument: (documentId) =>
    set((s) => ({
      documentId,
      revision: 0,
      epoch: s.epoch + 1,
      features: [],
      bodies: [],
      sketches: [],
      meshes: {},
      meshRevision: 0,
    })),
}));

export function buildTreeItems(
  features: FeatureSummary[],
  sketches: SketchEntry[] = [],
  bodies: BodyInfo[] = buildBodies(features),
): ModelTreeItem[] {
  return toTreeItems(features, sketches, bodies);
}

export type SelectionMode =
  | "auto"
  | "body"
  | "face"
  | "edge"
  | "vertex"
  | "sketch";

interface SelectionState {
  mode: SelectionMode;
  selectedIds: string[];
  hoveredId: string | null;
  select: (id: string, additive: boolean) => void;
  hover: (id: string | null) => void;
  clear: () => void;
  setMode: (mode: SelectionMode) => void;
}

export type SelectionKind = "body" | "face" | "edge" | "sketch";

/** Id convention (§0.2): bare UUID = body OR sketch (store lookup decides);
 *  "uuid:role" = face; "uuid:edge…" = edge. */
export function selectionKindOf(id: string): SelectionKind {
  const cut = id.indexOf(":");
  if (cut < 0) return "body";
  return id.slice(cut + 1).startsWith("edge.") ? "edge" : "face";
}

/** Resolve a bare UUID against the sketch store (sketches select as nouns). */
export function isSketchId(id: string): boolean {
  const cut = id.indexOf(":");
  const bare = cut < 0 ? id : id.slice(0, cut);
  return useDocumentUiStore.getState().sketches.some((s) => s.featureId === bare);
}

export const useSelectionStore = create<SelectionState>((set) => ({
  mode: "auto",
  selectedIds: [],
  hoveredId: null,
  select: (id, additive) =>
    set((s) => ({
      selectedIds: additive
        ? s.selectedIds.includes(id)
          ? s.selectedIds.filter((x) => x !== id)
          : [...s.selectedIds, id]
        : [id],
    })),
  hover: (hoveredId) => set({ hoveredId }),
  clear: () => set({ selectedIds: [], hoveredId: null }),
  setMode: (mode) => set({ mode }),
}));

interface ToolState {
  activeTool: string;
  setTool: (t: string) => void;
}

export const useToolStore = create<ToolState>((set) => ({
  activeTool: "select",
  setTool: (activeTool) => set({ activeTool }),
}));

interface PrefsState {
  beginnerMode: boolean;
  toggleMode: () => void;
  /** Optional OpenAI-compatible endpoint for NL plans (§28, local-first). */
  llmEndpoint: string;
  llmModel: string;
  setLlm: (endpoint: string, model: string) => void;
}

/**
 * Read with one-time migration from pre-rename keys (dev-stage courtesy):
 * first launch after the rename carries `kreoda.*` forward and drops the
 * legacy `intentcad.*` entry, so endpoint/model survive the update.
 */
function storedString(newKey: string, oldKey: string): string {
  try {
    const current = localStorage.getItem(newKey);
    if (current !== null) return current;
    const legacy = localStorage.getItem(oldKey);
    if (legacy !== null) {
      localStorage.setItem(newKey, legacy);
      localStorage.removeItem(oldKey);
      return legacy;
    }
    return "";
  } catch {
    return "";
  }
}

function storedLlm(): { endpoint: string; model: string } {
  return {
    endpoint: storedString("kreoda.llmEndpoint", "intentcad.llmEndpoint"),
    model: storedString("kreoda.llmModel", "intentcad.llmModel"),
  };
}

const initialLlm = storedLlm();

export const usePreferencesStore = create<PrefsState>((set) => ({
  beginnerMode: true,
  toggleMode: () => set((s) => ({ beginnerMode: !s.beginnerMode })),
  llmEndpoint: initialLlm.endpoint,
  llmModel: initialLlm.model,
  setLlm: (endpoint, model) => {
    try {
      localStorage.setItem("kreoda.llmEndpoint", endpoint);
      localStorage.setItem("kreoda.llmModel", model);
    } catch {
      // Best-effort persistence.
    }
    set({ llmEndpoint: endpoint, llmModel: model });
  },
}));
