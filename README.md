# Kreoda

Hybrid native/web desktop CAD — **B-Rep parametric core, direct manipulation, intent inference** (see `KREODA_ARCHITECTURE_AND_BUILD_SPEC.md`, the architecture contract).

```
Electron 44 + React 19.3 + Vite 8 + Tailwind 4 + Three.js
        │  FlatBuffers framed IPC (stdin/stdout, protocolVersion = 1)
        ▼
C++17 cad-core sidecar — OCCT 8.0.1 + OCAF/TNaming + PlaneGCS + lib3mf
```

## Layout (§38)

```
kreoda/
├ apps/desktop/          # Electron + React + Three.js viewport
├ native/cad-core/       # C++17 sidecar (owns canonical model, §9)
├ packages/
│  ├ protocol/           # TS framing + zod validation + types
│  ├ command-schema/     # typed command registry schemas (§19)
│  ├ units/              # mm/rad canonical units + parsing (§43)
│  └ plugin-sdk/         # sandboxed JS plugin API (§47)
├ schemas/cad_protocol.fbs
├ scripts/
└ docs/
```

## Prerequisites (Windows first, §1)

- Node.js 22+, pnpm 10 (`npm install -g pnpm`)
- CMake 3.28+, MSVC 2022 (BuildTools ok) + Windows SDK
- vcpkg (manifest mode, baseline committed in `native/cad-core/vcpkg.json`)
- FlatBuffers compiler `flatc` (via vcpkg / pip) for regenerating IPC bindings

## Quick start (Phase 0 bootstrap)

```powershell
pnpm install
pnpm --filter @kreoda/desktop dev     # Vite renderer only
pnpm --filter @kreoda/desktop start   # Electron + sidecar

# Native core (first configure downloads OCCT 8.0.1 — large, one-time):
cmake -S native/cad-core -B native/cad-core/build -DCMAKE_BUILD_TYPE=Release
cmake --build native/cad-core/build --config Release
.\native\cad-core\build\Release\kreoda-core.exe --self-test
```

## Release packaging

```powershell
pnpm --filter @kreoda/desktop package
pnpm --filter @kreoda/desktop make
```

`electron-forge package/make` requires a hoisted install layout with pnpm:
`pnpm config set node-linker hoisted` (or `echo "node-linker=hoisted" >> .npmrc`)
followed by a fresh `pnpm install`. Dev, unit tests and Playwright E2E all
run on the default isolated layout.

## Architecture rules (from spec, non-negotiable)

1. Canonical model is **B-Rep (OCCT)**, never triangles (§0.1).
2. **Never persist face/edge array indices** — OCAF/TNaming + semantic fallback (§3–§4).
3. UI never owns authoritative CAD state (§0.3, §9).
4. Every operation is a **typed command**; AI emits only validated commands (§0.4–0.5).
5. Preview ≠ commit; one drag = one Undo step (§0.6, §12–§13).
6. Renderer never runs CAD; core never knows Three.js (§67). No `fs`/`child_process` in renderer (§48).
7. IPC versioned (`protocolVersion = 1`), binary meshes only (§8, §14).

## Build phases

Phase 0 (this bootstrap): monorepo → Electron window → Three.js viewport → sidecar `GetCoreInfo` ping/pong → CI green.
Phase 1+: `CreateBox` B-Rep loop → topology selection → feature DAG → sketches (PlaneGCS) → solid features → beginner UX → NL commands → hardening (§61).

## Licensing notes

- OCCT: LGPL-2.1 + exception — link **shared** in proprietary builds, ship notices (§2.2).
- PlaneGCS (FreeCAD): LGPL-2.1 — keep behind `ISketchSolver`, own shared lib (§5).
- FlatBuffers/Manifold: Apache-2.0. SolveSpace: GPLv3 — **do not link** in proprietary builds (§5.2).
- JSketcher: do not copy without licensing review (§6.3).
