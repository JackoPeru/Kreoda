# Phase 1 → Phase 2 handoff

Phase 1 acceptance (§61) is green: UI dimensions produce exact OCCT solids,
save/reopen returns identical geometry, viewport shows only core tessellation.

## Verified Phase 1 results

- Box 100×50×20 → GProp volume exactly 100000; 12-triangle mesh, 6 role faces.
- Cylinder r10/h40 → 12566.4 (≈ π·100·40); caps `cyl.+Z/-Z` + `cyl.wall`.
- Sphere r15 → 14137.2 (≈ 4/3πr³); single `sph.all` face, 2994 tris at lod 1.
- `.icad` (manifest.json + BinXCAF document.xbf, minizip-ng) round-trips the
  identical solid: same UUID, same volume, same 12 triangles.
- E2E: dialog create → tree select → save → reopen identical + screenshot.

## Hard-won notes (do not regress)

- OCCT 8 constructs `BRepPrimAPI_*` makers lazily: call `Build()` before
  `IsDone()` (see `primitives.cpp`). An `IsDone()==false` with a valid shape
  means "not built yet", not "broken kernel".
- Never gate on `IsDone()` alone; gate on Build → IsDone → BRepCheck (§41).
- Zustand selectors must return stable references — derive tree items with
  `useMemo` on the stable `features` array, never fresh objects in a selector
  (React `getSnapshot` infinite loop otherwise).
- `vite.config.ts` needs `root: import.meta.dirname` (native ESM loader).

Phase 0 acceptance (§61) is green: app starts, sidecar starts, renderer gets
core version, clean shutdown, crash detection (Electron survives sidecar kill,
engine auto-restarts, UI banner + re-query).

## What runs now

- `pnpm dev` — vite :5173 + Electron + sidecar (dev URL).
- `pnpm start` — production `dist/` + sidecar.
- `pnpm -r lint|test|build` — all green. `test:e2e` (Playwright) boots the
  real shell and asserts `core 0.1.0` in the footer.
- `native/cad-core/build/Release/intentcad-core.exe --self-test` — framing +
  GetCoreInfo/CreateDocument/CreateBox over real stdio pipes.

## Known Phase 0 limits (by design)

- **OCCT unlinked (stub core).** `vcpkg.json` pins `opencascade>=8.0.1`,
  `flatbuffers`, `gtest`, `lib3mf`, `manifold`, but no vcpkg configure has run
  (large one-time download). Build with
  `-DCMAKE_TOOLCHAIN_FILE=<vcpkg>/scripts/buildsystems/vcpkg.cmake` to get the
  real kernel; `#if INTENTCAD_WITH_OCCT` marks every wiring point
  (`feature_graph.cpp`, tessellator → `BRepMesh_IncrementalMesh`,
  OCAF/`BinXCAF` persistence, STEP export).
- **IPC payload is JSON inside the §8 frame** (`[u32 LE len][payload]`).
  Framing, `protocolVersion` gate, requestId correlation and zod validation are
  final; `schemas/cad_protocol.fbs` is the contract for the `flatc` codegen
  that replaces the JSON bytes (C++ + TS) in Phase 1.
- **Viewport box is a frontend demo mesh** (`CadViewport.upsertBodyMesh`
  placeholder). Phase 1 must feed it exclusively from core tessellation (§67)
  and delete the demo geometry.
- **GTest suite skipped locally** (no GTest without vcpkg); CI installs it.
- **Forge `package`/`make` need `node-linker=hoisted`** (see README).

## Phase 2 entry (§61: topology-aware selection)

1. OCAF `TNaming` primary references (`TNaming_Builder/Selector/Tool`).
2. Topology regression tests (hole-on-face survives width change, dozens).
3. `flatc` codegen from `schemas/cad_protocol.fbs` (C++ + TS at once).
4. Face/edge/vertex picking with triangle→persistent-face mapping in the UI.
