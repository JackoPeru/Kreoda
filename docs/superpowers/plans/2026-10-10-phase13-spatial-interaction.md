# Phase 13 Spatial Interaction Implementation Plan

> For agentic workers: use superpowers:executing-plans task by task. This continues the approved Phases12-16 goal. Original sole Luna/Max task failed terminally on quota; user authorizes root fallback. Do not restart that worker. Fresh actual Sol6/high review follows parent verification.

**Goal:** Complete the fourteen-step Desktop/Quest workflow in roadmap13.18, including spatial parameter edits, precise values, fillet creation, shared Undo and seamless return to Desktop.

**Architecture:** PC retains the authoritative document, geometry, dependency graph, feature locks and revisions. Quest predicts only local visual changes and sends canonical semantic parameter/command intents. Extend the existing JSON control plus native FlatBuffers transport for separate, stamped preview meshes; never feed previews into the committed scene reconciliation path.

**Tech Stack:** Existing OCCT/C++ core, TypeScript session relay and canonical schema generator, shared .NET Standard2.1 client/foundation, Unity6/OpenXR/MetaCore207. No additional engine, CAD kernel, command registry or network protocol.

**Spec:** INTENT_CAD_REVISED_ROADMAP_DESKTOP_QUEST_AGENT.md13.0-13.18 and docs/SESSION_PROTOCOL_DECISION.md.

**Execution status:** Task1 is the bounded first correction. Tasks2-7 are the complete scope map; inspect their exact existing builders/DTOs/transactions before starting each task. This document does not attest their implementation or Phase12/13 acceptance.

## Global Constraints

- Phase12 physical acceptance is still open. Installed corrected foundation APK and hidden isolated PC audit session remain available for the user; do not replace them with partial modeling software.
- Preserve dirty primary and accepted desktop portable/profile. Continue in the existing isolated worktree.
- Three mesh levels remain preview0, interactive1, inspection2. Native mesh headers must describe the actual tessellation level.
- World placement/magnification are display state. Project world displacement through the inverse display transform before converting metres to CAD millimetres once.
- Hand/head response never awaits a network or kernel operation. A locked edit intent remains fixed until release or explicit cancel.
- A preview cannot alter ShapeStore, sketches, expressions, OCAF, Undo, document revision or committed mesh identity. Invalid preview retains committed geometry.
- Semantic feature/face/edge IDs and actual manipulator metadata determine edit ownership and axes. Never infer parameter ownership from a mesh normal or array index.
- Optional voice uses the shared command engine; do not substitute fake recognition. Snap and exact numeric input must work independently.
- No raw headset camera/screen capture, merge or public release authorization.

## Review Focus

1. Late preview after commit/cancel/document change cannot replace committed geometry or a newer edit.
2. An upstream parameter preview must include dependent geometry at the requested visible tip without mutating the committed dependency graph.
3. Lost tracking/focus/network or a hand change cancels a draft; it never silently commits.
4. Release value must reach the serialized preview worker before commit; uncertain acknowledgement requires reconciliation, not a guessed second edit.
5. Spatial dimensions and controls must fit their physical text/hit bounds, stay reachable and respect the actual tracked eye pose. Editor success does not establish physical comfort.

### Task 1: Accurate native preview LOD identity

**Files:** native/kreoda-core/src/protocol/dispatcher.cpp; native/kreoda-core/tests/test_topology.cpp.

**Interfaces:** Existing SetDimension/isPreview returns the native MeshUpdate. BuildPreviewMesh tessellates at level0; its response must advertise level0.

- [x] Add `EXPECT_EQ(update->lod(), 0)` to `Topology.PreviewDoesNotCommit`, retaining its exact candidate volume and unchanged committed revision/volume assertions.
- [x] Rebuild `kreoda-core-tests`, run that test and observe actual level1 mismatch.
- [x] Set the preview MeshUpdate tag to0, matching `TessellateRecord(tmp, 0)`; keep normal parameter commits unchanged.
- [x] Rebuild/run the targeted test and native suite. Commit the verified correction with actual RED/GREEN evidence.

### Task 2: Pure preview through the selected body tip

**Files:** native/kreoda-core/src/features/primitives/primitives.{h,cpp}; native/kreoda-core/src/expressions/expressions.{h,cpp}; native/kreoda-core/src/features/booleans/boolean.{h,cpp}; native/kreoda-core/src/protocol/dispatcher.cpp; native/kreoda-core/tests/test_topology.cpp and test_sketch.cpp.

**Interfaces:** Add `BuildPreviewBodyMesh(featureId, paramName, valueMm, tipId, CoreMesh*, error)`; consume actual ShapeRecord recipes and existing Build*Shape helpers. Optional native `previewTipId` preserves existing single-feature preview callers.

