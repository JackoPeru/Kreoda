# Exact native projected profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. A separate GPT-6-Luna/Max task implements; parent verifies and obtains a fresh immutable review. The user's explicit quota fallback applies if that lane fails for usage limits.

**Goal:** Feed exact projected native edges into planar profiles and ordinary native extrusion/revolution, preserving holes and disconnected regions.

**Architecture:** Reuse the existing sketch face builder and OCCT topology. Generalize its profile assembly to classify actual closed native wires by containment, returning a face or compound of faces. Existing authored sketch geometry and additional resolved projection edges use the same assembly. Projection ownership, references, persistence and canonical client commands remain the next required lifecycle packet.

**Tech Stack:** Existing native C++17, OCCT8.0.1, GoogleTest/CMake; no new dependency or CAD approximation.

**Spec:** docs/superpowers/specs/2026-10-15-phase15-projected-geometry.md

## Global constraints

- Hidden local work only. No server/Hermes/SSH/Tailscale/AI probes, remote changes, device/ADB, mic/camera, PC audio or foreground GUI.
- Preserve the dirty human checkout and concurrent changes. Use the existing isolated native output build, real OCCT ON, stub and crash barriers OFF.
- Native geometry stays in world CAD millimetres; local sketch coordinates are used only for validated frame transformations/classification.
- Retain genuine circles, ellipses, splines and trim/orientation. No tessellation or sampled polygon used as authoritative profile geometry.
- Existing APIs and ordinary single-region sketch behavior remain compatible. Do not add public protocol IDs, projection-group persistence or UI in this packet.
- No commit/push by worker; parent owns freeze, evidence, review and integration. This packet alone does not complete15.2 or the full goal.

## Review focus

- Disconnected closed regions are separate material regions; a smaller disconnected loop must never become a hole in the largest loop.
- Nested loops follow containment parity: outer material, hole, inner island, with arbitrary input order and orientation. Preserve every supported authored loop.
- Ambiguous intersecting, touching or duplicate boundaries fail explicitly rather than being repaired into different material. Open/nonplanar/nonfinite/collapsed edges also fail atomically.
- Profile construction must not mutate the caller's native source edges, including shared source topology. Respect OCCT safe processing before building algorithms that could alter topology.
- Exact closed curves have coincident endpoints. Do not infer curve area from endpoints or discard small valid loops using a display threshold.

## Owned files and interfaces

The worker owns only:

- native/kreoda-core/src/features/sketch/sketch_face.h
- native/kreoda-core/src/features/sketch/sketch_face.cpp
- native/kreoda-core/src/features/extrusion/extrude.cpp
- native/kreoda-core/src/features/revolve/revolve.cpp
- native/kreoda-core/tests/test_projection.cpp
- native/kreoda-core/tests/test_sketch.cpp

Preserve `BuildFaceFromSketch(const SketchFeature&, TopoDS_Face*, std::string*)`: delegate to the shared implementation and succeed only for exactly one material face. Multiple disconnected regions cannot be represented by that return type and must fail explicitly there.

Under KREODA_WITH_OCCT, add to namespace kreoda:

```cpp
bool BuildPlanarProfileFromEdges(const std::vector<TopoDS_Edge>& edges,
                                const SketchPlane& plane,
                                TopoDS_Shape* output, std::string* error);
bool BuildProfileFromSketch(const SketchFeature& sketch,
                            TopoDS_Shape* output, std::string* error);
```

The first function returns a single face or compound of material faces, with native holes; output unchanged on failure, null error supported, null output rejected. It consumes resolved world native edges, not source definitions. The second converts existing authored line/circle/arc geometry through the current sketch frame and delegates. Future projection groups add their resolved edges at this seam; no unused speculative group type is added now. Extrude/revolve consume BuildProfileFromSketch so ordinary disconnected authored profiles use the same production path as projected profiles will use.

## Task: exact planar regions and production solid consumers

