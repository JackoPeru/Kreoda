# Phase 8 (recovery slice) → handoff

Crash recovery is done via renderer-driven autosave snapshots: the interval
snapshots the live doc through typed SaveDocument whenever the revision
moves; a stale `autosave.icad` at boot (or after a sidecar restart) raises a
Restore/Discard banner. Crash and quit-without-save are indistinguishable by
design — both restore. This fulfills the crash banner's promise (§51).

## What landed

- `electron/main.ts`: `intentcad:recovery-path/exists/clear` handlers; the
  main process owns the path only (`<userData>/recovery/autosave.icad`,
  `INTENTCAD_RECOVERY_DIR` override for E2E). Crash comment de-journaled.
- `electron/preload.ts`: narrow `recoveryPath/Exists/Clear` API (§48, no
  renderer fs).
- `src/recovery/autosave.ts`: `autosaveNow` (revision-gated, skips
  lifetime-empty docs, silent-fail retry next tick), `restoreRecovery`
  (real Open path + sync, keeps the file so a second dirty exit re-prompts),
  `discardRecovery`, `clearRecoveryAfterSave` (explicit save supersedes).
- `App.tsx`: boot + post-crash-restart recovery check, Restore/Discard
  banner (`recovery-banner`), 15 s heartbeat, `autosaveNow` test hook, crash
  banner now says "autosave" (journal stays deferred, honestly).
- `Toolbar.save()`: clears recovery after explicit save.
- E2E `e2e/phase8-recovery.spec.ts`: session 1 models + autosaves (file
  asserted on disk) and vanishes; session 2 banner → Restore recovers the
  exact plate; session 3 Discard clears prompt + doc stays empty.

## Verified

- `pnpm -r lint/test/build` green; ctest 62/62 (no native changes);
  Playwright 13/13.

## Hard-won notes (do not regress)

- E2E runs the BUILT renderer/main (`.vite/build`, `dist/`) — rebuild
  (`vite build` + main + preload configs) after touching renderer/electron
  code, or hooks/testids silently go missing (`autosaveNow is not a function`).
- Playwright `electron.launch` needs `env: { ...process.env, VAR }` merged
  by hand; `ProcessEnv` type mismatches the launch signature — use
  `Record<string, string>`.
- Onboarding is `pointer-events-none`: the banner stays clickable under it.
- Restore intentionally does NOT clear the file; only explicit save and
  Discard do. Clearing on restore would drop the safety net for
  restore→quit-without-save.
- Per-op journal (finer than snapshots, cheaper for huge models) is the
  deferred half of "autosave + journal" — snapshots cover correctness first.
- Remaining Phase 8: large-model optimization, signed updater (needs real
  certs/infra — ask before building), FlatBuffers transport migration.
