# Native reference geometry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for each owned task. Steps use checkbox syntax. Separate GPT-6-Luna/Max tasks implement; parent owns acceptance, evidence, commits and fresh Sol6/high review.

**Goal:** Native datum planes/axes/points and all roadmap15.1 plane variants support editable sketches and native features across Desktop, Quest and Hermes context.

**Architecture:** Validated full sketch frames first; dedicated NonBody DatumStore persisted in OCAF and connected to the existing FeatureGraph; canonical control/schema/clients then expose those records. Reuse native OCCT and current rendering/input adapters.

**Tech Stack:** Existing C++/OCCT/OCAF, TypeScript/Zod, .NET8/netstandard2.1 and Unity6. No new dependency.

**Spec:** docs/superpowers/specs/2026-10-13-phase15-reference-geometry.md

## Global Constraints

- Full original Phases12–16 scope remains open. Current Quest section Task2 retains its ownership until delivery. This plan is next work, not a second simultaneous implementation of its files.
- Stable IDs:1–128 ASCII letters/digits/_/-. User numeric coordinates/offsets ±1000000mm, angleDeg finite[-360,360] explicit degrees. Resolved CAD frame finite/right-handed/orthonormal within1e-9; do not clamp valid resolved native geometry.
- Preserve old command IDs0–30 and legacy principal sketches. New IDs31–35 exactly as spec; canonical creation fixedCount1/0. No renderer geometry authority or datum solid tips.
- Normal OCAF revision/Undo/Redo/save/open/transaction/rollback and graph dependency semantics apply. Rejected create/update must preserve state.
- No remote/Hermes/SSH calls, mic/camera capture, PC audio or visible GUI while user image-work constraint remains active. Local synthetic/native tests and hidden builds only.
- Root owns docs/review/commit/push/PR/CI. Workers preserve concurrent edits and return actual commands/results/artifacts plus deviations; no release/merge.

## Review Focus

- Serialized custom frame present but malformed: fail explicitly; missing legacy frame only may use PrincipalPlane.
- Opposed normals, parallel/coincident/collinear construction sources and near-degenerate inputs: deterministic frame or explicit error, never arbitrary fallback.
- Source reference invalidation, deletion, cycle or wrong datum kind: explicit failure/broken status and atomic persistence; no stale geometry claimed current.
- Datum and supported sketch graph reconstruction after Undo/open/recovery: dependency ordering and stable IDs preserved; datums never become body tips.
- Reflected/scaled Quest root and client frame loss: rendered/selected native datum and supported sketch match actual CAD frame without affecting section/pinch/voice flows.

### Task 1: Full native sketch-frame persistence

**Files:** modify native/kreoda-core/src/features/sketch/sketch_store.h/.cpp, sketch_json.cpp, sketch_commands.h/.cpp as required for validated frame input; native/kreoda-core/tests/test_sketch.cpp, test_persistence.cpp, test_undo.cpp. Add focused helper/test file only if current files need separation; preserve current build registrations. Native sources only; no Quest worker files.

**Interfaces:** `bool ValidateSketchPlane(const SketchPlane&, std::string* error)` declared in sketch_store.h. Preserve existing CreateSketchFeature signature; add `bool CreateSketchFeature(const std::string& sketchId, const std::string& planeKind, const SketchModel& model, const SketchPlane& plane, std::string* error)` for validated frame input. It does not resolve a nonexistent datum during Task1. SerializeSketchFeature/ParseSketchFeature round-trip exact frame and supportRef. Datum resolution itself belongs to Task2, not a placeholder in Task1.

- [ ] RED tests: translated and rotated right-handed frame round-trip; missing legacy frame XY/XZ/YZ fallback; present nonfinite, malformed lengths, scaled/skew/left-handed basis rejected without replacing output/state.
- [ ] Implement validation and strict plane parsing using existing JSON helpers. Provided valid frame overrides principal reconstruction; absent legacy plane only uses PrincipalPlane. Frame-capable creation shares solve/commit lifecycle with existing creation, no duplicated solver.
- [ ] Actual OCCT test: frame origin[10,20,30], x[0,1,0], y[0,0,1], normal[1,0,0]; constrained10×5 local rectangle, extrusion distance7 produces bbox[10,20,30,17,30,35], volume350 and solidCount1. Confirm source sketch and feature IDs.
- [ ] Actual OCAF save/open and ordinary Undo/Redo preserve those vectors, supportRef and measured feature; legacy principal native cases unchanged. Invalid frame creation yields unchanged revision/registry/Undo depths.
- [ ] Run actual linked native targeted/full gates, parent independently repeats meaningful native proof. Fresh source/artifact-frozen Sol6/high review before accepting frame foundation. This task alone does not complete15.1.

