# Phase 8 (OBJ/glTF slice) → handoff

OBJ (both directions via `DEOBJ_Provider`) and glTF 2.0 (hand-written mesh
profile: `.gltf` export, `.gltf`+`.glb` strict import) ride the same Save/Open
extension dispatch — no protocol change. Mesh imports sew into `MeshImport`
solids (one Undo step); glTF follows its meters/Y-up conventions with explicit
conversion both ways. Shared import/commit/mute helpers now live in `sew.*`.

## What landed

- `exchange/sew.{h,cpp}` extended: `CommitImportedSolids` (mint + one OCAF
  command) and `ScopedMute` (stdout guard); STEP/3MF/STL refactored onto them
  (behavior unchanged — full ctest proves).
- `exchange/obj_exchange.{h,cpp}`: pre-meshed `DEOBJ_Provider` write,
  triangulation-extract + sew import; `FileLengthUnit = 0.001` (mm).
- `exchange/gltf_exchange.{h,cpp}`: writer (POSITION+NORMAL+indexed TRIANGLES,
  `.bin` sidecar, Y-up/meters) + strict reader (minimal JSON DOM, matrix/TRS
  nodes, u16/u32 indices, non-indexed soup, flat normals when absent,
  external `.bin` + data: URIs with `..` traversal rejected, GLB chunks).
- `dispatcher.cpp`: `.obj`/`.gltf` save+open branches; `.glb` writes rejected
  honestly (imports fine).
- CMake: `TKDEOBJ` linked; no new dep for glTF (hand-written).
- C++ `test_obj.cpp`, `test_gltf.cpp` (round-trip + GLB wrap + bad-JSON +
  empty-export); E2E `phase8-obj/gltf.spec.ts`; dialogs/titles/hints updated.

## Verified

- `pnpm -r lint/test/build` green; ctest 70/70; Playwright 16/16.

## Hard-won notes (do not regress)

- `DEOBJ` defaults `FileLengthUnit = 1.0` (meters): mm files import 1000×
  off without `= 0.001` (STL has no such conversion — unitless).
- `DE*_Provider::Write` needs a PRE-MESHED shape (STL proved it, OBJ same);
  STEP transfers B-Rep and does not.
- Core target treats warnings as errors (`/WX`): `int`→`signed char`
  narrowing in the base64 decoder blocked the link while the tests target
  passed — a stale `kreoda-core.exe` then round-tripped a misnamed zip
  (Box came back from ".obj"), masking the missing branch. Always check the
  exe timestamp + build exit status after native edits.
- glTF Y-up/meters conversions are exact inverses; normals rotate only.
- Remaining Phase 8: large-model optimization, signed updater (certs/infra),
  FlatBuffers migration, license notices, telemetry opt-in, crash bundle,
  more topology regression tests.
