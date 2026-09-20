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

/** Autosave cadence: cheap for small models, bounded staleness on crash. */
export const AUTOSAVE_MS = 15000;

let lastSavedRevision = -1;
let savedThisSession = false;

function docState(): { revision: number; bodies: number } {
  const s = useDocumentUiStore.getState();
  return {
    revision: s.revision,
    bodies: s.features.length + s.sketches.length,
  };
}

/**
 * Snapshot the live document if it changed since the last autosave.
 * Silent by design (interval caller); failures retry next tick.
 */
export async function autosaveNow(): Promise<"saved" | "skipped"> {
  const before = docState();
  if (before.revision === lastSavedRevision) return "skipped";
  // Never create a recovery file for a lifetime-empty document; but once
  // this session saved something, keep snapshotting (delete-all must stick).
  if (before.bodies === 0 && !savedThisSession) {
    lastSavedRevision = before.revision;
    return "skipped";
  }
  const path = await window.kreoda.recoveryPath();
  await coreClient.saveDocument(path);
  // Re-read AFTER the await (M10): an explicit save/open that landed while
  // we were in flight owns the truth now — stamping the stale value would
  // skip the next dirty tick.
  const after = docState();
  lastSavedRevision = after.revision;
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
  await syncFromCoreList(list, revision, sketches);
  // Keep the file: quitting again without saving must prompt again.
  lastSavedRevision = revision;
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
  try {
    await window.kreoda.recoveryClear();
  } catch {
    // Autosave recreates it if the doc is still dirty; never block saving.
  }
  lastSavedRevision = useDocumentUiStore.getState().revision;
}
