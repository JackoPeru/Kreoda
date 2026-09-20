# Phase 8 (STEP slice) → handoff

STEP AP214 import/export is done through the existing Save/Open path —
no protocol change: the dispatcher branches on file extension. Export writes
every solid as one product; import creates one non-parametric `StepImport`
feature per solid inside a single Undo step. Imported bodies tessellate,
persist in `.icad`, and undo/redo atomically.

## What landed

- `native/kreoda-core/src/exchange/step_exchange.{h,cpp}`: `ExportStep` (all
  store solids → one compound → `DESTEP_Provider::Write`, AP214) and
  `ImportStep` (read → explode solids → `CommitShape` each as `StepImport`
  with core-minted `step-<12hex>` ids, one OCAF command). Stub core: honest
  errors. Empty model / solid-less file: honest errors, never empty commits.
- `dispatcher.cpp`: `kSaveDocument` → `.step/.stp` exports (unchanged doc,
  same list response); `.3mf` → honest `UNSUPPORTED_YET`. `kOpenDocument` →
  `.step/.stp` replaces the doc (fresh baseline + import + graph sync +
  revision commit, mirroring the `.icad` flow).
- CMake: `TKDE` + `TKDESTEP` linked (core + tests); `step_exchange.cpp` in
  both targets.
- C++ `tests/test_step.cpp`: export→import volume/bbox fidelity (60000 mm³,
  1e-6 bbox), tessellation non-empty, Undo removes / Redo restores the import,
  empty-export honesty. ctest 60/60.
- UI: open-dialog accepts `.step/.stp`; toolbar titles say save/export +
  open/import; command-bar `export` hint updated (STEP is here, 3MF later).
- E2E `e2e/phase8-step.spec.ts`: box → export → import (`StepImport`,
  volume ≈ 60000, triangles > 0) → `.icad` save/reopen persists the import.

## Verified

- `pnpm -r lint/test/build` green; ctest 60/60; Playwright 11/11.
- stdio probe: box → export → import all `status: ok` over framed IPC.

## Hard-won notes (do not regress)

- OCCT logs to stdout via the default `Message_Messenger` — LETHAL for the
  stdio-framed sidecar. `DESTEP_Provider::Write` printed transfer statistics
  into the byte stream, hanging every E2E. `MuteMessenger` (RAII printer
  clear/restore, per `Message_Messenger` docs) wraps all exchange calls.
  Any future OCCT call that prints needs the same guard; check by watching
  test stdout for non-gtest text.
- `DESTEP_Provider` default-constructed has a null configuration node
  ("Configuration Node is null") — always pass `new DESTEP_ConfigurationNode()`.
- This OCCT build has NO classic TKSTEP libs (only `TKDE`/`TKDESTEP`) — use
  the DE framework (`DESTEP_Provider`), not `STEPControl_*`.
- `Message::DefaultMessenger()` returns `const handle&` (not assignable) —
  mutate printers via `ChangePrinters()`, don't try to swap the messenger.
- Face roles are generic by surface type, so imported planar faces resolve
  (`box.+Z` etc.) and holes can target them. `StepImport` honestly refuses
  parametric rebuild (`cannot rebuild StepImport`) — SetDimension on it errors.
- Earlier full-suite phase7 failure was parallel-load flakiness (40 s run);
  clean re-run 11/11. If E2E flakes recur under load, stagger workers first.
