# Associative native sketch projections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. The user's separate GPT-6-Luna/Max implementation task executes this packet after the active exact native profiles packet has been parent-accepted. Parent owns independent verification, immutable review and integration. Explicit user quota fallback applies to a terminal usage-limit failure.

**Goal:** Add genuinely associative native projection groups with reversible source binding, graph recompute, exact downstream solids, persistence and explicit broken-reference repair.

**Architecture:** SketchFeature owns group definitions, private native bindings and immutable evaluated edges. Reuse accepted pure OCCT evaluators and exact planar profiles. Shared dependency and geometry-availability functions keep lifecycle, queries, modeling and meshes consistent; no global ShapeStore metadata hiding. Canonical public commands/transport and client UI are a required following packet, not implicitly completed here.

**Tech Stack:** Existing native C++17/OCCT8.0.1, OCAF/TNaming, FeatureGraph, nlohmann JSON, GoogleTest/CMake; no dependency or standard change.

**Spec:** docs/superpowers/specs/2026-10-15-projection-groups-contract.md and its parent projected-geometry spec.

## Sequencing amendment, 2026-10-15

The profile/save candidate is frozen at 9b9fdff34eb3ed747ded2d47b9c79ce1d4f7d186. Parent independently verified 256 native tests, restricted-PATH normal-core self-test and 13 unchanged source hashes. Fresh review thread 01a14015-3500-7ae0-9165-02fb1b19d970 terminated with a usage-limit error and no verdict. Previous review findings have behavioral corrections, but final acceptance remains unproven.

The user's explicit instruction to continue development despite quota permits this next native lifecycle packet to proceed on that verified candidate. This supersedes only the acceptance-before-start sequencing below; it does not confer acceptance, permit quota-only reviewer retries, or waive later accumulated review and verification. The earlier worker is terminal and the shared build is free. Root owns this sequencing decision. No merge/release or Hermes/device activity is authorized by it.

## Global constraints

- Start only after exact native profiles acceptance. Do not overlap the current worker's six product paths or build.
- Hidden local operations only; no Hermes/server/SSH/Tailscale/AI probes or changes, device/ADB, mic/camera, PC audio or foreground GUI. Preserve the human dirty checkout.
- Native geometry is world CAD-mm; projection samples are presentation only. Curves, trim/orientation and source topology remain native and read-only.
- No public command dispatch, TypeScript/C# schema, generated contract or UI change in this native packet. Reserved36–38 are exposed together with their canonical schemas in the required following packet. Native direct APIs and actual existing read/query/modeling guards must be complete here.
- Group mutation is one ordinary owner-checked OCAF command, or joins an existing session transaction. It preserves IDs and rollback of all stores, selections, graph, revision and Undo counts. No source binding in a query.
- Maximum128 groups per sketch; maximum128 source references per group and128 unique entityIds in one sketchEntities source; definition UTF-8 maximum65536 bytes; maximum2000 total resolved projection edges per sketch, plus the existing ordinary entity validation. Reject exceeded limits atomically; never truncate CAD output. Stable group/source-owner IDs reuse ShapeStore::ValidFeatureId. Entity IDs reuse actual existing sketch entity identity rules, with duplicates/empty IDs rejected.
- A malformed persisted record is rejected. A structurally valid record with unresolved native lineage loads as explicitly broken and blocks current dependent geometry, preserving unrelated branches and a repair path.

## Interfaces

Add `SketchProjectionGroup` in the sketch-owned model with stable groupId, validated definitionJson, private bindingsJson, derived status/error and immutable native evaluated edges under KREODA_WITH_OCCT. No source-coordinate snapshot is authoritative. Runtime output/cache/status is recomputed after load and is not trusted from saved JSON.

Add a focused `features/sketch/sketch_projection.h/.cpp` module. Public native entry points:

```cpp
bool SetSketchProjectionGroup(const std::string& sketchId,
                              const std::string& groupId,
                              const std::string& definitionJson,
                              std::string* error);
bool RemoveSketchProjectionGroup(const std::string& sketchId,
                                 const std::string& groupId,
                                 std::string* error);
std::vector<std::string> SketchDependencies(const SketchFeature& sketch);
```

