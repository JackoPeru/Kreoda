// Crash recovery (Phase 8 §51/§61): renderer-driven autosave snapshots.
//
// Design: the sidecar owns the B-Rep truth, so recovery snapshots flow
// through the typed Save/OpenDocument path — never renderer fs (§48; the
// main process only hands out the path). One file per profile
// (`autosave.icad`); it is cleared on explicit save or Discard, so its
// mere existence at boot means "previous session ended with unsaved work"
// (crash AND quit-without-save both restore — indistinguishable by design).

import { coreClient } from "../ipc/coreClient";
import { syncFromCoreList } from "../model/sync";
import { useDocumentUiStore } from "../stores";
import { useReferenceStore } from "../reference/store";

/** Autosave cadence: cheap for small models, bounded staleness on crash. */
export const AUTOSAVE_MS = 15000;

type DocVersion = { epoch: number; revision: number; references: number };

let lastSaved: DocVersion = { epoch: -1, revision: -1, references: -1 };
let savedThisSession = false;

function docState(): DocVersion & { bodies: number } {
  const s = useDocumentUiStore.getState();
  return {
    epoch: s.epoch,
    revision: s.revision,
    references: useReferenceStore.getState().revision,
    bodies: s.features.length + s.sketches.length + useReferenceStore.getState().planes.length,
  };
}

function sameVersion(a: DocVersion, b: DocVersion): boolean {
  return a.epoch === b.epoch && a.revision === b.revision && a.references === b.references;
}

/**
 * Snapshot the live document if it changed since the last autosave.
 * Silent by design (interval caller); failures retry next tick.
 */
export async function autosaveNow(): Promise<"saved" | "skipped"> {
  const before = docState();
  if (sameVersion(before, lastSaved)) return "skipped";
  // Never create a recovery file for a lifetime-empty document; but once
  // this session saved something, keep snapshotting (delete-all must stick).
  if (before.bodies === 0 && !savedThisSession) {
    lastSaved = before;
    return "skipped";
  }
  const path = await window.kreoda.recoveryPath();
  await coreClient.saveDocument(path);
  // The file reflects the state saved for `before`. If Open/edit landed while
  // SaveDocument was in flight, leave the old marker so the next tick retries.
  const after = docState();
  if (sameVersion(before, after)) lastSaved = before;
  savedThisSession = true;
  return "saved";
}

export async function recoveryAvailable(): Promise<boolean> {
  return window.kreoda.recoveryExists();
}

/** Restore the autosave snapshot through the real Open path (no shortcuts). */
export async function restoreRecovery(): Promise<void> {
  const path = await window.kreoda.recoveryPath();
  const { features: list, sketches, revision } =
    await coreClient.openDocument(path);
  // Document replacement = new epoch (C5): core revisions reset.
  useDocumentUiStore.getState().resetDocument(coreClient.documentId);
  const restoreEpoch = useDocumentUiStore.getState().epoch;
  await syncFromCoreList(list, revision, sketches);
  // Keep the file: quitting again without saving must prompt again.
  const restored = docState();
  if (restored.epoch === restoreEpoch && restored.revision === revision) {
    lastSaved = restored;
  }
  savedThisSession = true;
}

export async function discardRecovery(): Promise<void> {
  await window.kreoda.recoveryClear();
  // Fresh prompt logic afterwards: an empty boot must not recreate the file
  // until this session dirties something again.
  savedThisSession = false;
}

/** Explicit user save makes recovery redundant — clear it (non-fatal). */
export async function clearRecoveryAfterSave(): Promise<void> {
  const before = docState();
  let cleared = false;
  try {
    await window.kreoda.recoveryClear();
    cleared = true;
  } catch {
    // Keep the marker dirty so autosave can recreate the recovery file.
    lastSaved = { epoch: -1, revision: -1, references: -1 };
  }
  const after = docState();
  if (cleared && sameVersion(before, after)) lastSaved = before;
}
