// UX-1 workspace chrome: viewport-first shell. The 3D viewport fills the
// window; all UI floats above it (top dock, drawers on demand, bottom
// command dock, minimal status). No permanent sidebars or footers.
import { useEffect, useRef } from "react";
import { Viewport } from "../Viewport";
import { SharedTargetChip } from "./SharedTargetChip";
import { ViewCube } from "../ViewCube";
import { ContextToolbar } from "../ContextToolbar";
import { DimensionChips } from "../DimensionChips";
import { CoachingHint, Onboarding } from "../Onboarding";
import { ObjectTree } from "../ObjectTree";
import { PropertiesPanel } from "../PropertiesPanel";
import { MassAnalysisPanel } from "./MassAnalysisPanel";
import { ConfigurationsPanel } from "./ConfigurationsPanel";
import { OutwardFacePushPanel } from "./OutwardFacePushPanel";
import { DirectFaceHistoryPanel } from "./DirectFaceHistoryPanel";
import { GeometryValidationPanel } from "./GeometryValidationPanel";
import { DraftAnalysisPanel } from "./DraftAnalysisPanel";
import { InterferenceAnalysisPanel } from "./InterferenceAnalysisPanel";
import { ThicknessAnalysisPanel } from "./ThicknessAnalysisPanel";
import { ZebraAnalysisPanel } from "./ZebraAnalysisPanel";
import { CurvatureAnalysisPanel } from "./CurvatureAnalysisPanel";
import { AssemblyMatePanel } from "./AssemblyMatePanel";
import { useSelectionStore } from "../../stores";
import { useT } from "../../i18n";
import { TopToolDock } from "./TopToolDock";
import { SurfaceToolsPanel } from "./SurfaceToolsPanel";
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
  onReferenceGeometry,
  onInstance,
  onEditSketch,
  projectOpen,
  onProjectOpenChange,
  propsOpen,
  onPropsOpenChange,
  surfaceOpen,
  onSurfaceOpenChange,
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
  onReferenceGeometry: () => void;
  onInstance: () => void;
  onEditSketch: (id: string) => void;
  projectOpen: boolean;
  onProjectOpenChange: (open: boolean) => void;
  propsOpen: boolean;
  onPropsOpenChange: (open: boolean) => void;
  surfaceOpen: boolean;
  onSurfaceOpenChange: (open: boolean) => void;
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
  const t = useT();
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (surfaceOpen && (projectOpen || propsOpen)) onSurfaceOpenChange(false);
  }, [projectOpen, propsOpen, surfaceOpen, onSurfaceOpenChange]);

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
          <span>{t("chrome.recoveryText")}</span>
          <button
            onClick={onRestoreRecovery}
            className="rounded-md bg-amber-500/90 px-2.5 py-0.5 font-medium text-black hover:bg-amber-400"
            data-testid="recovery-restore"
          >
            {t("common.restore")}
          </button>
          <button
            onClick={onDiscardRecovery}
            className="rounded-md px-2 py-0.5 text-amber-100/70 hover:bg-white/10"
            data-testid="recovery-discard"
          >
            {t("common.discard")}
          </button>
        </div>
      )}
      {crashed !== null && (
        <div className="flex items-center justify-center gap-3 bg-red-950/95 px-3 py-1.5 text-sm text-red-200">
          <span>
            {t("chrome.crashText", { code: crashed })}
          </span>
          <button
            onClick={onSaveCrashBundle}
            className="rounded-md bg-white/10 px-2 py-0.5 hover:bg-white/15"
            data-testid="crash-bundle-save"
          >
            {t("chrome.crashSaveBundle")}
          </button>
          <label className="flex items-center gap-1 text-xs text-red-200/70">
            <input
              type="checkbox"
              checked={bundleFullModel}
              onChange={(e) => onBundleFullModelChange(e.target.checked)}
              data-testid="crash-bundle-full-model"
              title={t("chrome.crashFullModelTitle")}
            />
            {t("chrome.crashFullModel")}
          </label>
          {bundlePath && (
            <span className="text-xs text-red-200/70" title={bundlePath}>
              {t("chrome.crashSavedNote")}
            </span>
          )}
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden">
      <Viewport />
      <SharedTargetChip />

      <div className="pointer-events-none absolute left-3 right-3 top-3 z-50 flex justify-center">
        <TopToolDock
          onAdd={onAdd}
          onSketch={onSketch}
          onOpenProject={() => {
            onSurfaceOpenChange(false);
            onProjectOpenChange(true);
          }}
          onToggleProps={() => {
            if (!propsOpen) onSurfaceOpenChange(false);
            onPropsOpenChange(!propsOpen);
          }}
          onPlugins={() => {
            onSurfaceOpenChange(false);
            onPlugins();
          }}
          onReference={() => {
            onSurfaceOpenChange(false);
            onReference();
          }}
          onReferenceGeometry={() => {
            onSurfaceOpenChange(false);
            onReferenceGeometry();
          }}
          onInstance={() => {
            onSurfaceOpenChange(false);
            onInstance();
          }}
          onSurfaces={() => {
            onProjectOpenChange(false);
            onPropsOpenChange(false);
            onSurfaceOpenChange(true);
          }}
          moreButtonRef={moreButtonRef}
        />
      </div>

      <SurfaceToolsPanel
        open={surfaceOpen}
        onClose={() => onSurfaceOpenChange(false)}
        returnFocus={() => moreButtonRef.current?.focus()}
      />

      {projectOpen && (
        <div
          className="kreoda-float-elevated absolute bottom-4 left-3 top-[68px] z-30 flex w-72 flex-col p-2"
          data-testid="project-drawer"
          role="complementary"
          aria-label={t("common.project")}
        >
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs uppercase tracking-wide text-white/50">
              {t("common.project")}
            </span>
            <button
              onClick={() => onProjectOpenChange(false)}
              aria-label={t("chrome.closeProject")}
              className="rounded px-1.5 py-0.5 text-white/50 hover:bg-white/10 hover:text-white"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <ObjectTree onInsertHole={onHole} />
          </div>
        </div>
      )}
      {propsOpen && (
        <div
          className="kreoda-float-elevated absolute bottom-4 right-3 top-[68px] z-40 flex w-72 flex-col p-2"
          data-testid="properties-drawer"
          role="complementary"
          aria-label={t("common.properties")}
        >
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs uppercase tracking-wide text-white/50">
              {t("common.properties")}
            </span>
            <button
              onClick={() => onPropsOpenChange(false)}
              aria-label={t("chrome.closeProperties")}
              className="rounded px-1.5 py-0.5 text-white/50 hover:bg-white/10 hover:text-white"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {selectedIds.length > 0 ? (
              <>
                <PropertiesPanel onEditSketch={onEditSketch} />
                <MassAnalysisPanel />
                <DirectFaceHistoryPanel />
                <details className="mt-2 rounded-md border border-white/10 p-2">
                  <summary className="cursor-pointer text-xs text-white/55">{t("directFaceHistory.legacyTitle")}</summary>
                  <OutwardFacePushPanel />
                </details>
              </>
            ) : (
              <div className="px-2 py-1.5 text-xs text-white/40">
                {t("chrome.nothingSelected")}
              </div>
            )}
            <ConfigurationsPanel />
            <GeometryValidationPanel />
            <DraftAnalysisPanel />
            <ZebraAnalysisPanel />
            <CurvatureAnalysisPanel />
            <ThicknessAnalysisPanel />
            <InterferenceAnalysisPanel />
            <AssemblyMatePanel />
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
        onOpenProps={() => {
          onSurfaceOpenChange(false);
          onPropsOpenChange(true);
        }}
      />
      {/* No rAF overlay work behind the fullscreen sketch modal (M11). */}
      {!sketchOpen && <DimensionChips />}
      {hasFeatures && (
        <CoachingHint text={t("chrome.coachPull")} />
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
