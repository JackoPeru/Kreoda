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
