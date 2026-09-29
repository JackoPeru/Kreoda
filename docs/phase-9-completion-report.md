# Phase 9 Completion Report

**Status: implementation baseline accepted for Phase 10 validation**  
**Ready for Phase 10: YES**

Phase 9a–9d feature handoffs exist. Per the task direction, Phase 10 proceeds and owns the remaining integration/runtime validation. This task did not change application or protocol source.

## Implemented

- Phase 9a: expression-driven parameters — [phase-9a-expressions-handoff.md](phase-9a-expressions-handoff.md).
- Phase 9b: sandboxed plugins — [phase-9b-plugins-handoff.md](phase-9b-plugins-handoff.md).
- Phase 9c: reference Stage A — [phase-9c-reference-handoff.md](phase-9c-reference-handoff.md).
- Phase 9d: rigid instances — [phase-9d-assemblies-handoff.md](phase-9d-assemblies-handoff.md).
- Current committed code includes on-demand tip-mesh hydration for `CreateHolesCorners` and a scoped `openMore` selector. The old [ARCH_CORRECTION_REPORT.md](ARCH_CORRECTION_REPORT.md) records these areas as open; their fixes were not E2E-verified in this run.

## Tests and build evidence

- `pnpm test:all` — **FAIL** at `pnpm test:native`; `kreoda-core-tests.exe` exits with `3236495362` (`0xC0E90002`). The command stops before its later steps.
- `Get-WinEvent` on `Microsoft-Windows-CodeIntegrity/Operational` — events 3077/3033 identify Code Integrity blocking `TKGeomAlgo.dll` for `kreoda-core-tests.exe` and `TKFillet.dll` for `kreoda-core.exe`; event 3118 records Smart App Control details. No OS security policy was changed.
- `cmake --build native\kreoda-core\build --config Release --target kreoda-core` — **PASS**, exit 0. Cache has `WITH_OCCT=ON` and `KREODA_ALLOW_STUB_CORE=OFF`. Generated protocol header SHA-256 was unchanged across the build.
- `cmake --build native\kreoda-core\build --config Release --target kreoda-core-tests` — source compilation reached the test executable, then failed during GoogleTest discovery because launching it to list tests loads the blocked OCCT DLL.
- `ctest --test-dir native\kreoda-core\build -C Release --output-on-failure --parallel 1` — **NOT RUN**; CTest reports `kreoda-core-tests_NOT_BUILT` because GoogleTest discovery did not complete.
- `pnpm -r exec tsc --noEmit` — **PASS**, exit 0.
- `pnpm -r test` — **PASS**: desktop 18 files / 76 tests; protocol 3 / 16; plugin SDK 1 / 2; units 2 / 4. Command-schema has no test files. Total: 98 tests.
- `pnpm test:dotnet` — **PASS**, 21/21.
- `pnpm -r build` — **PASS**, including workspace packages, renderer, Electron main, and preload. Vite reports the existing >500 kB chunk warning (`three.module` 614.50 kB).
- Phase 9 and Phase 10 Playwright E2E, crash, and performance scenarios — **NOT RUN**. The shared `boot()` and Phase 10 specs launch a visible `BrowserWindow`, and the real sidecar is blocked by Code Integrity before those scenarios can exercise native behavior.

## Architecture and protocol

No architecture or protocol changes in this task. The canonical OCCT core, JSON session-control v1, FlatBuffers mesh protocol, typed commands, and Quest-as-client boundary remain as specified.

## Performance and limitations

No fresh performance measurements. Prior handoff numbers are historical and are not treated as current evidence. Clean-host installer behavior and all hardware-only checks remain unverified.

**Gate:** Phase 9 implementation baseline is accepted for Phase 10. This is not a claim that native runtime or E2E passed; see [phase-10-completion-report.md](phase-10-completion-report.md) for carried validation gaps and the Phase 10 gate.
