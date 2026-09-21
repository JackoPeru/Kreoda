// UX-1 top dock: project chip | Add + Sketch + More | Undo/Redo/Save.
// Only registry-backed actions appear; the Add popover lists primitives
// from the command registry (same definitions as toolbar/palette/AI).
import { useState } from "react";
import {
  Box,
  ChevronDown,
  Circle,
  Cylinder,
  Pencil,
  Plus,
} from "lucide-react";
import {
  isSketchId,
  usePreferencesStore,
  useDocumentUiStore,
  useSelectionStore,
  useToolStore,
} from "../../stores";
import {
  commandAvailability,
  executeCommand,
  visibleCommands,
} from "../../commands/execute";
import type { PrimitiveKind } from "../AddPrimitiveDialog";
import { ProjectChip } from "./ProjectChip";
import { WorkspaceActions, openDocument } from "./WorkspaceActions";

const PRIMITIVE_ICONS: Record<string, React.ReactNode> = {
  box: <Box size={16} />,
  cylinder: <Cylinder size={16} />,
  circle: <Circle size={16} />,
};

function commandToKind(id: string): PrimitiveKind {
  if (id === "CreateCylinder") return "cylinder";
  if (id === "CreateSphere") return "sphere";
  return "box";
}

const menuItemClass =
  "flex w-full items-center gap-2 rounded-[var(--kreoda-radius-sm)] px-2.5 py-1.5 text-left text-sm text-white/85 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";

function MenuHeader({ label }: { label: string }) {
  return (
    <div className="px-2.5 pb-0.5 pt-2 text-[10px] uppercase tracking-wide text-white/35">
      {label}
    </div>
  );
}

