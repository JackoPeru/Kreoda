// UX-1 workspace chrome: viewport-first shell. The 3D viewport fills the
// window; all UI floats above it (top dock, drawers on demand, bottom
// command dock, minimal status). No permanent sidebars or footers.
import { Viewport } from "../Viewport";
import { ViewCube } from "../ViewCube";
import { ContextToolbar } from "../ContextToolbar";
import { DimensionChips } from "../DimensionChips";
import { CoachingHint, Onboarding } from "../Onboarding";
import { ObjectTree } from "../ObjectTree";
import { PropertiesPanel } from "../PropertiesPanel";
import { useSelectionStore } from "../../stores";
import { TopToolDock } from "./TopToolDock";
import { BottomCommandDock } from "./BottomCommandDock";
import { WorkspaceHelp, WorkspaceStatus } from "./WorkspaceStatus";
import type { PrimitiveKind } from "../AddPrimitiveDialog";

export function WorkspaceChrome({
  onAdd,
  onSketch,
  onHole,
  onDressUp,
  onExtrude,
  onPlugins,
  onReference,
  onInstance,
  onEditSketch,
  projectOpen,
  onProjectOpenChange,
  propsOpen,
  onPropsOpenChange,
  showRecovery,
  onRestoreRecovery,
  onDiscardRecovery,
  crashed,
  bundlePath,
  bundleFullModel,
  onBundleFullModelChange,
  onSaveCrashBundle,
  updateVersion,
  showOnboarding,
  onOnboardingSketch,
  onOnboardingDone,
  hasModel,
  hasFeatures,
  sketchOpen,
}: {
  onAdd: (kind: PrimitiveKind) => void;
  onSketch: () => void;
  onHole: () => void;
  onDressUp: (kind: "fillet" | "chamfer") => void;
  onExtrude: () => void;
  onPlugins: () => void;
  onReference: () => void;
  onInstance: () => void;
  onEditSketch: (id: string) => void;
  projectOpen: boolean;
  onProjectOpenChange: (open: boolean) => void;
  propsOpen: boolean;
  onPropsOpenChange: (open: boolean) => void;
  showRecovery: boolean;
  onRestoreRecovery: () => void;
  onDiscardRecovery: () => void;
  crashed: number | null;
  bundlePath: string | null;
  bundleFullModel: boolean;
  onBundleFullModelChange: (v: boolean) => void;
  onSaveCrashBundle: () => void;
  updateVersion: string | null;
  showOnboarding: boolean;
  onOnboardingSketch: () => void;
  onOnboardingDone: () => void;
  hasModel: boolean;
  hasFeatures: boolean;
  sketchOpen: boolean;
}) {
  const selectedIds = useSelectionStore((s) => s.selectedIds);

  return (
    <div
      className="flex h-full flex-col bg-[var(--kreoda-workspace-bg)]"
      data-testid="workspace-chrome"
    >
      {/* Recovery/crash banners stay in-flow above the viewport (never
          floating over tools — they must not intercept menu clicks). */}
      {showRecovery && (
        <div
          className="flex items-center justify-center gap-3 border-b border-amber-300/25 bg-amber-950/90 px-3 py-1.5 text-sm text-amber-100"
          data-testid="recovery-banner"
        >
          <span>Unsaved work from a previous session.</span>
          <button
            onClick={onRestoreRecovery}
            className="rounded-md bg-amber-500/90 px-2.5 py-0.5 font-medium text-black hover:bg-amber-400"
            data-testid="recovery-restore"
          >
            Restore
          </button>
          <button
            onClick={onDiscardRecovery}
            className="rounded-md px-2 py-0.5 text-amber-100/70 hover:bg-white/10"
            data-testid="recovery-discard"
          >
            Discard
          </button>
        </div>
      )}
      {crashed !== null && (
        <div className="flex items-center justify-center gap-3 bg-red-950/95 px-3 py-1.5 text-sm text-red-200">
          <span>
            Geometry engine stopped unexpectedly ({crashed}). Editing paused
            — restart to restore from autosave (§51).
          </span>
          <button
            onClick={onSaveCrashBundle}
            className="rounded-md bg-white/10 px-2 py-0.5 hover:bg-white/15"
            data-testid="crash-bundle-save"
          >
            Save bundle
          </button>
          <label className="flex items-center gap-1 text-xs text-red-200/70">
            <input
              type="checkbox"
              checked={bundleFullModel}
              onChange={(e) => onBundleFullModelChange(e.target.checked)}
              data-testid="crash-bundle-full-model"
              title="Attach the full model summary (dimensions included)"
            />
            full model
          </label>
          {bundlePath && (
            <span className="text-xs text-red-200/70" title={bundlePath}>
              saved — attach it to your report
            </span>
          )}
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden">
      <Viewport />

      <div className="pointer-events-none absolute left-3 right-3 top-3 z-50 flex justify-center">
        <TopToolDock
          onAdd={onAdd}
          onSketch={onSketch}
          onOpenProject={() => onProjectOpenChange(true)}
          onToggleProps={() => onPropsOpenChange(!propsOpen)}
          onPlugins={onPlugins}
          onReference={onReference}
          onInstance={onInstance}
        />
      </div>

      {projectOpen && (
        <div
          className="kreoda-float-elevated absolute bottom-4 left-3 top-[68px] z-30 flex w-72 flex-col p-2"
          data-testid="project-drawer"
          role="complementary"
          aria-label="Project"
        >
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs uppercase tracking-wide text-white/50">
              Project
            </span>
            <button
              onClick={() => onProjectOpenChange(false)}
              aria-label="Close project drawer"
              className="rounded px-1.5 py-0.5 text-white/50 hover:bg-white/10 hover:text-white"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <ObjectTree />
          </div>
        </div>
      )}
      {propsOpen && (
        <div
          className="kreoda-float-elevated absolute bottom-4 right-3 top-[68px] z-30 flex w-72 flex-col p-2"
          data-testid="properties-drawer"
          role="complementary"
          aria-label="Properties"
        >
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs uppercase tracking-wide text-white/50">
              Properties
            </span>
            <button
              onClick={() => onPropsOpenChange(false)}
              aria-label="Close properties drawer"
              className="rounded px-1.5 py-0.5 text-white/50 hover:bg-white/10 hover:text-white"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {selectedIds.length > 0 ? (
              <PropertiesPanel onEditSketch={onEditSketch} />
            ) : (
              <div className="px-2 py-1.5 text-xs text-white/40">
                Nothing selected — pick a body in the viewport or project
                drawer.
              </div>
            )}
          </div>
        </div>
      )}

      <ViewCube />
      <ContextToolbar
        onHole={onHole}
        onDressUp={onDressUp}
        onSketch={onSketch}
        onExtrude={onExtrude}
        onEditSketch={onEditSketch}
        onInstance={onInstance}
        onOpenProps={() => onPropsOpenChange(true)}
      />
      {/* No rAF overlay work behind the fullscreen sketch modal (M11). */}
      {!sketchOpen && <DimensionChips />}
      {hasFeatures && (
        <CoachingHint text="Drag a face to change its size. Click the number to type an exact value." />
      )}
      {showOnboarding && !hasModel && (
        <Onboarding onSketch={onOnboardingSketch} onDone={onOnboardingDone} />
      )}

      <div className="pointer-events-none absolute bottom-4 left-1/2 z-30 flex w-full max-w-2xl -translate-x-1/2 justify-center px-4">
        <BottomCommandDock />
      </div>
      <div className="absolute bottom-4 left-4 z-30">
        <WorkspaceStatus updateVersion={updateVersion} />
      </div>
      <div className="absolute bottom-4 right-4 z-30">
        <WorkspaceHelp />
      </div>
      </div>
    </div>
  );
}
