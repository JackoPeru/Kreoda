# Phase 8 (STL slice) → handoff

Binary STL import/export is done through the existing Save/Open path, same
extension-branch pattern as STEP/3MF — no protocol change. Export pre-meshes
every solid at export deflection; import extracts the triangulation and sews
it through the shared faceted path into `MeshImport` solids (one Undo step).

## What landed

- `native/kreoda-core/src/exchange/sew.{h,cpp}` (new, shared):
  `SewTrianglesToSolids` (flat soup → closed solids, 1e-6 sewing) and
  `ExtractTriangles` (triangulated faces + locations → flat soup, mm).
  `threemf_exchange.cpp` now uses it (3MF behavior unchanged, ctest proves).
- `native/kreoda-core/src/exchange/stl_exchange.{h,cpp}` (new): `ExportStl`
  (compound → export-deflection pre-mesh → binary `DESTL_Provider::Write`)
  and `ImportStl` (read → extract → sew → `MeshImport` per solid, one OCAF
  command, `stl-<12hex>` ids). Same stdout `MuteMessenger` guard as STEP.
- `dispatcher.cpp`: `.stl` branches in Save/Open; extension chain now
  .icad/.step/.3mf/.stl (getting long — table-drive it if a fifth arrives).
- CMake: `TKDESTL` linked (core + tests).
- C++ `tests/test_stl.cpp`: round-trip volume/bbox, tessellation, Undo/Redo
  atomicity, empty-export honesty.
- UI: dialogs accept `.stl`; toolbar titles + command-bar hint list all four
  formats.
- E2E `e2e/phase8-stl.spec.ts`: box → export → import (volume-exact) →
  `.icad` persist/reopen.

## Verified

- `pnpm -r lint/test/build` green; ctest 64/64; Playwright 14/14.

## Hard-won notes (do not regress)

- `DESTL_Provider::Write` does NOT mesh by itself — pre-mesh the shape with
  `BRepMesh_IncrementalMesh` (0.01 mm / 0.05 rad, same as LOD-2 export) or
  Write returns false with no message.
- No `TKSTL.lib` in this OCCT build — classic `StlAPI_*` is unlinkable; the
  DE framework (`DESTL_Provider`, `TKDESTL`) is the only STL path.
- `DESTL_ConfigurationNode().InternalParameters.WriteAscii` selects
  ASCII/binary; binary is the default we ship (smaller, float32-precise).
- OCCT 8 has no 3-point `BRepBuilderAPI_MakeFace` — polygon → wire → face;
  the `TopoDS::Shell` downcast needs `<TopoDS.hxx>` (kept in `sew.cpp` so no
  importer repeats this).
- STL is unitless: we treat it as millimeters (matches the 3MF slice).
- Remaining Phase 8: OBJ/glTF, large-model optimization, signed updater
  (needs certs/infra — ask first), FlatBuffers transport migration, license
  notices, telemetry opt-in, crash bundle, more topology regression tests.
