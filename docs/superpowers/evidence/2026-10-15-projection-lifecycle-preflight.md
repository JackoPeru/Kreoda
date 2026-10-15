# Projection lifecycle integration preflight

Read-only parent inspection while separate Luna/Max task01a13ec1-ddbd-7783-a456-28a09cf52694 owns the pure evaluator. No evaluator code was duplicated or changed by the parent. This is a map of required later integration, not product acceptance.

## Existing seams verified

- `src/features/sketch/sketch_store.h`: SketchFeature owns ID, full frame, solved local model and datum supportRef. Named associative projection groups can be owned by this feature without a second feature-store node or a target-sketch dependency cycle.
- `src/features/sketch/sketch_commands.cpp`: UpdateSketchFeature copies the previous complete SketchFeature, replaces its ordinary local model, snapshots all stores, runs one OCAF command and downstream graph recompute, and restores the snapshot on failure. Projection groups must survive this ordinary model edit. New projection mutations must follow the same atomic owner path.
- `src/model/model_snapshot.h`: vector copies preserve complete SketchFeature pre-images. Adding groups to the feature carries them through rollback if native edge handles are treated immutably; a mutable shared TopoDS source would violate that guarantee.
- `src/features/sketch/sketch_json.cpp`: Serialize/ParseSketchFeature currently writes only ID, plane, supportRef and ordinary model. Add versioned optional groups here, preserving legacy records with no groups and rejecting malformed present records. Never silently discard unknown/malformed projection definitions into a healthy sketch.
- `src/persistence/ocaf_live.cpp`: UpsertSketch stores the serialized feature on its OCAF label. Existing datum TNaming binding/resolver already guards source owner/selection lineage and disables ordinal fallback for lost indexed picks. Projection source binding should reuse this native naming machinery without treating a group as a solid feature or accepting a datum-only discriminator as the public projection format.
- `src/protocol/dispatcher.cpp`: SyncGraphFromStore reconstructs sketch dependencies from supportRef only. DeleteFeature's sketch dependency refusal also checks supportRef only. Both must consume one common sketch-dependency calculation that includes projection source owners. Updating only normal create/recompute would lose dependencies after Undo/open and allow referenced source deletion.
- `src/features/datum/datum_json.cpp`: incoming document validation independently builds a graph using supportRef-only sketch dependencies. Include projection source relationships and cycle checks there too; avoid a second incompatible graph definition.
- `src/features/rebuild.cpp`: a supported sketch first resolves its current datum frame, solves its ordinary model and rewrites its OCAF JSON. Re-evaluate projection groups in that same current frame before downstream solid rebuilds. Cached output cannot be presented as current after a broken source.
- `src/features/sketch/sketch_face.cpp`: native face assembly currently converts ordinary lines/circles/arcs to world edges and chains closed loops. Feed healthy native projection edges to the same profile assembly, retaining exact curves and holes. Display samples are not a substitute for these edges. A broken group cannot silently disappear and leave an apparently valid partial profile.
- `src/protocol/dispatcher.cpp`: RequestSketch already delegates to SerializeSketchFeature. Canonical session snapshot gathering reads the full native sketch separately from counts. Typed schemas/readers/caches still need to carry added group definition/status/output data explicitly.
- `apps/desktop/src/components/SketchEditor.tsx`: an empty ordinary points array currently triggers automatic first-run rectangle creation. Projection-only sketches must be distinguished before that mutation, on Desktop and any equivalent client initialization.

## Required failure and recovery proof

1. Ordinary UpdateSketch preserves group definitions/IDs and recomputes dependent solids; group edits are one normal reversible command.
2. Source parameter changes update the same sketch/downstream IDs; unrelated branches and native source identity remain unchanged.
3. Undo/Redo, actual .icad save/open/recovery reconstruct all source and datum dependencies, with stable naming and no index rebinding.
4. Self/downstream cycles, wrong source kinds, missing/ambiguous picks and degenerate projection are rejected atomically on attempted mutation. Invalid persisted source lineage produces an explicit broken-reference state, with unavailable downstream geometry and a repair path; it does not expose cached geometry as current.
5. Deleting an actively referenced source follows the existing no-cascade refusal. Explicit group removal releases its dependency in the same command. Existing principal/datum sketches retain their behavior.
6. Native closed projected curved profile feeds measured face/extrude/revolve geometry; semantic status and definitions are shared across Desktop, Quest and MCP. External geometry remains linked to its source rather than copied into anonymous user geometry.

The exact public command IDs, versioned group schema, persistent output naming and client curve-display representation must be specified and reviewed before lifecycle implementation. Pure evaluator tests alone cannot establish any of the lifecycle requirements above. Full original Phases12-16 and user restrictions remain in force.

## 15 October source identity and unavailable-geometry follow-up

Parent wrote the concrete lifecycle contract in specs/2026-10-15-projection-groups-contract.md while the separate profile worker owned its six native paths. This settles group ownership, reserved public36–38 operations, zero feature-creation metadata, typed native-edge/whole-shape/authored-sketch references, private source-binding contexts and explicit repair. Evaluated output member indices remain transient display data; no false persistent identity is assigned to silhouette contours that can split or reorder.

Further actual consumers inspected for the next lifecycle implementation plan:

- `protocol/dispatcher.cpp` RequestMesh checks a revision-keyed byte cache before TessellateFeature. An availability guard added only to tessellation would still serve an already-cached stale solid. Check common derived availability before cache lookup and cover that exact warm-cache case.
- `tessellation/mesh.cpp` has both TessellateFeature and TessellateRecord; direct record calls must honor the same boundary, not only the feature-ID wrapper.
- `protocol/session_geometry.cpp` resolves both native feature IDs and Body tip IDs in `record()`, then resolves persistent face/edge IDs. Both the direct feature and Body-tip path need checked availability. Whole-document scope calls CollectExportRecords; export/analysis cannot quietly include stale cached geometry either.
- `protocol/dispatcher.cpp` RequestFaceInfo bypasses session_geometry and reads ShapeStore directly. It needs the same check before supplying a frame/pick from a blocked solid.
- `model/commit.cpp` CommitShape is a common final native publication point and has explicit dependency IDs. It can defend against publishing a result based on unavailable dependencies, but this alone is too late to guard source-consuming native operations or read-only queries. Those actual source getters need the shared boundary too.
- Source reads exist in native Boolean, Hole/HolePattern, Fillet/Chamfer, Instance, Datum and primitive parameter-edit/rebuild paths. Keep metadata/snapshot/persistence reads available for inspection and repair; use a checked current-geometry accessor for modeling consumers. Do not globally make ShapeStore::get hide broken records, since rollback/repair/export-validation need their metadata.
- `OcafLive` StageDatums and DatumResolverFor currently stage incoming native shapes and validate selection owner/context/topology before publishing stores. Group staging must integrate into the same incoming-document dependency order. Structurally valid broken projection lineage cannot be marked healthy simply because the saved shape passes BRepCheck.

These are verified implementation seams, not proof that the guards exist. The future native lifecycle packet must exercise stale-mesh, direct-record tessellation, Body query, FaceInfo, source modeling, export/analysis and healthy unrelated-branch behavior; a query-only status field is insufficient.
