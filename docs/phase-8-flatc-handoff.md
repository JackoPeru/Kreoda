# Phase 8 (flatc slice) → handoff

Phase 8 §61 entry is done for its first slice: `flatc` generates C++ and TS
bindings from the single canonical `schemas/cad_protocol.fbs`, and parity
tests guard both sides. Transport is UNCHANGED (JSON) — the migration slice
comes later and must keep every E2E below green while swapping the wire.

## What landed

- `packages/protocol/scripts/codegen.mjs` (`pnpm --filter @intentcad/protocol codegen`):
  resolves vcpkg `flatc.exe` (flatc 25.12.19, fallback: PATH), emits `--cpp --ts`,
  copies `cad_protocol_generated.h` → `native/cad-core/src/protocol/generated/`
  and the `intent-cad/` TS tree → `packages/protocol/src/generated/intent-cad/`.
  The `intent-cad/` root is preserved — generated files import each other via
  relative `../../intent-cad/...` paths, so flattening breaks them.
- `packages/protocol/src/codegen.test.ts`: generated `CommandType` equals the
  handwritten registry for every key; a CreateBox `CommandEnvelope` round-trips
  (fields + union payload) through the generated builders. 10/10 package tests.
- `native/cad-core/tests/test_codegen.cpp`: 23 `static_assert`s (`.fbs`
  `CommandType` vs `dispatcher.h` `CommandId`) + gtest envelope round-trip.
  Guarded by `INTENTCAD_WITH_FLATBUFFERS` (skips cleanly without flatbuffers).
- CMake: `intentcad-protocol-codegen` custom target regenerates the header when
  the `.fbs` changes (probes build-dir + manifest-root vcpkg layouts, then PATH;
  warns and uses the committed file if flatc is absent). Core + tests depend on it.
- `tsconfig.build.json` split: `build` emits without `**/*.test.ts`, `lint`
  typechecks everything (`noEmit`).

## Verified

- `pnpm -r lint/test/build` green (protocol 10 tests, desktop 34).
- `ctest -C Release`: 58/58 incl. `Codegen.CreateBoxEnvelopeRoundTrips`.
- Playwright: 10/10 (transport untouched, as required).

## Hard-won notes (do not regress)

- flatc TS output is version-agnostic here (flatc 25.12 vs npm runtime 25.9 —
  the round-trip test proves compat; pin or re-verify on bump).
- `import.meta.dirname` in codegen.mjs needs Node ≥ 20.11 (engines: ≥ 22, fine).
- CMake's `VCPKG_INSTALLED_DIR` points at the per-config build dir, NOT the
  manifest root — probe both for `flatc`.
- TS enums have reverse mappings: cast via `unknown` for record comparison.
- Next slice (transport migration) must keep the JSON path working until all
  E2E pass on FlatBuffers; `decodeMeshResponse`/base64 stays until then.
