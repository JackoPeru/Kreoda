import { useEffect, useRef, useState } from "react";
import type { CoreMeshData, SketchModel } from "@kreoda/protocol";
import { Toolbar } from "../components/Toolbar";
import { PluginsDialog } from "../components/PluginsDialog";
import { ReferenceDialog } from "../components/ReferenceDialog";
import { InstanceDialog } from "../components/InstanceDialog";
import { ObjectTree } from "../components/ObjectTree";
import { PropertiesPanel } from "../components/PropertiesPanel";
import { ContextToolbar } from "../components/ContextToolbar";
import { ViewCube } from "../components/ViewCube";
import { DimensionChips } from "../components/DimensionChips";
import { SuggestionBar } from "../components/SuggestionBar";
import {
  CoachingHint,
  Onboarding,
  shouldShowOnboarding,
} from "../components/Onboarding";
import { SketchEditor, defaultRectModel } from "../components/SketchEditor";
import { ExtrudeDialog } from "../components/ExtrudeDialog";
import { HoleDialog } from "../components/HoleDialog";
import { DressUpDialog } from "../components/DressUpDialog";
import { Viewport } from "../components/Viewport";
import { CommandBar } from "../components/CommandBar";
import {
  AddPrimitiveDialog,
  type PrimitiveKind,
} from "../components/AddPrimitiveDialog";
import { useDocumentUiStore, useSelectionStore } from "../stores";
import { coreClient } from "../ipc/coreClient";
import { loadPluginsFromHost } from "../plugins/loader";
import {
  AUTOSAVE_MS,
  autosaveNow,
  discardRecovery,
  recoveryAvailable,
  restoreRecovery,
} from "../recovery/autosave";
import { executeCommand } from "../commands/execute";
import { pullFeatureMesh, updateFeatureSummary } from "../model/sync";
import {
  faceScreenPoint,
  viewportViewDir,
} from "../viewport/viewportHandle";