export function TopToolDock({
  onAdd,
  onSketch,
  onOpenProject,
  onToggleProps,
  onPlugins,
  onReference,
  onInstance,
}: {
  onAdd: (kind: PrimitiveKind) => void;
  onSketch: () => void;
  onOpenProject: () => void;
  onToggleProps: () => void;
  onPlugins: () => void;
  onReference: () => void;
  onInstance: () => void;
}) {
  const [open, setOpen] = useState<"add" | "more" | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const { beginnerMode, toggleMode } = usePreferencesStore();
  const { activeTool, setTool } = useToolStore();
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const pickMode = useSelectionStore((s) => s.mode);
  const setPickMode = useSelectionStore((s) => s.setMode);
  // Re-render trigger for registry reads (same as ContextToolbar, M12).
  useDocumentUiStore((s) => s.sketches.length);
  useDocumentUiStore((s) => s.features.length);

  const close = (): void => {
    setOpen(null);
  };

  const adds = visibleCommands().filter((c) =>
    ["CreateBox", "CreateCylinder", "CreateSphere"].includes(c.id),
  );

  const runBoolean = async (op: "fuse" | "cut" | "common"): Promise<void> => {
    setMenuError(null);
    try {
      const bodies = selectedIds.filter(
        (id) => !id.includes(":") && !isSketchId(id),
      );
      if (bodies.length < 2) throw new Error("Select two solids first");
      await executeCommand("CreateBoolean", {
        op,
        targetId: bodies[0],
        toolId: bodies[1],
      });
      close();
    } catch (e) {
      setMenuError(e instanceof Error ? e.message : "boolean failed");
    }
  };

  const runOpen = async (): Promise<void> => {
    const err = await openDocument();
    if (err) setMenuError(err);
    else close();
  };

  const instanceAvail = commandAvailability("CreateInstance");

  return (
    <>
      {open !== null && (
        <button
          aria-label="Close menu"
          onClick={close}
          className="pointer-events-auto fixed inset-0 z-40 cursor-default bg-transparent"
          tabIndex={-1}
        />
      )}
      <div
        className="kreoda-float pointer-events-auto relative z-50 flex max-w-full flex-wrap items-center gap-1 px-2 py-1.5"
        data-testid="workspace-topdock"
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
      >
      <ProjectChip onOpen={onOpenProject} />
      <div className="mx-1 h-5 w-px shrink-0 bg-white/10" />

      <div className="relative">
        <button
          onClick={() => {
            setMenuError(null);
            setOpen(open === "add" ? null : "add");
          }}
          aria-haspopup="menu"
          aria-expanded={open === "add"}
          className={`flex items-center gap-1.5 rounded-[var(--kreoda-radius-sm)] px-2.5 py-1.5 text-sm font-medium hover:bg-white/10 ${open === "add" ? "bg-white/15" : ""}`}
        >
          <Plus size={16} />
          Add
        </button>
        {open === "add" && (
          <div
            role="menu"
            data-testid="add-menu"
            className="kreoda-float-elevated absolute left-0 top-full z-50 mt-2 w-48 p-1.5"
          >
            {adds.map((c) => (
              <button
                key={c.id}
                role="button"
                onClick={() => {
                  setTool(commandToKind(c.id));
                  onAdd(commandToKind(c.id));
                  close();
                }}
                title={c.description}
                className={menuItemClass}
              >
                {PRIMITIVE_ICONS[c.icon] ?? <Box size={16} />}
                {beginnerMode ? c.beginnerLabel : c.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={onSketch}
        title="New constrained 2D sketch on a principal plane"
        className="flex items-center gap-1.5 rounded-[var(--kreoda-radius-sm)] px-2.5 py-1.5 text-sm hover:bg-white/10"
      >
        <Pencil size={16} />
        Sketch
      </button>

      <div className="relative">
        <button
          onClick={() => {
            setMenuError(null);
            setOpen(open === "more" ? null : "more");
          }}
          aria-haspopup="menu"
          aria-expanded={open === "more"}
          className={`flex items-center gap-1 rounded-[var(--kreoda-radius-sm)] px-2.5 py-1.5 text-sm text-white/80 hover:bg-white/10 ${open === "more" ? "bg-white/15" : ""}`}
        >
          More
          <ChevronDown size={14} />
        </button>
        {open === "more" && (
          <div
            role="menu"
            data-testid="more-menu"
            className="kreoda-float-elevated absolute left-0 top-full z-50 mt-2 max-h-[60vh] w-60 overflow-auto p-1.5"
          >
            <MenuHeader label="Model" />
            <button
              role="button"
              onClick={() => {
                setTool(activeTool === "pull" ? "select" : "pull");
                close();
              }}
              title="Pull a face to resize the solid (drag along its normal)"
              className={`${menuItemClass} ${activeTool === "pull" ? "bg-white/15" : ""}`}
            >
              Pull
            </button>
            <div className="my-1 h-px bg-white/10" />
            {(
              [
                ["fuse", "Combine"],
                ["cut", "Subtract"],
                ["common", "Overlap"],
              ] as const
            ).map(([op, label]) => (
              <button
                key={op}
                role="button"
                onClick={() => void runBoolean(op)}
                title="Combine two selected solids (first = target)"
                className={menuItemClass}
              >
                {label}
              </button>
            ))}
            <button
              role="button"
              onClick={() => {
                onInstance();
                close();
              }}
              disabled={!instanceAvail.available}
              title={
                instanceAvail.available
                  ? "Rigid placed copy of the selected solid"
                  : (instanceAvail.reason ?? "Select a solid body first")
              }
              className={menuItemClass}
            >
              Copy placed
            </button>
            <MenuHeader label="Project" />
            <button role="button" onClick={() => { onOpenProject(); close(); }} className={menuItemClass}>
              Objects
            </button>
            <button role="button" onClick={() => { onToggleProps(); close(); }} className={menuItemClass}>
              Properties
            </button>
            <button role="button" onClick={() => void runOpen()} className={menuItemClass}>
              Open
            </button>
            <MenuHeader label="System" />
            <button
              role="button"
              onClick={() => { onPlugins(); close(); }}
              data-testid="plugins-button"
              className={menuItemClass}
            >
              Plugins
            </button>
            <button
              role="button"
              onClick={() => { onReference(); close(); }}
              data-testid="reference-button"
              className={menuItemClass}
            >
              Reference
            </button>
            <div className="flex items-center gap-0.5 px-1 py-1" title="Selection filter (§16)">
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
            <button role="button" onClick={() => { toggleMode(); close(); }} className={menuItemClass}>
              {beginnerMode ? "Simple" : "Advanced"}
            </button>
            {menuError && (
              <div className="px-2.5 py-1 text-xs text-red-300" title={menuError}>
                {menuError}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mx-1 h-5 w-px shrink-0 bg-white/10" />
      <WorkspaceActions />
      </div>
    </>
  );
}