- [x] RED: Box→Hole and Sketch→Extrude→Hole previews of an upstream dimension match a subsequent confirmed edit's tip bounds/volume while stores, expressions, revision, Undo and OCAF remain unchanged.
- [x] RED: invalid dependent operation, unrelated requested tip, cyclic/missing dependency and transformed Instance fail without changing committed state.
- [x] Build only the affected dependency closure in a temporary ShapeRecord map. Resolve dependencies from that map or immutable committed inputs. Use detached candidate geometry where a builder/tessellator could mutate shared topology. Never temporarily overwrite the global store or use commit+Undo as preview.
- [x] Resolve the requested tip's semantic mesh using its actual feature identity and level0. Validate requested tip membership/ownership before native invocation in Task3.
- [x] Extend the pure candidate input to a checked list of distinct parameter/value changes for compound planar/position/rotation handles. Apply them to temporary parameters before rebuilding; never synthesize a compound preview by overwriting live parameters.
- [x] GREEN: run actual native tests, compare preview vs actual committed geometry and persistence/revision invariants. Keep single-feature preview compatibility.

### Task 3: Separate bounded preview binary transport

**Files:** schemas/session-control-v1.json and generated outputs; packages/protocol/src/session-control.ts; apps/desktop/electron/session.ts and session-queries.ts; apps/desktop/tests/session-relay.test.ts; clients/session-dotnet/src/Kreoda.SessionClient/{SessionClient.cs,SessionMeshResult.cs}; actual .NET session tests and probe.

**Interfaces:** Negotiate `binary-preview-v1`. Add `requestPreviewMesh` with `previewId`, `generation`, `documentId`, `expectedRevision` plus envelope sessionId. Add canonical PreviewMeshHeader with nativeRequestId, session/document/base revision, previewId/generation, edited feature/parameter, bodyId, targetTipId, quality0 and bounded byteLength. `previewBegin` may receive bodyId/targetTipId; old JSON callers retain their summary shape.

- [ ] RED: actual relay/managed transport returns only summaries today; require exact raw native bytes for the requested preview generation and unchanged committed snapshot.
- [ ] Retain only the latest raw buffer and generation in each owned preview state. Limit4 live previews per logical client,64MiB per buffer and256MiB retained globally; reject excess before retaining. Clear on update replacement, cancel, commit, disconnect/revoke, core/document reset.
- [ ] `runPreview` returns an internal summary/raw pair. Never expose raw bytes/base64/typed arrays in JSON. Validate body/tip lineage and dependencies before passing previewTipId to Task2.
- [ ] Preserve scalar preview callers and add checked compound values for actual multi-parameter manipulators. Commit compound edits through the existing transaction machinery as one shared Undo step/delta; rollback every component on failure and preserve operation replay. Test two-axis and three-axis edits, last-component failure and lost acknowledgement.
- [ ] `requestPreviewMesh` serializes with that preview and the existing ordered read. Reject wrong owner, generation, document/session/revision, consumed preview or active conflicting transaction. Enqueue checked JSON header then unchanged binary frame before releasing the read; preserve64MiB peer queue/slow-consumer protections.
- [ ] Reuse the native binary verifier, range/finite/index checks and synchronous receive-loop correlation. Add `RequestPreviewMeshAsync(previewId,generation,documentId,expectedRevision,ct)` returning a distinct SessionPreviewMeshResult; do not route it into committed model state.
- [ ] Test interleaved ordinary/preview meshes, duplicate reads of the same cached native request, fragmented frames, cancellation, errors without binary, stale generations, replayed preview control replies, disconnect/reconnect and memory limits.
- [ ] GREEN: schema drift/lint/JS, both actual managed targets, actual OCCT Desktop with compiled C# preview probe; raw hash equality and no document mutation. Commit and fresh review.

### Task 4: Semantic edit intent and preview worker

**Files:** clients/session-dotnet/src/Kreoda.QuestFoundation/SpatialEditIntent.cs and SpatialEditWorker.cs; its existing test project; canonical manipulator DTOs if needed.

**Interfaces:** An immutable intent contains session/document/base revision, owner feature, canonical parameter/unit, validated origin/axis/type and target body/tip. One serialized worker owns Begin/Update/final value/Commit/Cancel and the latest preview generation.