Set creates/replaces or deliberately repairs exactly that group; Remove requires an existing group. Validate/parse definitions and source compatibility once in this module, reused by JSON persistence and mutation. Add narrowly scoped internal staging/evaluation entry points for incoming source records and a checked OCAF resolver; staging must use the incoming records/document, not accidentally consult current global stores from the previous document.

The ordinary sketch group-free path remains compatible. BuildProfileFromSketch appends healthy group's exact native edges to ordinary geometry at the shared native-profile seam. Any broken group fails the full profile; no partial material region is accepted. Source sketchEntities convert the actual current solved source entities through its own frame. Reject missing/duplicate/ambiguous line/circle/arc IDs, degenerate results and broken source-sketch availability.

Add `model/geometry_availability.h/.cpp` with one derived availability result (current/status/error/blocking source IDs) and a checked current-ShapeRecord lookup. Recursively inspect actual source/sketch/datum dependencies, with cycle/missing-owner handling. Raw ShapeStore::get/list remains available to persistence, inspection and rollback; modeling/query/export paths use the checked boundary. Availability is evaluated before mesh-cache lookup, not cached independently of document/revision. An unavailable feature cannot supply current metrics, picks or geometry for a new operation. No fake zero measurement is a healthy substitute.

Reuse native source selection binding/resolution by factoring the existing checked TNaming operations behind a generic owner-context API in OcafLive, keeping existing Datum wrappers/semantics intact. Projection contexts include target sketch, group and source identity and cannot accept another context's private label. Private entries are never accepted in definitionJson mutation arguments. Persist those entries in separate private bindingsJson; save/open/Undo must retain ownership and never bind a lost ordinal to another native edge.

## Files and ownership

The following native paths are the complete allowed implementation surface for this packet. Parent may narrow them after the accepted profile diff; no other module is implicitly owned.

- New src/features/sketch/sketch_projection.h/.cpp and src/model/geometry_availability.h/.cpp under native/kreoda-core.
- Existing sketch_store.h, sketch_commands.h/.cpp, sketch_json.h/.cpp and sketch_face.cpp under src/features/sketch.
- Bounded ownership amendment: sketch_face.h may declare the shared exact authored-entity edge extraction helper implemented in sketch_face.cpp. Parent inspected this need during the active worker's changes; no unrelated profile API changes are authorized. Future missing-path expansions still require reporting before edits.
- src/features/rebuild.cpp and src/features/datum/datum_json.cpp, datum_store.cpp.
- src/persistence/ocaf_live.h/.cpp; src/model/commit.cpp, body.cpp.
- src/protocol/dispatcher.cpp and session_geometry.cpp (existing guards/summary status only; no IDs36–38 dispatch yet).
- src/tessellation/mesh.cpp; src/exchange/sew.cpp.
- Existing source-consuming native implementations src/features/primitives/primitives.cpp, booleans/boolean.cpp, hole/hole.cpp, fillet/fillet.cpp, instance/instance.cpp and extrusion/extrude.cpp, revolve/revolve.cpp. Restrict edits here to common current-source guards and necessary group-profile integration.
- native/kreoda-core/CMakeLists.txt and tests/CMakeLists.txt for new source/test inclusion only.
- New native/kreoda-core/tests/test_sketch_projection.cpp and targeted existing test_datum.cpp/test_sketch.cpp/test_projection.cpp for regression coverage.

The worker is not alone in the codebase. Preserve concurrent edits; never revert unrelated/generated files. No commits/push by worker. If a real missing consumer outside this surface is found, report it to the parent for an explicit bounded scope correction before editing it.

## Review focus

- Undo/open must reconstruct identical source dependencies and binding contexts. A normal UpdateSketch cannot erase groups or replace native edges by samples.
- Shape sources may have indexed/seam fallback roles. Reordered topology with a lost TNaming match must become broken, never silently select the new ordinal occupant. Include real ambiguity and wrong-owner cases.
- Incoming staging must not resolve against the old document's coincidentally matching feature/group IDs.
- A loaded broken group can coexist with valid saved downstream B-Rep. Guard warm mesh cache, direct record tessellation, Body-tip geometry query, FaceInfo, export/whole-document analysis and direct native modeling consumers before stale geometry is used.
- Binding or downstream kernel failure after an OCAF command opens must restore selections and all native/store/graph/history state, including joined transactions. Repair cannot publish a healthy group with a failed dependent branch.

