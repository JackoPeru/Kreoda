import { commandAvailability } from "../commands/execute";
import { executeCommand } from "../commands/execute";
import {
  connectedEdgeIds,
  similarFaceIds,
} from "../interaction/selectSimilar";
import {
  isSketchId,
  selectionKindOf,
  useDocumentUiStore,
  useSelectionStore,
  useToolStore,
} from "../stores";

/**
 * Context-sensitive tools (§18, §69): exposes ONLY actions valid for the
 * current selection. Candidate actions per selection kind are the only
 * UI-side table — availability itself comes from the command registry
 * (same definitions gating toolbar, palette and AI tools).
 */
export function ContextToolbar({
  onHole,
  onDressUp,
  onSketch,
  onExtrude,
}: {
  onHole: () => void;
  onDressUp: (kind: "fillet" | "chamfer") => void;
  onSketch: () => void;
  onExtrude: () => void;
}) {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const activeTool = useToolStore((s) => s.activeTool);
  const setTool = useToolStore((s) => s.setTool);
  // Re-render trigger for registry reads touching the sketch store (M12):
  // availability is computed live at render/click from getState().
  useDocumentUiStore((s) => s.sketches.length);
  useDocumentUiStore((s) => s.features.length);

  const kinds = new Set(selectedIds.map(selectionKindOf));
  const candidates: { id: string; label: string; hint: string }[] = [];
  if (kinds.has("face")) {
    candidates.push(
      { id: "PullFace", label: "Pull face", hint: "Drag along its normal" },
      { id: "CreateHole", label: "Hole", hint: "Cut a hole here" },
      { id: "CreateSketch", label: "Sketch here", hint: "Draw on this plane" },
    );
  }
  if (kinds.has("edge")) {
    candidates.push(
      { id: "CreateFillet", label: "Round", hint: "Round selected edges" },
      { id: "CreateChamfer", label: "Corner", hint: "Chamfer selected edges" },
    );
  }
  if (
    selectedIds.some((id) => {
      const cut = id.indexOf(":");
      return cut < 0;
    })
  ) {
    // Bare-UUID nouns (bodies AND sketches share the form): offer extrude
    // only when the registry agrees (sketch selected).
    if (commandAvailability("CreateExtrude").available) {
      candidates.push({
        id: "CreateExtrude",
        label: "Pull sketch",
        hint: "Extrude into a solid",
      });
    }
  }
  // Bulk selection helpers (§16): similar faces / connected edges.
  if (kinds.has("face") && selectedIds.length === 1) {
    candidates.push({
      id: "SelectSimilar",
      label: "Similar",
      hint: "Select parallel faces of the same class",
    });
  }
  if (kinds.has("edge") && selectedIds.length === 1) {
    candidates.push({
      id: "SelectConnected",
      label: "Connected",
      hint: "Select the connected edge chain",
    });
  }
  // Combine entry point where the user looks (M4): two selected solids.
  const booleanAvail = commandAvailability("CreateBoolean");
  if (booleanAvail.available) {
    candidates.push({
      id: "ContextBoolean",
      label: "Combine…",
      hint: "Combine the two selected solids (choose op)",
    });
  }
  if (candidates.length === 0) return null;

  const selectLiveIds = (ids: string[]): void => {
    // Drop ids whose body vanished (e.g. post-undo stale mesh).
    const meshes = useDocumentUiStore.getState().meshes;
    const live = ids.filter((id) => {
      const cut = id.indexOf(":");
      return cut >= 0 && cut < id.length - 1 && id.slice(0, cut) in meshes;
    });
    const sel = useSelectionStore.getState();
    sel.clear();
    for (const fid of live.length > 0 ? live : ids.slice(0, 1)) {
      sel.select(fid, true);
    }
  };

  const run = (id: string): void => {
    if (id === "PullFace") setTool(activeTool === "pull" ? "select" : "pull");
    else if (id === "CreateHole") onHole();
    else if (id === "CreateFillet") onDressUp("fillet");
    else if (id === "CreateChamfer") onDressUp("chamfer");
    else if (id === "CreateSketch") onSketch();
    else if (id === "CreateExtrude") onExtrude();
    else if (id === "SelectSimilar") {
      const faceId = selectedIds[0]!;
      const meshes = useDocumentUiStore.getState().meshes;
      selectLiveIds(similarFaceIds(meshes, faceId));
    } else if (id === "SelectConnected") {
      const edgeId = selectedIds[0]!;
      const meshes = useDocumentUiStore.getState().meshes;
      selectLiveIds(connectedEdgeIds(meshes, edgeId));
    } else if (id === "ContextBoolean") {
      // Default to fuse; cut/common live in the main toolbar cluster.
      const bodies = selectedIds.filter(
        (sid) => !sid.includes(":") && !isSketchId(sid),
      );
      if (bodies.length >= 2) {
        void executeCommand("CreateBoolean", {
          op: "fuse",
          targetId: bodies[0],
          toolId: bodies[1],
        });
      }
    }
  };

  const isAvailable = (id: string): boolean => {
    if (
      id === "PullFace" ||
      id === "SelectSimilar" ||
      id === "SelectConnected" ||
      id === "ContextBoolean"
    ) {
      return true;
    }
    return commandAvailability(id).available;
  };

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-white/10 bg-black/70 px-2 py-1"
      data-testid="context-toolbar"
    >
      {candidates.map((c) => (
        <button
          key={c.id}
          onClick={() => run(c.id)}
          disabled={!isAvailable(c.id)}
          title={c.hint}
          className={`rounded-md px-2.5 py-1.5 text-xs hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 ${c.id === "PullFace" && activeTool === "pull" ? "bg-white/15 text-white" : "text-white/85"}`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
