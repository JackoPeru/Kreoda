# Phase 10 Completion Report

**Status: PARTIAL**  
**Ready for Phase 11: NO**

## Implemented and present in the tree

- The top-level `pnpm test:all` command covers TypeScript checks, native tests, .NET, workspace unit tests, and the non-solo Electron E2E suite.
- `native/kreoda-core/src/protocol/dispatcher.cpp` implements typed `DeleteFeature` through OCAF. It rejects shape, sketch, instance, and formula dependents when no cascade is safe, removes feature-owned formulas/selections, then resyncs stores and graph for body tips, undo/redo, and persistence.
- `native/kreoda-core/tests/test_torture_phase10.cpp` contains topology mutation, save/open, undo/redo, atomic overwrite, and tessellation tests. Coverage includes 100 real document open/close cycles, deletion of shapes and sketches, dependency refusal, body-tip rollback, deletion undo/redo/save-open, and 1000 body create/delete cycles through typed RPC. Adaptive 500k/1M triangle baselines use actual OCCT spheres. §10.6 source coverage also includes 25 real STEP imports, each after an OCAF document reset, and 20 LOD2 tessellations of fresh OCCT spheres. Both repeated-cycle tests assert geometry integrity and log elapsed time, working set, private bytes, and handles without memory caps; this source coverage is not runtime evidence.
- `apps/desktop/e2e/phase10-golden.spec.ts` contains golden workflows A–C; `phase10-crash.spec.ts` now covers sidecar, renderer, and main-process termination with autosave restoration; `phase10-perf.spec.ts` records a 21-body baseline. The expanded crash suite has passed TypeScript compilation and Playwright test discovery, but has not run yet.
- Configured pnpm for Forge with `node-linker=isolated` and a scoped `@electron-forge/*` public hoist. This retains package-local links for the workspace.
- Added a narrow `flora-colossus@2.0.0` patch. Its walker resolves each module to its real path and checks every ancestor, so it finds transitive dependencies in pnpm's virtual store. Registered the patch in `pnpm-workspace.yaml` and `pnpm-lock.yaml`.
- Updated Forge to dereference pnpm junctions instead of recreating them, require the real OCCT build (`WITH_OCCT=ON`, `KREODA_ALLOW_STUB_CORE=OFF`), and include the core plus every DLL from the native Release directory. ZIP output is Windows-only, the native target currently built here.
- Added Squirrel package identity/metadata and allowed only `electron-winstaller`'s inspected install hook. It selects the included 7-Zip binary for the host architecture. Added `apps/desktop/out/` to `.gitignore`; artifacts remain available locally.
- Fixed a concrete renderer resource leak: successful plugin registration now revokes its temporary Worker blob URL, and viewport teardown disposes reference-plane textures. A new E2E test loads/unloads the plugin 20 times and checks URL creation/revocation counts. The test is compiled and discovered, but still needs hosted runtime evidence.
- Updated historical Electron E2E specs to enter the Home screen's workspace before looking for CAD controls, including after reload. The desktop build and 76 unit tests pass with the current local desktop changes; hosted E2E is pending.
- Added this report and the Phase 9 entry-baseline report. The existing typed protocol schema remains unchanged; unrelated working-tree edits were preserved.

## Verification