## Task1: native associative ownership, binding and history

- [ ] Write and run behavioral RED tests for native Set/Remove, ordinary sketch update preservation, actual source edit->projected target->Extrude/Revolve geometry with stable IDs. Missing compilation symbols alone are not RED.
- [ ] Implement strict version1 definition/group persistence, source binding and source-sketch entity resolution. Keep legacy sketches valid; reject malformed present metadata/unknown keys/versions/duplicate ownership and limits without output/state changes.
- [ ] Implement common SketchDependencies everywhere currently using supportRef-only sketch dependencies: create/update, dispatcher SyncGraphFromStore/delete checks and incoming datum/document graph validation. Reject self/downstream cycles atomically; deduplicate dependencies deterministically.
- [ ] Reevaluate in source-before-target order after current datum-frame resolution, then rebuild dependent solids from actual native profile geometry. Preserve group/sketch/solid IDs and unrelated branches. Group Set/Remove and ordinary UpdateSketch use the existing ModelSnapshot/OCAF rollback model.
- [ ] Persist group definitions/private bindings on the sketch OCAF label, release only the intended group's selection ownership on replacement/removal, and reconstruct on actual Undo/Redo/.icad open/recovery without an extra history/revision bump.
- [ ] Prove actual source parameter edits and source-sketch entity edits update analytic curved target profiles, including tilted/translated frames and group-only sketches. Verify native length/area/volume/placement and complete B-Rep source immutability, not merely returned object counts.

## Task2: broken-reference repair and all current-geometry consumers

- [ ] Implement incoming staging that distinguishes malformed metadata/cycles from structurally valid unresolved source lineage. The latter loads inspectable broken groups with no trusted cached result.
- [ ] Implement common derived availability and integrate every verified consumer listed above. Guard RequestMesh before cached bytes; direct TessellateRecord; session feature/Body-tip queries and persistent picks; FaceInfo; CollectExportRecords/whole-document analysis; all source-consuming native modeling and final CommitShape dependency publication.
- [ ] Existing inspection responses expose unavailability/status/diagnostics without presenting stale volume/bounds as current. Record the exact JSON changes needed by the following canonical contract task. A healthy group-free document retains existing payload/geometry behavior.
- [ ] Load an actual .icad with deliberately invalidated private projection binding and a valid cached downstream solid. Assert broken query state; warm cached mesh, direct tessellation, Body picks, metrics, export and direct modeling reject it. An unrelated branch remains usable.
- [ ] Replace definition to explicitly repair; verify same group/sketch/dependent IDs and measured native result. Undo restores broken state, Redo restores repaired state; failed repair/remove with downstream rebuild failure restores the exact pre-image. Refused source deletion and dependency release survive Undo and save/open.
- [ ] Test same source IDs in different incoming/current documents, wrong-group private context, malformed/unknown fields, array/byte/edge limits, ambiguous names and failure after partial binding; none may mutate old live state.

## Verification and handoff

- [ ] Use the already configured isolated real-OCCT output after the profile worker has finished; stub OFF and crash barriers OFF. No reconfiguration of the human production build.
- [ ] Run focused behavioral tests, then normal core/tests build and complete Release CTest with XML, nonzero expected discovery, no failures/skips. Run normal core self-test with app-local DLLs and PATH restricted to System32/Windows. Capture unchanged source hashes during the final gate.
- [ ] Return the actual full diff scope, behavioral RED/GREEN logs, native measurements, private-binding/Undo/.icad/broken-cache proof, all source hashes and any exact protocol response changes. No completion claim while a test process is still running.
- [ ] Parent independently verifies source scope and gates, freezes the immutable candidate and obtains fresh GPT-6-Sol/high review. Correct findings, reverify and use a new fresh reviewer after any code change.

## Required continuation

Public commands36–38, canonical command schemas/creation metadata and generation, session snapshots/deltas/query caches, C# client/context/MCP, compact Desktop and controller-free Quest source/repair controls, projection-only initialization, normal ARM64 and hidden actual UI/MCP flows remain required following this native packet. Current-head hosted CI and permitted physical/live Hermes acceptance remain separate proof gates. Other advanced CAD and all Phase16 requirements are unchanged; this plan does not reduce the goal.
