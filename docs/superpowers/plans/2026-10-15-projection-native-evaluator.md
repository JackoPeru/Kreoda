# Native projection evaluator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Separate GPT-6-Luna/Max implements this task; parent verifies, reviews and accepts its immutable result.

**Goal:** Evaluate native edge projection, true apparent silhouette and plane intersection for the full roadmap15.2 workflow.

**Architecture:** Pure OCCT functions consume resolved native topology plus the existing SketchPlane and return native world-coordinate edges. Source identity, sketch ownership, persistence and clients follow in explicitly required later stages.

**Tech Stack:** Existing native C++17 (the separate PlaneGCS target uses C++20), OCCT8.0.1, GoogleTest and CMake; no new dependency or standard change.

**Spec:** docs/superpowers/specs/2026-10-15-phase15-projected-geometry.md

## Global constraints

All source/geometry work is local and hidden; no server/Hermes/AI/SSH/device/mic/camera/audio/foreground action. Preserve old native IDs/schema/lifecycle. Do not change existing model/store/solver/protocol code in this evaluator task. Full15.2 and original Phases12-16 remain open after this stage.

## Review focus

- Source TopLoc_Location and tilted/translated target basis: native world geometry correct exactly once.
- Curved/trimmed/closed edge projection: retain native curves, bounds and holes; no polyline surrogate.
- Silhouette excludes internal visible sharp edges, includes holes and oblique outline; area/coplanarity tests prove semantics.
- Disjoint, collapsed, null or malformed inputs: explicit failure and untouched output/source/global state.
- Deterministic repeat evaluation and reversed source orientation: no accumulated transform, source mutation or duplicate silhouette contours.

## Task1: pure native evaluator

**Owned files only:**
- New native/kreoda-core/src/features/sketch/projected_geometry.h
- New native/kreoda-core/src/features/sketch/projected_geometry.cpp
- New native/kreoda-core/tests/test_projection.cpp
- native/kreoda-core/CMakeLists.txt (source/link additions only)
- native/kreoda-core/tests/CMakeLists.txt (source/link additions only)

**Interfaces:** under KREODA_WITH_OCCT, expose bool-return functions in namespace kreoda:

`ProjectNativeEdgesToPlane(const std::vector<TopoDS_Edge>& source, const SketchPlane& target, std::vector<TopoDS_Edge>* output, std::string* error)`

`ProjectNativeSilhouetteToPlane(const TopoDS_Shape& source, const SketchPlane& target, std::vector<TopoDS_Edge>* output, std::string* error)`

`IntersectNativeShapeWithPlane(const TopoDS_Shape& source, const SketchPlane& target, std::vector<TopoDS_Edge>* output, std::string* error)`

Use existing ValidateSketchPlane; OCCT includes stay outside namespace. Return world CAD-mm edges. Publish output only after the entire operation validates. Error may be null. Do not create a second source-resolver, sampling format, protocol or store.

- [ ] Write meaningful GoogleTest fixtures named Projection.*. Establish RED on geometric behavior, not merely a missing header/compiler/link error. Minimal API stubs may be used only to reach behavioral RED, then replaced.
- [ ] Test translated/rotated source edge location and nonprincipal target; endpoints/sampled native curve points lie on the plane within declared tolerance and match analytic projection.
- [ ] Test trimmed arc and oblique circle projection retain genuine curved geometry (ellipse where appropriate); evaluate native length/point/closure, not only list size. Test closed loop orientation/area.
- [ ] Test sphere silhouette circle and an oblique box's closed outer contour with analytic projected area; internal visible creases excluded. Test an annular native face preserves its inner contour.
- [ ] Test sphere section radius sqrt(r*r-d*d) and nonprincipal frame; disjoint section explicit, output unchanged. Test null/malformed/nonfinite/collapsed inputs, repeat calls, source topology unchanged.
- [ ] Implement via existing OCCT GeomProjLib/HLR/BRepAlgoAPI tools. Inspect installed headers/API details; no guessed renderer geometry or hardcoded fixture output. Add TKHLR linkage only if actually required.
- [ ] Configure an isolated output build outside the repo, with real OCCT, stub OFF and crash barriers OFF. Reuse existing C:/vcpkg toolchain and installed x64-windows dependencies; do not alter the human checkout or active native production build. Suggested output C:/Users/matte/Documents/Codex-tools/Native/phase15-projection-kernel-20261015/build. Read existing cache for exact dependency paths; keep build artifacts out of Git.
- [ ] Build existing kreoda-core-tests target; run all Projection.* fixtures with actual discovery/nonzero count and all existing native regression cases. Retain exact configure/build/test logs and counts. No green claim with skipped/missing discovery.
- [ ] Return complete owned diff, actual command/results, source hashes, output native build location and remaining next-stage requirements. Do not commit/push/merge or touch docs; parent owns immutable snapshot/acceptance.

Later stages in the spec remain mandatory. A passing evaluator is not an associative projected-sketch product acceptance.