/** Beginner shell (§24): toolbar / tree / viewport / command bar / history. */
export function App() {
  const { coreRunning, coreVersion, setCoreStatus } = useDocumentUiStore();
  const revision = useDocumentUiStore((s) => s.revision);
  const features = useDocumentUiStore((s) => s.features);
  const sketches = useDocumentUiStore((s) => s.sketches);
  const meshes = useDocumentUiStore((s) => s.meshes);
  const [crashed, setCrashed] = useState<number | null>(null);  // Crash recovery (Phase 8): autosave snapshot from a previous session.
  const [showRecovery, setShowRecovery] = useState(false);
  // Crash bundle (§61): where the last saved bundle went (shown, not stored).
  const [bundlePath, setBundlePath] = useState<string | null>(null);
  // Explicit opt-in to attach the full model summary (redacted by default).
  const [bundleFullModel, setBundleFullModel] = useState(false);
  // Ref mirror: saveCrashBundle is captured once by the test-hook effect.
  const bundleFullModelRef = useRef(false);
  useEffect(() => {
    bundleFullModelRef.current = bundleFullModel;
  }, [bundleFullModel]);
  // Signed update available (Phase 8 §61; only ever set via main process).
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);

  const saveCrashBundle = async (): Promise<{
    path: string;
    bytes: number;
    preview: string;
  }> => {
    const hook = (
      window as unknown as { __kreoda_test: { snapshot: () => unknown } }
    ).__kreoda_test;
    const payload = JSON.stringify({
      snapshot: hook.snapshot(),
      coreVersion: useDocumentUiStore.getState().coreVersion,
    });
    const result = await window.kreoda.crashBundle(
      payload,
      bundleFullModelRef.current,
    );
    setBundlePath(result.path);
    return result;
  };
  const [adding, setAdding] = useState<PrimitiveKind | null>(null);
  const [editingSketch, setEditingSketch] = useState<string | null>(null);
  const [extruding, setExtruding] = useState(false);
  const [holing, setHoling] = useState(false);
  const [dressUp, setDressUp] = useState<"fillet" | "chamfer" | null>(null);
  const [showPlugins, setShowPlugins] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const [showInstance, setShowInstance] = useState(false);
  // First-run onboarding (§56): shown over an empty document until dismissed.
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() =>
    shouldShowOnboarding(),
  );

  // Once the first solid exists the empty-state overlay must go, whatever
  // created it (toolbar, palette, AI, recovery).
  const hasModel = features.length > 0 || sketches.length > 0;
  useEffect(() => {
    if (hasModel) setShowOnboarding(false);
  }, [hasModel]);

  useEffect(() => {
    let cancelled = false;
    const checkRecovery = (): void => {
      recoveryAvailable()
        .then((found) => {
          if (!cancelled && found) setShowRecovery(true);
        })
        .catch(() => {});
    };
    const refresh = (): void => {
      coreClient
        .getCoreInfo()
        .then((info) => {
          if (!cancelled) {
            setCoreStatus(true, info.coreVersion);
            setCrashed(null);
          }
        })
        .catch(() => {
          if (!cancelled) setCoreStatus(false, null);
        });
    };
    refresh();
    // A recovery file at boot means the previous session kept unsaved work.
    checkRecovery();
    const offCrash = window.kreoda?.onCoreCrashed?.((info) => {
      setCrashed(info.code);
      setCoreStatus(false, null);
    });
    // Post-crash restart brings an EMPTY engine: the autosave (written by
    // the interval before the crash) is the way back — re-check it.
    const offRestart = window.kreoda?.onCoreRestarted?.(() => {
      refresh();
      checkRecovery();
    });
    const offUpdate = window.kreoda?.onUpdateAvailable?.((info) => {
      if (!cancelled) setUpdateVersion(info.version);
    });
    return () => {
      cancelled = true;
      offCrash?.();
      offRestart?.();
      offUpdate?.();
    };
  }, [setCoreStatus]);

  // Autosave heart-beat (silent; failures retry next tick).
  useEffect(() => {
    const timer = setInterval(() => {
      autosaveNow().catch(() => {});
    }, AUTOSAVE_MS);
    return () => clearInterval(timer);
  }, []);

  // Plugin auto-load (§47): host dir sources spawn sandboxed workers.
  // Fire-and-forget per file; failures log, never block boot.
  useEffect(() => {
    loadPluginsFromHost().catch(() => {});
  }, []);

  useEffect(() => {
    // Read-only diagnostics hook for E2E + support bundles (§49–§50).
    // No Node/fs access — store summary only.
    (
      window as unknown as {
        __kreoda_test?: unknown;
      }
    ).__kreoda_test = {
      snapshot: () => {
        const s = useDocumentUiStore.getState();
        return {
          revision: s.revision,
          selectedIds: useSelectionStore.getState().selectedIds,
          sketches: s.sketches.map((k) => ({
            id: k.featureId,
            planeKind: k.planeKind,
            points: k.points,
            constraints: k.constraints,
          })),
          bodies: s.features.map((f) => {
            const mesh = s.meshes[f.featureId];
            return {
              id: f.featureId,
              type: f.type,
              paramsMm: f.paramsMm,
              volumeMm3: f.volumeMm3,
              expressions: f.expressions ?? {},
              triangles: mesh ? mesh.indices.length / 3 : -1,
              faces: mesh ? mesh.faces.map((r) => r.persistentFaceId) : [],
              edgeCount: mesh ? mesh.edges.length : -1,
            };
          }),
        };
      },
      // Same privilege as the preload invoke API (no new capability):
      // drives the real Save/Open path for E2E round-trip checks.
      saveIcad: async (path: string) => {
        await coreClient.saveDocument(path);
        return (
          window as unknown as { __kreoda_test: { snapshot: () => unknown } }
        ).__kreoda_test.snapshot();
      },
      openIcad: async (path: string) => {
        const { features: list, sketches, revision } =
          await coreClient.openDocument(path);
        const { syncFromCoreList } = await import("../model/sync");
        // Document replacement = new epoch (C5): the core revision resets
        // on fresh baselines, so staleness guards key lineage, not numbers.
        useDocumentUiStore.getState().resetDocument(coreClient.documentId);
        await syncFromCoreList(list, revision, sketches);
        return (
          window as unknown as { __kreoda_test: { snapshot: () => unknown } }
        ).__kreoda_test.snapshot();
      },
      // Crash-recovery E2E: drive the same routine the interval uses.
      autosaveNow: () => autosaveNow(),
      // Crash-bundle E2E: same path as the banner button (works anytime).
      crashBundle: () => saveCrashBundle(),
      // Plugin E2E: register from source + run without touching the host dir.
      loadPluginSource: async (source: string) => {
        const { loadPlugin } = await import("../plugins/loader");
        return loadPlugin(source, "<e2e>");
      },
      runPlugin: async (pluginId: string, commandId: string, params: unknown) => {
        const { runPluginCommand } = await import("../plugins/loader");
        return runPluginCommand(pluginId, commandId, params);
      },
      // Reference E2E: inject planes + calibrate without native dialogs.
      addReference: async (dataUrl: string, imageW: number, imageH: number) => {
        const { addReferencePlane } = await import("../reference/store");
        return addReferencePlane({
          name: "<e2e>",
          dataUrl,
          imageW,
          imageH,
        });
      },
      calibrateReference: async (
        id: string,
        p1: [number, number],
        p2: [number, number],
        realMm: number,
      ) => {
        const { calibrateSize, updateReferencePlane, useReferenceStore } =
          await import("../reference/store");
        const plane = useReferenceStore
          .getState()
          .planes.find((p) => p.id === id);
        if (!plane) throw new Error("no such reference plane");
        const size = calibrateSize(
          plane.imageW,
          plane.imageH,
          p1,
          p2,
          realMm,
        );
        updateReferencePlane(id, {
          widthMm: size.widthMm,
          heightMm: size.heightMm,
          mmPerPx: size.mmPerPx,
        });
        return useReferenceStore
          .getState()
          .planes.find((p) => p.id === id);
      },
      // Phase 2 topology acceptance: persistent face pick + typed dimension
      // edit through the real core path (not store-only shortcuts).
      selectFace: (featureId: string, role: string) => {
        const id = `${featureId}:${role}`;
        useSelectionStore.getState().select(id, false);
        return (
          window as unknown as { __kreoda_test: { snapshot: () => unknown } }
        ).__kreoda_test.snapshot();
      },
      // Phase 10 golden-A: persistent edge pick (fillet/chamfer acceptance).
      selectEdge: (featureId: string, edgeSuffix: string) => {
        const id = `${featureId}:${edgeSuffix}`;
        useSelectionStore.getState().select(id, false);
        return (
          window as unknown as { __kreoda_test: { snapshot: () => unknown } }
        ).__kreoda_test.snapshot();
      },
      setParam: async (featureId: string, paramName: string, valueMm: number) => {
        const updated = await coreClient.setFeatureParameter(
          featureId,
          paramName,
          valueMm,
        );
        if (!("positions" in updated)) {
          // C2: same full-list sync as execute.ts (expressions move others).
          const list = (updated as { features?: { featureId: string; type: string; paramsMm: number[]; volumeMm3: number; dependsOn: string[]; refExtra: string; expressions: Record<string, string> }[] }).features;
          if (list && list.length > 0) {
            const { syncFromCoreList } = await import("../model/sync");
            const sketches = (updated as { sketches?: { featureId: string; planeKind: string; points: number; lines: number; circles: number; constraints: number }[] }).sketches ?? [];
            await syncFromCoreList(list, updated.revision, sketches);
          } else {
            await pullFeatureMesh(featureId, updated.revision);
            updateFeatureSummary(
              featureId,
              {
                paramsMm: updated.paramsMm,
                volumeMm3: updated.volumeMm3,
                expressions: updated.expressions ?? {},
              },
              updated.revision,
            );
          }
        }
        return (
          window as unknown as { __kreoda_test: { snapshot: () => unknown } }
        ).__kreoda_test.snapshot();
      },
      faceScreenPoint: (featureId: string, role: string) =>
        faceScreenPoint(featureId, role),
      viewDir: () => viewportViewDir(),
      // Phase 4 acceptance: sketch → extrude through the real core path.
      // Single commit: create with the rect content directly (one Undo step,
      // current revision — no stale setFeatures).
      createRectSketch: async (w: number, h: number, planeKind = "XY") => {
        const { featureId, revision } = await coreClient.createSketch({
          planeKind: planeKind as "XY" | "XZ" | "YZ",
          model: defaultRectModel(w, h),
        });
        const full = await coreClient.requestSketch(featureId);
        useDocumentUiStore.getState().upsertSketch({
          featureId,
          planeKind: full.planeKind,
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
        useSelectionStore.getState().select(featureId, false);
        const hook = (
          window as unknown as { __kreoda_test: { snapshot: () => unknown } }
        ).__kreoda_test;
        return hook.snapshot();
      },
      openSketch: (featureId: string) => {
        setEditingSketch(featureId);
        const hook = (
          window as unknown as { __kreoda_test: { snapshot: () => unknown } }
        ).__kreoda_test;
        return hook.snapshot();
      },
      extrudeSketch: async (sketchId: string, distanceMm: number) => {
        await executeCommand("CreateExtrude", { sketchId, distanceMm });
        const hook = (
          window as unknown as { __kreoda_test: { snapshot: () => unknown } }
        ).__kreoda_test;
        return hook.snapshot();
      },
      // Scenario A (§62): hole through a named face at face-local (x, y).
      // depthMode/depthMm optional (blind holes: T1 E2E coverage).
      makeHole: async (
        targetId: string,
        faceRole: string,
        xMm: number,
        yMm: number,
        diameterMm: number,
        depthMode: "throughAll" | "blind" = "throughAll",
        depthMm = 0,
      ) => {
        await executeCommand("CreateHole", {
          targetId,
          faceRole,
          xMm,
          yMm,
          diameterMm,
          depthMode,
          depthMm,
        });
        const hook = (
          window as unknown as { __kreoda_test: { snapshot: () => unknown } }
        ).__kreoda_test;
        return hook.snapshot();
      },
    };
  }, []);

  const openSketchEditor = (id: string): void => {
    // Select the sketch noun, then open the 2D editor (§21 + §26).
    useSelectionStore.getState().select(id, false);
    setEditingSketch(id);
  };

  const createSketch = async (): Promise<void> => {
    try {
      await executeCommand("CreateSketch", { planeKind: "XY" });
      const sk = useDocumentUiStore.getState().sketches;
      const last = sk[sk.length - 1];
      if (last) openSketchEditor(last.featureId);
    } catch {
      // Toolbar surfaces registry errors; silent here is fine.
    }
  };

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        onAdd={setAdding}
        onSketch={() => void createSketch()}
        onExtrude={() => setExtruding(true)}
        onHole={() => setHoling(true)}
        onDressUp={(kind) => setDressUp(kind)}
        onPlugins={() => setShowPlugins(true)}
        onReference={() => setShowReference(true)}
        onInstance={() => setShowInstance(true)}
      />
      {showRecovery && (
        <div
          className="flex items-center gap-3 border-b border-amber-300/25 bg-amber-950/60 px-3 py-1.5 text-sm text-amber-100"
          data-testid="recovery-banner"
        >
          <span>Unsaved work from a previous session.</span>
          <button
            onClick={() =>
              restoreRecovery()
                .then(() => setShowRecovery(false))
                .catch(() => {})
            }
            className="rounded-md bg-amber-500/90 px-2.5 py-0.5 font-medium text-black hover:bg-amber-400"
            data-testid="recovery-restore"
          >
            Restore
          </button>
          <button
            onClick={() =>
              discardRecovery()
                .then(() => setShowRecovery(false))
                .catch(() => setShowRecovery(false))
            }
            className="rounded-md px-2 py-0.5 text-amber-100/70 hover:bg-white/10"
            data-testid="recovery-discard"
          >
            Discard
          </button>
        </div>
      )}
      {crashed !== null && (
        <div className="flex items-center gap-3 bg-red-950 px-3 py-1.5 text-sm text-red-200">
          <span>
            Geometry engine stopped unexpectedly ({crashed}). Editing paused
            — restart to restore from autosave (§51).
          </span>
          <button
            onClick={() => void saveCrashBundle()}
            className="rounded-md bg-white/10 px-2 py-0.5 hover:bg-white/15"
            data-testid="crash-bundle-save"
          >
            Save bundle
          </button>
          <label className="flex items-center gap-1 text-xs text-red-200/70">
            <input
              type="checkbox"
              checked={bundleFullModel}
              onChange={(e) => setBundleFullModel(e.target.checked)}
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
      <div className="flex min-h-0 flex-1">
        <ObjectTree />
        <div className="relative min-w-0 flex-1">
          <Viewport />
          <ViewCube />
          <ContextToolbar
            onHole={() => setHoling(true)}
            onDressUp={(kind) => setDressUp(kind)}
            onSketch={() => void createSketch()}
            onExtrude={() => setExtruding(true)}
          />
          {/* No rAF overlay work behind the fullscreen sketch modal (M11). */}
          {!editingSketch && <DimensionChips />}
          <SuggestionBar />
          {features.length > 0 && (
            <CoachingHint text="Drag a face to change its size. Click the number to type an exact value." />
          )}
          {showOnboarding && !hasModel && (
            <Onboarding
              onSketch={() => {
                setShowOnboarding(false);
                void createSketch();
              }}
              onDone={() => setShowOnboarding(false)}
            />
          )}
          {!coreRunning && (
            <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/60 px-2.5 py-1.5 text-xs text-white/75">
              kreoda-core: not connected — build native sidecar (§61 Task 4–6)
              {coreVersion ? ` · ${coreVersion}` : ""}
            </div>
          )}
        </div>
        <PropertiesPanel onEditSketch={openSketchEditor} />
      </div>
      <CommandBar />
      <div className="border-t border-white/5 bg-[#0b0e13] px-3 py-1 text-[11px] text-white/40">
        {features.length === 0 && sketches.length === 0
          ? "empty document"
          : `history: ${[...sketches.map(() => "Sketch"), ...features.map((f) => f.type)].join(" → ")}`}{" "}
        · rev {revision} · {Object.keys(meshes).length} mesh
        {Object.keys(meshes).length === 1 ? "" : "es"} ·{" "}
        {coreRunning ? `core ${coreVersion}` : "core offline"}
        {updateVersion && (
          <span
            className="pl-2 text-amber-200/80"
            title="A signed update is ready — see the update dialog"
            data-testid="update-note"
          >
            · update {updateVersion} ready
          </span>
        )}
      </div>
      <AddPrimitiveDialog kind={adding} onClose={() => setAdding(null)} />
      {editingSketch && (
        <SketchEditor
          sketchId={editingSketch}
          onClose={() => setEditingSketch(null)}
        />
      )}
      {showPlugins && <PluginsDialog onClose={() => setShowPlugins(false)} />}
      {showReference && (
        <ReferenceDialog onClose={() => setShowReference(false)} />
      )}
      {showInstance && (
        <InstanceDialog onClose={() => setShowInstance(false)} />
      )}
      {extruding && <ExtrudeDialog onClose={() => setExtruding(false)} />}
      {holing && <HoleDialog onClose={() => setHoling(false)} />}
      {dressUp && (
        <DressUpDialog kind={dressUp} onClose={() => setDressUp(null)} />
      )}
    </div>
  );
}
