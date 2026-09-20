import { useState } from "react";
import { Box, Cylinder, Circle, CircleDot, Pencil, ArrowUpFromLine, Spline, Slice, Combine, Undo2, Redo2, Save, FolderOpen, Hand } from "lucide-react";
import { useToolStore, usePreferencesStore, useDocumentUiStore, useSelectionStore, isSketchId } from "../stores";
import { coreClient } from "../ipc/coreClient";
import { syncFromCoreList } from "../model/sync";
import {
  commandAvailability,
  executeCommand,
  visibleCommands,
} from "../commands/execute";
import type { PrimitiveKind } from "./AddPrimitiveDialog";
import { clearRecoveryAfterSave } from "../recovery/autosave";
import { recordEvent } from "../telemetry/events";

const ICONS: Record<string, React.ReactNode> = {
  box: <Box size={16} />,
  cylinder: <Cylinder size={16} />,
  circle: <Circle size={16} />,
  "circle-dot": <CircleDot size={16} />,
  pencil: <Pencil size={16} />,
  "arrow-up-from-line": <ArrowUpFromLine size={16} />,
  spline: <Spline size={16} />,
  slice: <Slice size={16} />,
  combine: <Combine size={16} />,
};

/** Beginner toolbar (§24): rendered from the command registry (§19). */
export function Toolbar({
  onAdd,
  onSketch,
  onExtrude,
  onHole,
  onDressUp,
}: {
  onAdd: (kind: PrimitiveKind) => void;
  onSketch: () => void;
  onExtrude: () => void;
  onHole: () => void;
  onDressUp: (kind: "fillet" | "chamfer") => void;
}) {
  const { activeTool, setTool } = useToolStore();
  const { beginnerMode, toggleMode } = usePreferencesStore();
  const features = useDocumentUiStore((s) => s.features);
  const undos = useDocumentUiStore((s) => s.undos);
  const redos = useDocumentUiStore((s) => s.redos);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const [opError, setOpError] = useState<string | null>(null);
  const pickMode = useSelectionStore((s) => s.mode);
  const setPickMode = useSelectionStore((s) => s.setMode);

  // Registry-driven add buttons: one definition for toolbar, palette, AI.
  const adds = visibleCommands().filter((c) =>
    ["CreateBox", "CreateCylinder", "CreateSphere"].includes(c.id),
  );
  const sketchCmds = visibleCommands().filter((c) =>
    ["CreateSketch", "CreateExtrude"].includes(c.id),
  );
  const solidCmds = visibleCommands().filter((c) =>
    ["CreateHole", "CreateFillet", "CreateChamfer", "CreateBoolean"].includes(
      c.id,
    ),
  );

  const runAdd = (commandId: string): void => {
    setOpError(null);
    if (commandId === "CreateBox") {
      setTool("box");
      onAdd("box");
    } else if (commandId === "CreateCylinder") {
      setTool("cylinder");
      onAdd("cylinder");
    } else if (commandId === "CreateSphere") {
      setTool("sphere");
      onAdd("sphere");
    } else if (commandId === "CreateHole") {
      onHole();
    } else if (commandId === "CreateFillet") {
      onDressUp("fillet");
    } else if (commandId === "CreateChamfer") {
      onDressUp("chamfer");
    }
  };

  const runBoolean = async (op: "fuse" | "cut" | "common"): Promise<void> => {
    setOpError(null);
    try {
      // First two selected solids: first = target, second = tool (§20).
      const bodies = selectedIds.filter(
        (id) => !id.includes(":") && !isSketchId(id),
      );
      if (bodies.length < 2) throw new Error("Select two solids first");
      await executeCommand("CreateBoolean", {
        op,
        targetId: bodies[0],
        toolId: bodies[1],
      });
    } catch (e) {
      setOpError(e instanceof Error ? e.message : "boolean failed");
    }
  };

  const runUndo = async (kind: "Undo" | "Redo"): Promise<void> => {
    setOpError(null);
    try {
      await executeCommand(kind, {});
    } catch (e) {
      setOpError(e instanceof Error ? e.message : `${kind} failed`);
    }
  };

  const save = async (): Promise<void> => {
    setOpError(null);
    try {
      const path = await window.intentcad.saveDialog("project.icad");
      if (!path) return;
      await coreClient.saveDocument(path);
      recordEvent("document_saved", {});
      // Explicit save supersedes the crash snapshot (Phase 8 recovery).
      await clearRecoveryAfterSave();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : "save failed");
    }
  };

  const open = async (): Promise<void> => {
    setOpError(null);
    try {
      const path = await window.intentcad.openDialog();
      if (!path) return;
      const { features: list, sketches, revision } =
        await coreClient.openDocument(path);
      // Document replacement = new epoch (C5): core revisions reset.
      useDocumentUiStore.getState().resetDocument(coreClient.documentId);
      await syncFromCoreList(list, revision, sketches);
      recordEvent("document_opened", {});
      await syncFromCoreList(list, revision, sketches);
    } catch (e) {
      setOpError(e instanceof Error ? e.message : "open failed");
    }
  };

  return (
    <div className="flex items-center gap-1 border-b border-white/10 bg-[#11151c] px-3 py-2">
      <img
        src="kreoda-mark.png"
        alt="Kreoda"
        title="Kreoda"
        className="mr-1 h-6 w-6 rounded-sm"
      />
      <span className="mr-2 text-sm font-semibold">+ Add</span>
      {adds.map((c) => {
        const avail = commandAvailability(c.id);
        const label = beginnerMode ? c.beginnerLabel : c.label;
        return (
          <button
            key={c.id}
            onClick={() => runAdd(c.id)}
            disabled={!avail.available}
            title={avail.available ? c.description : (avail.reason ?? c.description)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 ${activeTool === c.id ? "bg-white/15" : ""}`}
          >
            {ICONS[c.icon] ?? <Box size={16} />}
            {label}
          </button>
        );
      })}
      <button
        onClick={() => setTool(activeTool === "pull" ? "select" : "pull")}
        title="Pull a face to resize the solid (drag along its normal)"
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm hover:bg-white/10 ${activeTool === "pull" ? "bg-white/15" : ""}`}
      >
        <Hand size={16} />
        Pull
      </button>
      {sketchCmds.map((c) => {
        const avail = commandAvailability(c.id);
        const label = beginnerMode ? c.beginnerLabel : c.label;
        return (
          <button
            key={c.id}
            onClick={() => {
              setOpError(null);
              if (c.id === "CreateSketch") onSketch();
              else onExtrude();
            }}
            disabled={!avail.available}
            title={avail.available ? c.description : (avail.reason ?? c.description)}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {ICONS[c.icon] ?? <Pencil size={16} />}
            {label}
          </button>
        );
      })}
      {solidCmds.map((c) => {
        const avail = commandAvailability(c.id);
        const label = beginnerMode ? c.beginnerLabel : c.label;
        if (c.id === "CreateBoolean") return null; // separate op buttons below
        return (
          <button
            key={c.id}
            onClick={() => runAdd(c.id)}
            disabled={!avail.available}
            title={avail.available ? c.description : (avail.reason ?? c.description)}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {ICONS[c.icon] ?? <Box size={16} />}
            {label}
          </button>
        );
      })}
      <div className="flex items-center gap-0.5 rounded-md border border-white/10 px-1" title="Combine two selected solids (first = target)">
        {(
          [
            ["fuse", "Combine"],
            ["cut", "Subtract"],
            ["common", "Overlap"],
          ] as const
        ).map(([op, label]) => (
          <button
            key={op}
            onClick={() => void runBoolean(op)}
            className="rounded px-1.5 py-0.5 text-[11px] text-white/60 hover:bg-white/10 hover:text-white"
          >
            {label}
          </button>
        ))}
        {selectedIds.filter((id) => !id.includes(":") && !isSketchId(id))
          .length >= 2 && (
          <span className="max-w-40 truncate px-1 text-[10px] text-white/40" title="target → tool">
            {selectedIds.filter((id) => !id.includes(":") && !isSketchId(id))[0]!.slice(0, 8)}→
            {selectedIds.filter((id) => !id.includes(":") && !isSketchId(id))[1]!.slice(0, 8)}
          </span>
        )}
      </div>
      <div className="mx-2 h-5 w-px bg-white/10" />
      <button
        onClick={() => void runUndo("Undo")}
        disabled={undos === 0}
        className="rounded-md p-1.5 hover:bg-white/10 disabled:opacity-40"
        title={undos === 0 ? "Nothing to undo" : `Undo (${undos})`}
      >
        <Undo2 size={16} />
      </button>
      <button
        onClick={() => void runUndo("Redo")}
        disabled={redos === 0}
        className="rounded-md p-1.5 hover:bg-white/10 disabled:opacity-40"
        title={redos === 0 ? "Nothing to redo" : `Redo (${redos})`}
      >
        <Redo2 size={16} />
      </button>
      <div className="mx-2 h-5 w-px bg-white/10" />
      <button onClick={() => void save()} className="rounded-md p-1.5 hover:bg-white/10" title="Save .icad, export STEP/3MF/STL/OBJ/glTF (pick in dialog)">
        <Save size={16} />
      </button>
      <button onClick={() => void open()} className="rounded-md p-1.5 hover:bg-white/10" title="Open .icad, import STEP/3MF/STL/OBJ/glTF">
        <FolderOpen size={16} />
      </button>
      {features.length > 0 && (
        <span className="pl-2 text-xs text-white/45">{features.length} solid{features.length > 1 ? "s" : ""}</span>
      )}
      {selectedIds.length > 0 && (
        <span className="max-w-64 truncate pl-1 text-xs text-amber-200/80" title={selectedIds.join(", ")}>
          {selectedIds.length} selected
        </span>
      )}
      <div className="mx-2 flex h-5 items-center gap-0.5 rounded-md border border-white/10 px-1" title="Selection filter (§16)">
        {(["auto", "body", "face", "edge"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setPickMode(m)}
            className={`rounded px-1.5 py-0.5 text-[11px] capitalize ${pickMode === m ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80"}`}
          >
            {m}
          </button>
        ))}
      </div>
      {opError && (
        <span className="max-w-72 truncate pl-2 text-xs text-red-300" title={opError}>
          {opError}
        </span>
      )}
      <div className="flex-1" />
      <button
        onClick={toggleMode}
        className="rounded-md border border-white/15 px-2 py-1 text-xs text-white/80 hover:bg-white/10"
      >
        {beginnerMode ? "Simple" : "Advanced"}
      </button>
    </div>
  );
}