- `pnpm test:all` — **FAIL**, exit 1. TypeScript step completed; native test runner then tried `kreoda-core-tests.exe --gtest_brief=1`, which exited `3236495362` (`0xC0E90002`). The command stopped before its remaining steps.
- `Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-CodeIntegrity/Operational'; StartTime=(Get-Date).AddHours(-2)}` — events 3077/3033 show Windows Code Integrity blocking `TKGeomAlgo.dll` when loading `kreoda-core-tests.exe` and `TKFillet.dll` when loading `kreoda-core.exe`; event 3118 records Smart App Control block details. Both modules failed the active signing/integrity policy. No security settings were changed.
- `cmake --build native/kreoda-core/build --config Release --target kreoda-core` — **PASS**, exit 0. Build cache: `WITH_OCCT=ON`, `KREODA_ALLOW_STUB_CORE=OFF`. CMake's `InstallRequiredSystemLibraries` resolved the release CRT from `MSVC_REDIST_DIR`, rejected any source outside that Visual Studio Redist tree, and staged the three required DLLs beside the core. The generated protocol header SHA-256 was unchanged.
- `cmake --build native/kreoda-core/build --config Release --target kreoda-core-tests` — **FAIL**, exit 1 at GoogleTest discovery, rerun after adding the §10.6 STEP-import and tessellation cycles. `test_torture_phase10.cpp` compiled and `kreoda-core-tests.exe` linked; discovery could not launch the executable (exit `0xC0E90002`) under the active Windows Code Integrity policy. Earlier Code Integrity events identify `TKGeomAlgo.dll` as blocked. The generated protocol header SHA-256 remained unchanged (`62076FAC0C5A3562BBF36E748EB2AD53DF1A13D246FBBB26CA934D48E8C210A6`). The delete, 1000-cycle, repeated-STEP-import, and repeated-tessellation tests were not executed.
- `ctest --test-dir native\kreoda-core\build -C Release --output-on-failure --parallel 1` — **NOT RUN**, 1/1 reports `kreoda-core-tests_NOT_BUILT`; test discovery never completed.
- `pnpm -r exec tsc --noEmit` — **PASS**, exit 0.
- `pnpm -r test` — **PASS**: desktop 18 files / 76 tests; protocol 3 / 16; plugin SDK 1 / 2; units 2 / 4. Command-schema has no test files. Total: 98 tests.
- `pnpm test:dotnet` — **PASS**, 21/21.
- `pnpm -r build` — **PASS**, including workspace packages, renderer, Electron main, and preload. Vite emitted the >500 kB chunk warning for `three.module` (614.50 kB).
- `pnpm install --frozen-lockfile --config.confirmModulesPurge=false` — **PASS** after the pnpm patch/config changes. It ran `electron-winstaller`'s inspected install hook and selected 7-Zip x64; frozen lockfile validation passed.
- `pnpm --filter @kreoda/desktop make` — **PASS**, exit 0. Produced:
  - `apps/desktop/out/make/squirrel.windows/x64/Kreoda-0.1.0 Setup.exe` (333,105,664 bytes)
  - `apps/desktop/out/make/squirrel.windows/x64/kreoda-0.1.0-full.nupkg` (332,233,005 bytes)
  - `apps/desktop/out/make/zip/win32/x64/Kreoda-win32-x64-0.1.0.zip` (338,687,020 bytes)