### Task 2: Native datums, persistent sources and graph

**Files:** new native/kreoda-core/src/features/datum/datum_store.h/.cpp and datum_commands.h/.cpp; modify persistence/ocaf_live.h/.cpp, model/body.cpp, document/document_store.cpp, protocol/dispatcher.h/.cpp, native CMakeLists.txt and native tests. Shared schemas/enums only the minimum IDs31–35 in schemas/cad_protocol.fbs and packages/protocol/src/index.ts; root can sequence codegen so contract consumers do not receive a silently partial interface. Task3 owns completed client/schema exposure.

**Interfaces:** `enum class DatumKind { Plane, Axis, Point }`; DatumRecord contains featureId/kind/definitionJson/dependsOn/resolved geometry/status/error as spec. DatumStore clear/get/put/remove/listInOrder mirrors SketchStore. `bool ResolveDatumDefinition(DatumKind, const std::string& definitionJson, DatumRecord* out, std::string* error)` resolves validated sources without committing. `bool CreateDatumFeature(const std::string& featureId, DatumKind, const std::string& definitionJson, std::string* error)` and `bool UpdateDatumFeature(const std::string& featureId, const std::string& definitionJson, std::string* error)` own normal atomic commands. RequestDatum returns the authoritative record; no native mesh request for it.

- [ ] RED constructor tests for each spec definition and wrong-kind/missing/ambiguous source, numeric limits, nonfinite input, collinear/coincident/parallel errors. Assert degeneracy boundaries1e-7mm and parallel normals1e-9 from spec. Known values: XY+offset10 has origin[0,0,10]; XY offsets10/30 mid20; XY rotate+90deg around directed+X has normal[0,-1,0]; points[0,0,0],[1,0,0],[0,1,0] yield XY. Verify opposed midplane normals and actual analytic line/planar face sources.
- [ ] Implement all PlaneRef/PointRef/AxisRef resolution and construction rules from spec. Persist validated definition JSON plus source IDs; no conversion to anonymous coordinates. Existing native face/edge naming resolves sources; curved edges/nonplanar faces return explicit errors.
- [ ] Add OCAF Datums root and lifecycle serialization/rehydration, registry and NonBody classification. Clear on new, reconstruct on Undo/Redo/open/recovery, and restore graph dependencies before recompute. Datums absent in legacy files remain valid.
- [ ] Extend CreateSketch supportRef resolution and graph registration. SyncGraphFromStore must restore sketch support dependencies, not only addFeature(sk.id). Supported sketch frame re-resolves before downstream native features. Preserve old principal creation.
- [ ] Integrate numeric SetParam edits for datum fields and UpdateDatum definitions, cycle check and non-cascade DeleteFeature guards. Existing transaction rollback and upstream-failure behavior remain authoritative; expose broken references explicitly without marking stale geometry current.
- [ ] Native end-to-end chain: DatumPoint→three-point DatumPlane→sketch→extrude; edit source point, verify normal/placement/native measured geometry and stable IDs; unrelated body unchanged. Also offset/mid/angle/axis sources exercised through actual command dispatch and dependent rebuild.
- [ ] Native snapshot/mesh tests: all datum variants NonBody, no RequestMesh, existing solidCount/volume unchanged by datum creation/display/query. Invalid/cyclic updates atomic. Save/open/recovery and one normal Undo/Redo preserve full chain; deleting referenced datum rejected.
- [ ] Run linked native full gates and parent independent E2E/control proof; source-frozen fresh Sol6/high review. Record status as native datum foundation until Task3 clients pass.

### Task 3: Canonical commands, Desktop/Quest/MCP exposure

