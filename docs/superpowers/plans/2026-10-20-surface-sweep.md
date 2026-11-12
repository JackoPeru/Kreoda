# Surface Sweep Implementation Plan

> Execute through the user's selected separate GPT-6-Luna/Max task. Parent reviews,
> verifies and delivers; no root product implementation or additional reviewer.

**Goal:** Exact associative surface sweep along a connected sketch path.

**Architecture:** Copied exact OCCT pipe shells, ordinary feature lifecycle and
existing surface classifiers. Explicit two-sketch roles use the fenced generic
command context; no new mesh or persisted geometry-kind contract.

**Tech Stack:** C++/OCCT 8.0.1, FlatBuffers, TypeScript/Zod/React, C#/Unity 6000.3.25f1.

**Spec:** `../specs/2026-10-20-surface-sweep-design.md` (read completely).

## Global constraints

- Preserve all dirty work; only `Kreoda-phase10-ci` worker-owned files.
- Latest user instruction: product implementation only separate GPT-6-Luna/Max.
- Exactly command 53, type SurfaceSweep, params tolerance, ordered two dependencies.
- Pinned Unity 6000.3.25f1; no runtime UI/auth/shader changes or remote calls.
- No installation or foreground app by worker; parent verifies and delivers.
- Original full goal remains active after this increment.

## Review focus

- Canonical path start differs from authored entity order: deterministic placement.
- Closed path/profile still produces a surface: no physical solid measurements.
- OCCT mutates shared topology: copy sources and prove source fingerprints unchanged.
- Failed component or self-intersection: reject entire operation without history.
- Reversed selection/stale lineage: deterministic roles or fenced refusal.

## Task 1: Native geometry and lifecycle

Files: new `native/kreoda-core/src/features/surface/surface_sweep.h`, new
`native/kreoda-core/tests/test_surface_sweep.cpp`; exact extensions to
`tests/CMakeLists.txt`, `src/model/geometry_kind.h`, `src/model/shapes.cpp`,
`src/features/rebuild.cpp`, `src/features/primitives/primitives.cpp`,
`src/protocol/dispatcher.h`, `src/protocol/dispatcher.cpp`.

Interfaces: `BuildSurfaceSweepShape(profileSketchId, pathSketchId, toleranceMm,
TopoDS_Shape*, std::string*)`; `CreateSurfaceSweepFeature(featureId, profileSketchId,
pathSketchId, toleranceMm, error)`; `RebuildSurfaceSweepFromStore(featureId, error)`.
Use shared surface/sew-offset helpers; avoid duplicating wire/validation algorithms.

- [x] Preserve preimages and hashes for every owned existing file.
- [x] Add real RED tests: unknown command53 plus analytic rectangle/cylinder/torus,
  budgets, alignment, failure atomicity and both upstream dependencies.
- [x] Implement exact builder and creation as specified; no approximate fallback.
- [x] Integrate params/tolerance edit, candidate, rebuild and exact surface kind.
- [x] Verify focused tests, including multiple profiles/corner path/world placement,
  source invariance, instance, undo/redo and OCAF/ICAD persistence.

## Task 2: Contracts and clients

Files: `schemas/cad_protocol.fbs`, `packages/protocol/src/index.ts`; affected enum
outputs only native `src/protocol/generated/cad_protocol_generated.h`, TS
`src/generated/kreoda/protocol/command-type.ts`, C# `csharp/Generated/CommandType.cs`;
`packages/command-schema/src/index.ts`, `native-command.test.ts`; Desktop
`electron/session-queries.ts`, new `tests/surface-sweep-context.test.ts`,
`tests/bodies.test.ts`, `tests/surface-properties.test.tsx`,
`src/components/PropertiesPanel.tsx`, `src/i18n/{commands,en,it}.ts`;
Quest `Runtime/QuestConnection.cs` exact classifier,
`Tests/Editor/QuestConnectionTests.cs`, `Tests/Editor/QuestSectionTests.cs`,
`Editor/QuestSurfaceRender.cs` explicit provenance/camera support only.

- [x] RED strict schema/defaults/creation-count tests and two-sketch binding fences.
- [x] Append enum53, schema, exact type classifiers, ordered first/secondSketch
  bindings and localized command/type/tolerance properties.
- [x] Run command-schema/protocol tests, focused Desktop tests and TypeScript check.
- [x] Run focused Quest classifier/section checks only with frozen sources and
  pinned Editor; report actual direct exit/XML, do not start full Editor suite.
- [x] Freeze sources and return exact changed-file report, verification and gaps.

Parent performed the focused Quest gate with the actual pinned Editor: 43/43.

## Task 3: Parent acceptance and delivery

- [x] Review baseline-relative diff and scope; independently build actual native
  executable and run full native/contracts/Desktop checks.
- [x] Run actual native stdio analytic/source-invariance/persistence proof and
  hidden Electron context/properties workflow with current executable.
- [x] Feed actual sweep mesh and payload provenance into offline Quest GPU proof;
  inspect both-side/section pictures and preserve all legacy assertions.
- [x] Package Desktop and canonical ARM64 client if runtime/managed inputs changed;
  guard sources, back up existing installed artifacts/profile and preserve trust.
- [x] Install hidden after idle session gate, read back hashes and verify catalog;
  no claim of physical acceptance or entire full-goal completion.
- [x] Write verification evidence; full goal remains active through Luna.

Evidence: `../evidence/2026-10-21-surface-sweep-verification.md`.

## Remaining full goal (not completed by this increment)

- [ ] Manual surface-creation UI, then general trim/extend/thicken.
- [ ] Remaining assembly mates and general direct face editing.
- [ ] Live Hermes/MCP/voice benchmark when permitted, and physical Quest acceptance.