- Inspected the ZIP and Squirrel `.nupkg` with `System.IO.Compression.ZipFile`: each contains `resources/kreoda-core.exe` and all 44 DLLs from `native/kreoda-core/build/Release`, with no debug MSVC CRT DLLs. The core SHA-256 in both artifacts matches the built executable (`cb94b28f6de8a2cfe6fc5215c6a26e674cafb475e0d498528bac28da7dcc5b0f`). The three app-local CRT DLL hashes match the staged Release files and the selected Visual Studio `x64/Microsoft.VC143.CRT` redist copies. The packaged `app.asar` has no `stub-core.mjs`; the real sidecar is outside the ASAR in `resources/`.
- `dumpbin /dependents native/kreoda-core/build/Release/kreoda-core.exe` — the executable imports `MSVCP140.dll`, `VCRUNTIME140.dll`, and `VCRUNTIME140_1.dll`; all three release DLLs are now staged beside it and included in both artifacts. Microsoft permits app-local redistribution of individual runtime files only under the applicable Visual Studio license terms and for licensed users, and discourages app-local deployment for servicing. Publisher entitlement and a runtime servicing/update policy still need confirmation ([Microsoft redistribution guidance](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files?view=msvc-170)).
- `git check-ignore -v apps/desktop/out/make/zip/win32/x64/Kreoda-win32-x64-0.1.0.zip` — **PASS**, Forge output is ignored while artifacts remain on disk.
- `pnpm -r exec tsc --noEmit` — **PASS**, exit 0 after the packaging changes.
- `pnpm --filter @kreoda/desktop test` — **PASS**, 18 files / 76 tests.
- Hosted Windows CI [36495611995](https://github.com/JackoPeru/Kreoda/actions/runs/36495611995) — native self-test and all 117 baseline GoogleTests passed. The next .NET step failed because the MSVC setup exported `Platform=x64`, while the solution supports `Release|Any CPU`. With that environment reproduced locally, `dotnet test ... '-p:Platform=Any CPU'` passed 21/21; the workflow now supplies the property.
- Hosted Windows CI [36499110891](https://github.com/JackoPeru/Kreoda/actions/runs/36499110891) — 119/121 native tests passed; deletion followed by save/open rejected a now-empty project, and the million-triangle sphere test timed out. [36501752027](https://github.com/JackoPeru/Kreoda/actions/runs/36501752027) — 121/123 passed; the million-triangle sphere completed in 1141.80 s, while the empty-project reopen and sphere bounding-box tolerance failed. The OCAF loader now accepts a genuinely empty shape table, the mesh test allows OCCT bounding-box tolerance, and CTest has a 2400 s timeout. These fixes await the [36532625372](https://github.com/JackoPeru/Kreoda/actions/runs/36532625372) run.
- `git diff --check` — **PASS**, with Git line-ending warnings for the generated protocol header and pnpm lock/config files.
- Playwright E2E, crash, and performance suites were **NOT RUN**. The current harness launches a visible `BrowserWindow` and these scenarios require the real core; Code Integrity blocks the OCCT DLLs before test behavior begins, so launching them would not produce meaningful Phase 10 evidence.

## Acceptance gaps

- Hosted CI has executed native topology, persistence, deletion, and tessellation suites, exposing the failures and measurements listed above. The corrected suite has not yet passed in full; this host still cannot launch the unsigned OCCT DLLs under its Code Integrity policy.
- Test source now covers 100 document open/close cycles and 1000 body create/delete cycles over type 3/type 7 RPC. It records elapsed time and process resources for fixed-count loops and checks handle growth after warm-up. Runtime results are still required before claiming the resource acceptance item.
- Native coverage now requires real OCCT sphere meshes to reach 500k and 1M triangles and records tessellation time plus Windows process metrics. No runtime measurements were produced here. GPU memory, interaction, save time, high feature count, many bodies, and large STEP-file measurements remain unverified.
- Crash E2E source now covers all three process types after a committed box/autosave; hosted runtime is pending. Preview, sketch solve, recompute, save, STEP import, and large-tessellation interruption windows remain uncovered.
- The new 25-cycle STEP-import and 20-cycle OCCT tessellation stress tests are source-covered and compiled/linked, but Smart App Control prevented GoogleTest discovery, so neither ran. Viewport/plugin stress, clean Windows host install/run, and timed beginner UX audit remain unverified.
- Golden workflow, crash recovery, and 21-body performance E2E results are not fresh evidence for this run.

## Architecture and protocol

No protocol schema change. The canonical OCCT core, versioned JSON session-control v1, FlatBuffers mesh protocol, existing typed command path, and Quest-as-client boundary remain in place; type 7 now deletes supported leaf features through OCAF.

## Performance and known limitations

No fresh runtime performance figures. Existing handoff/report figures are historical and were not reused as current results. The installer and ZIP were produced and their native payloads inspected, but neither was installed or launched. The OCCT DLL policy block, clean-host installation, and application startup remain unverified.

**Gate:** Phase 10 is not complete. Keep Phase 11–16 stopped until the native test/runtime can execute under an approved Code Integrity policy, publisher entitlement and runtime servicing are confirmed, a clean-host install/startup is verified, and the required E2E/resource/performance acceptance checks have fresh evidence.