**Files:** modify packages/command-schema/src/index.ts and native-command.ts/tests; packages/protocol/src/index.ts and session-model.ts, schemas/session-control-v1.json, generated bindings via existing codegen; apps/desktop/electron/session.ts; clients/session-dotnet/src/Kreoda.SessionClient/SessionModel.cs and SessionClient query adapter/tests; apps/desktop/src/ipc/coreClient.ts, model/sync.ts, stores/index.ts, commands/execute.ts, components/ObjectTree.tsx, components/SketchEditor.tsx, components/workspace/TopToolDock.tsx and i18n/en.ts/it.ts; new components/workspace/ReferenceGeometryPanel.tsx and viewport/DatumViewport.ts plus CadViewport/viewportHandle integration; clients/quest-unity/Assets/Kreoda/Runtime/QuestConnection.cs, QuestControls.cs and new QuestDatumView.cs/.meta, Editor/QuestBuild.cs, focused Editor tests; clients/session-dotnet/src/Kreoda.QuestFoundation/SceneModel.cs and new DatumGeometry.cs/tests; clients/session-dotnet/tools/Kreoda.HermesBridge/CadBridge.cs/CadTools.cs/ProjectResources.cs and focused MCP tests if describe/query currently drop datum data. Keep current section/voice behavior. Exact owned integration paths and test commands confirmed by parent before dispatch; no alternate CAD or AI path.

**Interfaces:** canonical CreateDatumPlane/Axis/Point(31/32/33){definition}, UpdateDatum(34){featureId,definition}, RequestDatum(35){featureId}; creates allocated stable UUID and fixedCount1, update/query0. CreateSketch{planeKind principal defaultXY, supportRef? actual DatumPlaneUUID, model?}. Snapshots/deltas add typed datums, full SketchPlane frame and supportRef, generated contracts regenerated rather than edited manually. Persistent targets use real datum UUID/kind. Add read-only session query method getDatum{featureId} that delegates to RequestDatum; existing kreoda_query can inspect it outside a mutation request. Preserve SessionModelState positional constructor compatibility when adding Datums; missing legacy collection defaults empty.

- [ ] RED schema/agent-budget tests for creation counts and invalid sources/variants/coordinate/angle values. Reuse canonical schema export and native translation; no command-name assumptions in agent catalog or manually duplicated contracts. Old numeric/control command tests unchanged.
- [ ] Session model/delta/snapshot reader tests preserve definition/resolved frame/status and remove stale/undone datums. Old model payload without datums remains compatible. RequestSketch currently discards plane/supportRef: expose and retain both across native/Desktop/managed paths.
- [ ] Desktop compact advanced controls expose every construction variant and supported sketch creation. Tree/parameter/source view has stable IDs and explicit errors; edit/Undo uses native commands. Reference renderer/picking uses native records separately from solid caps and images.
- [ ] Hidden actual Desktop native E2E exercises datum-plane→sketch→feature, parameter edit and save/open/Undo with measured expected frame/bbox/volume. UI points/axis and broken-source behavior reachable; accepted viewport navigation and room preserved.
- [ ] Quest uses full native frame and existing reflected CAD conversion under moved/rotated/scaled DisplayRoot. Separate reference views and actual datum semantic targets; pinch/shared-button route controls creation/selection, accepted panel/two-hand/voice behavior intact. Editor tests cover frame equivalence, removal/remesh, status and controller-free routing; normal hidden ARM64 MR build with no device capture.
- [ ] Existing MCP context/schema returns datums and permits canonical creation/edit/query outside Quest. Local MCP→OCCT proof creates an ordinary editable datum/sketch/solid chain and one shared CAD Undo. No live Hermes/server interaction while image work remains active; report boundary.
- [ ] Parent checks managed actual targets/TRX discovery, JS/schema/generated drift, native/Desktop/Unity gates, immutable source/artifact fresh Sol6/high review and exact hosted head. Mark15.1 software complete only when all named variants and all client paths have evidence; physical/live/fullgoal remain open.

## Parent handoff and acceptance

Tasks execute sequentially after the current Quest section task. Each separate Luna/Max prompt uses the five-part ownership contract, not a second worker on the same files. Terminal quota triggers the user's authorized root fallback without retry/replacement. Parent verifies actual diff/scope/evidence, commits/pushes accepted software, keeps draft PR and exact CI results accurate. No narrowed whole-goal completion claim.

## Spec/plan self-review

Each roadmap15.1 item maps to Task2 constructors and Task3 workflows; frame persistence/recovery maps to Task1, then Task2 support graph. All five Review Focus conditions have explicit tests. Construction modes, command IDs and units match the spec; old IDs preserved. Distinct future tasks preserve current Quest ownership. Local native/managed/editor evidence does not establish live Hermes or physical acceptance. Task1 frame foundation now implemented and parent-verified with actual OCAF/OCCT plus193/193 tests. Two fresh reviews required corrections, both implemented and verified; final independent review unavailable after quota. Task2 datum features and Task3 client exposure have not started.
