// UX-1 workspace actions: Undo / Redo / Save (real paths only).
// Save/Open share one core round-trip with the More menu; errors surface
// on hover instead of stretching the floating bar.
import { useState } from "react";
import { Redo2, Save, Undo2 } from "lucide-react";
import { useDocumentUiStore } from "../../stores";
import { coreClient } from "../../ipc/coreClient";
import { syncFromCoreList } from "../../model/sync";
import { executeCommand } from "../../commands/execute";
import { clearRecoveryAfterSave } from "../../recovery/autosave";
import { t, useT } from "../../i18n";

/** Shared Save path (top-right button and More → Save reuse this). */
export async function saveDocument(): Promise<string | null> {
  try {
    const path = await window.kreoda.saveDialog("project.icad");
    if (!path) return null;
    await coreClient.saveDocument(path);
    // Explicit save supersedes the crash snapshot (Phase 8 recovery).
    await clearRecoveryAfterSave();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : t("actions.errSaveFailed");
  }
}

/** Shared Open path (More menu). Document replacement = new epoch (C5). */
export async function openDocument(): Promise<string | null> {
  try {
    const path = await window.kreoda.openDialog();
    if (!path) return null;
    const { features: list, sketches, revision } =
      await coreClient.openDocument(path);
    useDocumentUiStore.getState().resetDocument(coreClient.documentId);
    await syncFromCoreList(list, revision, sketches);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : t("actions.errOpenFailed");
  }
}

export function WorkspaceActions() {
  const undos = useDocumentUiStore((s) => s.undos);
  const redos = useDocumentUiStore((s) => s.redos);
  const [opError, setOpError] = useState<string | null>(null);
  const tt = useT();

  const runUndo = async (kind: "Undo" | "Redo"): Promise<void> => {
    setOpError(null);
    try {
      await executeCommand(kind, {});
    } catch (e) {
      setOpError(e instanceof Error ? e.message : tt("actions.opFailed", { kind }));
    }
  };

  return (
    <div
      className="flex items-center gap-0.5"
      title={opError ?? undefined}
      data-testid="workspace-actions"
    >
      {opError && (
        <span className="px-1 text-xs text-red-300" title={opError} role="alert">
          !
        </span>
      )}
      <button
        onClick={() => void runUndo("Undo")}
        disabled={undos === 0}
        className="rounded-[var(--kreoda-radius-sm)] p-2 hover:bg-white/10 disabled:opacity-40"
        title={undos === 0 ? tt("actions.nothingToUndo") : tt("actions.undoCount", { n: undos })}
        aria-label={tt("actions.undo")}
      >
        <Undo2 size={16} />
      </button>
      <button
        onClick={() => void runUndo("Redo")}
        disabled={redos === 0}
        className="rounded-[var(--kreoda-radius-sm)] p-2 hover:bg-white/10 disabled:opacity-40"
        title={redos === 0 ? tt("actions.nothingToRedo") : tt("actions.redoCount", { n: redos })}
        aria-label={tt("actions.redo")}
      >
        <Redo2 size={16} />
      </button>
      <button
        onClick={() =>
          void saveDocument().then((err) => {
            setOpError(err);
          })
        }
        className="rounded-[var(--kreoda-radius-sm)] bg-[var(--kreoda-accent)] p-2 text-white hover:bg-[var(--kreoda-accent-hover)]"
        title={tt("actions.saveTitle")}
        aria-label={tt("actions.save")}
      >
        <Save size={16} />
      </button>
    </div>
  );
}
