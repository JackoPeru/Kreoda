# Phase 8 (3MF slice) → handoff

3MF mesh import/export is done through the existing Save/Open path, same
extension-branch pattern as STEP — no protocol change. Export dumps every
solid tessellated at export LOD in millimeters; import sews each mesh object
back into faceted `MeshImport` solids inside a single Undo step.

## What landed

- `native/cad-core/src/exchange/threemf_exchange.{h,cpp}`: `ExportThreeMF`
  (solids → `TessellateRecord(LOD 2)` → one lib3mf mesh object + build item
  each, unit MilliMeter) and `ImportThreeMF` (unit-scaled vertices →
  per-triangle faces → `BRepBuilderAPI_Sewing(1e-6)` → one `MeshImport`
  feature per closed shell, core-minted `mesh-<12hex>` ids, one OCAF command).
  Open meshes / degenerate-only meshes / unit-less garbage fail honestly.
- `dispatcher.cpp`: `.3mf` exports in `kSaveDocument` (replacing the
  `UNSUPPORTED_YET`); `.3mf` imports in `kOpenDocument` (fresh baseline +
  graph sync + revision, like STEP). Both import branches now read the type
  back from the store instead of hardcoding it.
- CMake: `find_package(lib3mf CONFIG)`, `KREODA_WITH_LIB3MF`, link
  `lib3mf::lib3mf` (core + tests); without it, honest stub errors.
- C++ `tests/test_threemf.cpp`: round-trip volume/bbox (60000 mm³, 1e-4
  bbox), tessellation non-empty, Undo/Redo atomicity, empty-export honesty.
- UI: open-dialog accepts `.3mf`; toolbar titles + command-bar hint cover
  all three formats (the stale "3MF arrives later" pointer is gone).
- E2E `e2e/phase8-threemf.spec.ts`: box → export → import (`MeshImport`,
  volume-exact, triangles > 0) → `.icad` persist/reopen.

## Verified

- `pnpm -r lint/test/build` green (incl. updated export-hint unit test).
- ctest 62/62 (new `ThreeMF.*`); Playwright 12/12.

## Hard-won notes (do not regress)

- lib3mf headers live under `include/Bindings/Cpp/` (`lib3mf_implicit.hpp`,
  not a top-level `lib3mf/` dir); `classParam<T>` takes raw `T*` or
  `shared_ptr<T>` — `AddBuildItem(obj.get(), …)` is correct.
- OCCT 8 has no 3-point `BRepBuilderAPI_MakeFace` — triangle → face goes
  polygon → wire → face (`MakePolygon(p1,p2,p3,True)` + `MakeFace(wire,True)`),
  and the `TopoDS::Shell` downcast needs `<TopoDS.hxx>` explicitly.
- lib3mf is quiet on stdout (no `MuteMessenger` needed), but keep watching
  test stdout for OCCT chatter on new code paths.
- Import unit conversion is explicit both ways (`UnitToMm`); export is always
  millimeters. Sewing tolerance 1e-6 in mm.
- `MeshImport`, like `StepImport`, honestly refuses parametric rebuild.
- Remaining Phase 8: large-model optimization, recovery journal + signed
  updater, FlatBuffers transport migration.
