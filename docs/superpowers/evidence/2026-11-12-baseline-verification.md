# Kreoda — baseline suite verification (2026-11-12)

Purpose: establish a trustworthy, reproducible baseline for the accumulated Phase 12–16
working tree before the next delivery steps. This is a verification record, not a phase
completion certificate and not a claim about hardware/live-agent acceptance.

## Source under test

- Checkout: `.worktrees/phase10-ci` (branch `codex/phase12-quest-foundation`).
- Native source provenance: all 175 native build inputs are byte-identical to the staged
  candidate source of `.codex/build/hole-pattern-rev-20261108-1/source` (verified by SHA-256;
  173 match `baseline-inputs.json` exactly, the 2 differences are the hole-pattern fix and its
  regression test, which are present identically in both trees).

## Results

| Suite | Command | Result |
| --- | --- | --- |
| Native (Release, OCCT 8.0.1) | `ctest -C Release` in `.codex/build/hole-pattern-rev-20261108-1/b` | **433/433 passed**, 0 skipped, 101.76 s |
| Desktop unit | `pnpm -r test` | **640/640 passed**, 96 files |
| Protocol | `pnpm -r test` | **75/75 passed**, 7 files |
| Command schema | `pnpm -r test` | **28/28 passed**, 3 files |
| Unit helpers / plugin SDK | `pnpm -r test` | **4/4** and **2/2 passed** |
| .NET managed | `node scripts/run-dotnet-tests.mjs` | **465/465 passed** (SessionClient 197, ModelingAgent 91, HermesBridge 144, Benchmark 33), 0 failed/notExecuted |

Logs:

- `baseline-js-tests-20261112.log` (repo `.artifacts/`)
- `baseline-dotnet-tests-20261112.log` (repo `.artifacts/`)
- Native: `.codex/build/hole-pattern-rev-20261108-1/{red-build.log,red-ctest.log,green-build.log,green-focused-ctest.log,full-ctest.log,full-ctest.xml}`

## Hole-pattern joined-request defect (fixed earlier, re-verified by this baseline)

Observed RED before the fix: a Bridge-proposed history conversion (three `DeleteFeature`
then a joined `CreateHolePattern` inside one transaction) left revision 4 after the deletes,
then published the joined pattern as revision 5 **and** `CommitTransaction` as revision 6
with two Undo groups.

Fix: `CreateHolePatternFeature` (native `src/features/hole/hole.cpp`) now commits the document
revision only when the OCAF command produced an actual delta
(`if (hadDelta) DocumentStore::instance().commit();`), preserving abort/resync semantics.

Evidence of the fixed candidate binary SHA `908b7d5bbdb823b204e9ea57c40852404010d93194d171fda9ef98febefe9dbc`
against the real installed Bridge proposal:

- `phase16-current-history-conversion-20261108-2/proof.json`
  `PASS_INSTALLED_BRIDGE_PROPOSAL_APPLIED_TO_EXACT_HISTORY_ON_FIXED_NATIVE_CANDIDATE`
  with `conversionUndoGroups: 1`, `restoredOriginalIdsOnUndo: true`,
  `reusedPatternIdentityOnRedo: true`, converted volume equal to the original
  `39575.88499176538 mm³`, and a clean exit.

## Environment notes

- Node v24.19.0 / pnpm 10.34.5 are installed under the WinGet Node LTS package directory and
  are not on the default PATH in this shell; prepend that directory before running pnpm.
- .NET SDK 10.0.404, CMake 4.4.3, MSVC 19.44, OCCT 8.0.1 (vcpkg `x64-windows` installed tree
  of the primary checkout).
- No Kreoda app/core process was running during these runs; no installed runtime file was
  modified, no device or network action was performed.