- [ ] Add behavioral tests that fail on the current one-largest-outer assumption; record real test failures, not compile/link errors.
- [ ] Build a closed oblique-circle projection with the accepted evaluator, pass its exact ellipse edge to BuildPlanarProfileFromEdges, and extrude the resulting native profile in the test. Verify analytic ellipse area, native volume, tilted/translated placement and source B-Rep unchanged.
- [ ] Test annulus, two disconnected circles and three nested circles with shuffled/reversed native edges. Verify expected analytic area, exact hole/island counts and material-face counts. Projected B-spline closure must retain native curves when a supported closed spline fixture is used.
- [ ] Test ambiguous touching/intersecting/duplicate boundaries, open edges and invalid target frame: explicit failure, previous output unchanged, source topology unchanged.
- [ ] Replace the largest-wire-only assembly with the smallest native OCCT containment-based assembly that satisfies those tests. Reuse existing validation and frame helpers where appropriate; keep unrelated source unchanged.
- [ ] Update actual Extrude/Revolve builders to consume the profile shape. Add production CreateSketch->Extrude and CreateSketch->Revolve cases with disconnected authored closed regions, measured native volume/solid counts, tilted frame where applicable, and unchanged existing single-region/hole cases. Do not infer acceptance from a test-only direct prism alone.
- [ ] Run focused Projection/Sketch/Extrude/Revolve tests with real OCCT. Then build normal core/tests in the isolated output and run complete CTest with XML; require no failures or skips and explicit nonzero discovery. Run core --self-test with System32/Windows-only PATH to prove app-local runtime.
- [ ] Return exact changed paths, commands, actual RED/GREEN counts, complete gate count, source-immutability evidence, remaining gaps and judgment calls. Parent independently reruns the gates, freezes the diff and requests fresh review before acceptance.

## Required continuation after this packet

Associative groups on SketchFeature; persistent source naming and owner lineage; graph/cycle/delete guards; atomic recompute and broken-reference repair with unavailable stale downstream geometry; OCAF/.icad/Undo/recovery; public canonical commands and typed schemas/session/MCP; compact Desktop and controller-free Quest controls; normal ARM64, hosted CI and permitted physical/live acceptance all remain required. This plan does not replace those stages.

## Evidence-driven scope amendment: transient Windows save publication

The first complete profile CTest gate passed249/250, failing the references-only save-cycle case. A separate complete rerun passed250/250. Parent authorized temporary diagnostic instrumentation in the existing failing assertion with exact restoration. The diagnostic reproduction failed on cycle39 with `SAVE_FAILED`, `save: publish failed: Accesso negato.` This identifies the failing atomic rename operation; it does not identify which process or Windows component denied access. It is not attributed to the profile algorithm or called preexisting without comparative evidence.

Parent explicitly extended the same worker's ownership to `native/kreoda-core/src/protocol/dispatcher.cpp` (saveAtomically helper only) and `native/kreoda-core/tests/test_torture_phase10.cpp` (restore diagnostic-only edits, then actual lock regression tests). Required minimal correction: retry only transient Windows destination-access/sharing failures for a short bounded interval, approximately150–250ms; retry rename only, never rewrite payload or remove the previous destination. Permanent failure still reports an explicit error and removes only its temporary file. Preserve ordinary non-Windows behavior and all existing crash/atomic-overwrite guarantees.

Required behavioral proof before implementation: a real native Windows destination handle denying delete/replace, released after a controlled short interval, causes the production SaveDocument path to fail on the old code and succeed on the correction. A persistent lock must still fail within the bound, retaining old bytes, document metadata/revision and no publication temp leftovers. Do not weaken the original test or accept stress retries as the fix. Preserve original failed/full-rerun logs. Run focused real-lock plus existing atomic-save gates, then the complete native suite and normal restricted-PATH self-test on restored final source. Parent independently verifies the enlarged eight-path product diff and complete gate before fresh immutable review.