- [ ] RED: inverse display transforms at1:10,1:1,10:1 produce the same CAD scalar for equal CAD displacement; angular inputs use degrees and projected signed axes.
- [ ] Validate finite geometry, nonzero axes, supported linear/radial/angular/planar/position manipulator metadata. Lock intent on initial pinch/grab; changing hover cannot change the locked owner/axis.
- [ ] Position/planar and multi-axis rotation intents retain the actual parameter list and semantic basis. Add a native declared plane/basis for a constrained Instance planar handle; do not invent unsupported ownership or axes in Unity. Tests cover signed planar components and the existing extrinsic-ZYX Instance rotation convention.
- [ ] Coalesce newest draft value, one outstanding update, cadence100ms. Local prediction runs every frame. Release flushes final value before one canonical commit. Snap suggestions use the parameter's unit; exact numeric input shares the same validation/worker.
- [ ] RED/GREEN: release vs cancel, tracking/focus/hand/session/revision changes, delayed preview and lost commit acknowledgement. Cancel restores committed display; uncertain commit obtains current snapshot/operation status before any retry.
- [ ] Test locks against concurrent Desktop edit of the same feature and preserve unrelated renderer response. Commit verified state/worker.

### Task 5: Quest model/edit interaction and readable dimensions

**Files:** clients/quest-unity/Assets/Kreoda/Runtime/{QuestControls.cs,QuestConnection.cs,QuestSpatialEdit.cs,QuestDimensions.cs,QuestPreviewView.cs}; Editor build validation and Unity tests.

**Interfaces:** Consume Task4 intents/worker and actual getManipulators/getParameters. QuestPreviewView owns separate translucent meshes without selection colliders or publishable targets. Committed QuestMeshView/scene freshness remains unchanged.

- [ ] RED: actual Unity ghost updates preserve committed mesh/semantic identity; late ghost cannot survive commit/cancel/new lineage; all owned meshes are destroyed and shared materials survive.
- [ ] Add explicit Model/Edit modes, controller fallback and primary tracked hand pinch. Axis constraints come from semantic metadata; dimensions face the user with selected dimension priority, visible units, measured text bounds and collision/overlap handling.
- [ ] Two-hand grab in Model mode moves/rotates/scales only the independent display root. Lost tracking cancels manipulation without a CAD command. Test CAD revision and vertices unchanged, preserving world surface contact/magnification semantics.
- [ ] Add linear/radial/angular/planar/position handles and local frame-rate predicted ghosts. Request bounded authoritative Task3 previews in the worker; never await in Update/LateUpdate.
- [ ] Add snap/exact numeric controls, minimal palm menu and on-demand advanced panel. Reuse the corrected physical font sizing, eye pose placement, held panel drag and reachable safe reset.
- [ ] GREEN: real Unity tests for transforms/intent/ghost disposal/readability bounds/lifecycle; normal populated ARM64 build with exact input/APK/dependency evidence. No hardware usability claim from Editor.

### Task 6: Context actions and shared document history

**Files:** packages/command-schema/src/index.ts; canonical session DTOs/relay context query; shared managed client; QuestSpatialEdit.cs/QuestControls.cs; corresponding registry/session/Unity tests.

**Interfaces:** Command availability and reasons come from the existing canonical registry using validated semantic selection context. Canonical CommandAsync creates fillet/chamfer/other supported actions; shared Undo/Redo acts on the same PC document.

- [ ] RED: a selected valid edge exposes CreateFillet, invalid/ambiguous selection gives an actual reason, and Quest does not maintain a duplicate command registry.
- [ ] Execute confirmed canonical commands with current document/base revision and actual reference validation. CreateFillet native type21 does not have a pure creation-preview path: never pretend `isPreview:true` makes creation transient.
- [ ] Add shared Undo/Redo and current state reconciliation. Optional speech input, if implemented on a real available platform, feeds the same command parser; exact numeric/snap remains complete without it.
- [ ] Expose selected sketch dimensions through the actual sketch/constraint metadata and canonical sketch solve/preview/update path. Preserve plane, entity and constraint IDs; do not pretend a ShapeStore scalar SetDimension previews sketch constraints. Verify an exact sketch dimension edit and shared Undo without recreating the sketch.
- [ ] GREEN: actual Desktop+C# command/Undo proof and Unity interaction tests; strict references, locks, stale/error paths. Commit and fresh review.

### Task 7: Full physical acceptance and final gates

- [ ] Complete outstanding Phase12 physical acceptance; record source/APK and user observations separately from CI/Editor evidence.
- [ ] Perform all fourteen roadmap13.18 actions using actual saved Sketch→Extrude→Hole, spatial pull/exact value, Desktop update, edge selection/fillet, Quest Undo, remove headset and continue Desktop expressions with no synchronization/file transfer.
- [ ] Exercise high-triangle/latency cases, headset removal mid-edit, lost tracking/focus/network, concurrent same-feature Desktop edit, stale previews and reconnect. Record actual metrics/limitations; screenshots require separate authorization.
- [ ] Run native, JS/schema/lint, both managed targets, Unity, normal APK, Desktop ordinary/crash cohorts and exact hosted head gate. Fresh actual Sol6/high review of inspected accumulated diff with before/after input hashes.
- [ ] Phase13 complete only when every requirement is proven; then continue full Phases14-16, retaining all pending gates honestly.
