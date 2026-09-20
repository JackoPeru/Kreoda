// Zustand stores by concern (§35). Never one giant store.
// Renderer owns UI/camera/selection state + read-only ModelProjection (§9).

import { create } from "zustand";
import type { CoreMeshData, SketchModel } from "@intentcad/protocol";
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

export interface ModelProjection {
  documentId: string;
  revision: number;
  rootItems: ModelTreeItem[];
}

interface DocumentUiState {
  documentId: string;
  revision: number;
  /** Bumped on every document reset; stale async sets carry the old one. */
  epoch: number;
  projection: ModelProjection | null;
  coreRunning: boolean;
  coreVersion: string | null;
  /** Read-only projection of canonical features (§9). */
  features: FeatureSummary[];
  /** Sketches (2D, rendered as overlay — never B-Rep meshes). */
  sketches: SketchEntry[];
  /** Render buffers keyed by feature UUID — replaced wholesale per update. */
  meshes: Record<string, CoreMeshData>;
  meshRevision: number;
  undos: number;
  redos: number;
  setUndoDepth: (undos: number, redos: number) => void;
  applyDelta: (delta: {
    revision: number;
    added: unknown[];
    updated: unknown[];
  }) => void;
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

function toTreeItems(
  features: FeatureSummary[],
  sketches: SketchEntry[],
): ModelTreeItem[] {
  const skItems = sketches.map((s) => ({
    id: s.featureId,
    name: `Sketch ${s.planeKind} (${s.points}p/${s.constraints}c)`,
    kind: "sketch" as const,
  }));
  const bodyItems = features.map((f) => ({
    id: f.featureId,
    name:
      f.paramsMm.length > 0
        ? `${f.type} ${f.paramsMm.join("×")}`
        : f.dependsOn.length > 0
          ? `${f.type} ← ${f.dependsOn.length} input${f.dependsOn.length > 1 ? "s" : ""}`
          : f.type,
    kind: "body" as const,
  }));
  return [...skItems, ...bodyItems];
}

export const useDocumentUiStore = create<DocumentUiState>((set) => ({
  documentId: "doc-phase1",
  revision: 0,
  epoch: 0,
  projection: null,
  coreRunning: false,
  coreVersion: null,
  features: [],
  sketches: [],
  meshes: {},
  meshRevision: 0,
  undos: 0,
  redos: 0,
  setUndoDepth: (undos, redos) => set({ undos, redos }),
  applyDelta: () => set((s) => ({ revision: s.revision })),
  setCoreStatus: (running, version = null) =>
    set({ coreRunning: running, coreVersion: version ?? null }),
  // Staleness guards (C5): async hydrations race (open/autosave/undo).
  // A set carrying an older revision — or an epoch from before a document
  // reset — is dropped instead of overwriting newer state.
  setFeatures: (features, revision, epoch) =>
    set((s) => {
      if (epoch !== undefined && epoch !== s.epoch) return s;
      if (revision < s.revision) return s;
      return { features, revision, projection: null };
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
      sketches: [],
      meshes: {},
      meshRevision: 0,
      projection: null,
    })),
}));

export function buildTreeItems(
  features: FeatureSummary[],
  sketches: SketchEntry[] = [],
): ModelTreeItem[] {
  return toTreeItems(features, sketches);
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
  units: "mm" | "cm" | "m" | "inch";
  toggleMode: () => void;
  setUnits: (u: PrefsState["units"]) => void;
  /** Optional OpenAI-compatible endpoint for NL plans (§28, local-first). */
  llmEndpoint: string;
  llmModel: string;
  setLlm: (endpoint: string, model: string) => void;
  /**
   * Usage telemetry (§61): explicit opt-in, default OFF. No collection
   * backend is wired — enabling records into a local bounded queue only.
   */
  telemetryEnabled: boolean;
  setTelemetry: (enabled: boolean) => void;
}

function storedLlm(): { endpoint: string; model: string } {
  try {
    return {
      endpoint: localStorage.getItem("intentcad.llmEndpoint") ?? "",
      model: localStorage.getItem("intentcad.llmModel") ?? "",
    };
  } catch {
    return { endpoint: "", model: "" };
  }
}

function storedTelemetry(): boolean {
  try {
    return localStorage.getItem("intentcad.telemetry") === "1";
  } catch {
    return false;
  }
}

const initialLlm = storedLlm();

export const usePreferencesStore = create<PrefsState>((set) => ({
  beginnerMode: true,
  units: "mm",
  toggleMode: () => set((s) => ({ beginnerMode: !s.beginnerMode })),
  setUnits: (units) => set({ units }),
  llmEndpoint: initialLlm.endpoint,
  llmModel: initialLlm.model,
  setLlm: (endpoint, model) => {
    try {
      localStorage.setItem("intentcad.llmEndpoint", endpoint);
      localStorage.setItem("intentcad.llmModel", model);
    } catch {
      // Best-effort persistence.
    }
    set({ llmEndpoint: endpoint, llmModel: model });
  },
  telemetryEnabled: storedTelemetry(),
  setTelemetry: (enabled) => {
    try {
      localStorage.setItem("intentcad.telemetry", enabled ? "1" : "0");
    } catch {
      // Best-effort persistence.
    }
    set({ telemetryEnabled: enabled });
  },
}));
