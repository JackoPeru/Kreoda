# Third-party notices — Kreoda (Phase 8 §61)

Versions verified against `pnpm-lock.yaml` and the vcpkg install tree
(`native/kreoda-core/vcpkg.json`, builtin-baseline `e6f9e70a`). Per-package
SBOMs ship with vcpkg (`share/*/vcpkg.spdx.json`).

## Runtime — geometry kernel (native sidecar)

- OpenCASCADE 8.0.1 — LGPL-2.1. Linked SHARED (`BUILD_SHARED_LIBS ON`,
  `CMakeLists.txt`) for LGPL compliance; no static OCCT in the binary.
- lib3mf 2.5.0 — BSD-2-Clause (3MF exchange).
- FlatBuffers (C++ runtime + `flatc` 25.12.19; npm `flatbuffers` 25.9.23) —
  Apache-2.0 (IPC codegen).
- Manifold 3.5.3 — Apache-2.0.
- Eigen 5.0.1-dev — MPL-2.0 (sketch solver).
- Boost 1.92 — BSL-1.0 (sketch solver graph/math).
- minizip-ng 4.1.0 — zlib/libpng license (`.icad` container).
- Clipper2 (OCCT transitive) — BSL-1.0. freetype (FTL), libpng (libpng
  license), zlib (zlib license), brotli (MIT), bzip2/lzma/zstd (BSD-style,
  OCCT transitives).

## Runtime — desktop shell

- Electron 44.4.2 — MIT. React 19.3.0 + React-DOM — MIT.
- three.js 0.186.0 — MIT. three-mesh-bvh 0.9.2 — MIT.
- zustand 5.0.15 — MIT. zod 3.25.76 — MIT. xstate 5.24.0 — MIT.
- cmdk 1.1.1 — MIT. lucide-react 0.545.0 — ISC. Radix primitives — MIT.

## Build / test only (never shipped)

- TypeScript 5.9.3, Vite 8.3.0, Vitest 4.1.11, Playwright 1.63.0,
  electron-forge 7.10.2 — MIT/Apache-2.0. GoogleTest 1.18.0 — BSD-3-Clause.

## Telemetry

None. Kreoda collects no usage data; the in-app telemetry switch
(CommandBar ⚙) defaults OFF, and no collection backend is wired — enabling
it records nothing. Network traffic is limited to the user-configured
optional LLM endpoint, if any.
