# Associative sketch projection groups contract

This contract specializes the required lifecycle stage of 2026-10-15-phase15-projected-geometry.md. It records parent architecture while the separate Luna task owns exact native profile assembly. No lifecycle implementation or acceptance is implied. The full original Phases12-16 goal remains active.

## Ownership and public operations

The existing target SketchFeature owns zero or more named projection groups. Group IDs are stable document-safe IDs, unique within that sketch. A group is external sketch geometry, not a separate feature/solid/body or solver-created point collection. Ordinary UpdateSketch preserves all groups. Principal and supported datum sketch frames both work.

Reserve these additive native command IDs, mirrored through the existing canonical registry and generation:

| Native ID | Canonical command | Parameters | Meaning |
|---|---|---|---|
|36|SetSketchProjection|featureId, groupId, definition|Create or replace exactly one owned group; replace also performs explicit source repair|
|37|RemoveSketchProjection|featureId, groupId|Remove one existing group and release its source dependencies|
|38|RequestSketchProjection|featureId, optional groupId|Read current definitions, source relationships, status and display geometry|

All three commands have canonical creation.fixedCount=0: no new native feature is created. Mutation commands require the ordinary current revision/session ownership, cancellation and transaction behavior. They are one normal reversible OCAF command; inside an existing session transaction they join that owner. New group IDs are supplied explicitly, never inferred from source-vector order. Query is read-only and never repairs/rebinds sources as a side effect.

## Definition format

```json
{
  "version": 1,
  "operation": "projectEdges",
  "sources": [
    {
      "type": "edge",
      "featureId": "source-owner",
      "persistentEdgeId": "source-owner:edge.lin.box.+X~box.+Z"
    }
  ]
}
```

- Operations are exactly projectEdges, silhouette and section. projectEdges accepts one or more explicit native edge references and/or authored source-sketch entity references. silhouette and section each require exactly one whole native shape reference, `{type:"shape",featureId}`. Their source must be a current native B-Rep; datums, null/broken features and unresolved instances fail explicitly.
- An authored external sketch source is `{type:"sketchEntities",featureId,entityIds:[...]}`. IDs identify existing ordinary native sketch lines/circles/arcs, later extended by the canonical advanced-sketch entity model. They are not array indices or anonymous coordinate copies. Their world geometry uses the source sketch's actual frame. Missing or duplicate entity IDs fail explicitly. Group-to-group references are not smuggled through ordinary entity IDs; if added later they require their own typed identity contract.
- Empty, duplicate, unknown or contradictory fields, unsupported version/operation/source combinations and malformed native IDs fail before state changes. Native and canonical schemas enforce the same limits. Reuse current request-size and bounded-array conventions; record the exact selected limits in the implementation plan and matching tests.
- Target sketch self-reference and references to its downstream features are cycles and fail atomically. Do not permit duplicate sketch/group ownership under another feature ID.

## Persistent source binding

Public mutation arguments carry semantic source IDs, never client-supplied OCAF label entries. Inside the caller-owned OCAF command, native edge picks are bound with TNaming under a projection-specific selection context containing target sketch, group and source identity. Reuse the existing checked naming machinery and owner/role/topology validation; a datum's selection entry must not be reusable as a projection binding.

Persist the validated definition and private binding metadata in the sketch's versioned optional projectionGroups field. Legacy sketches without this field remain valid. Present malformed/unknown group records must never be discarded into a healthy sketch. Private label entries are opaque native persistence data and are not editable public source fields.

On recompute/open/Undo/recovery, resolve the original owner and native binding before evaluation. Semantic fallback is allowed only when the existing naming policy proves a unique semantic entity of that owner; lost indexed picks must not be rebound to the edge now occupying the same ordinal. Wrong-owner, ambiguous, missing or wrong-topology resolution is an explicit broken source. Replacing the group's definition is the deliberate repair operation and establishes a new validated binding in one reversible mutation.

Whole-shape sources retain the original feature identity. Authored sketch entity sources retain feature and entity IDs. Neither is converted into a copied coordinate snapshot. Exact native output curves are recomputed from these definitions and current frames, not deserialized from client display samples.

## Group results and identity

A group query returns stable groupId, validated public definition, source feature dependencies, status (`ok` or `broken`), structured diagnostic and current evaluated frame/generation. When ok it can return bounded display samples and native curve-type/trim/closure descriptions. Native B-Rep edges stay authoritative in the native owner and feed the shared exact planar-profile assembly.

Output member indices are evaluation-local presentation data; never advertise them as persistent selectable edge IDs. A silhouette/section can split, merge or reorder contours when its source changes. The stable association is the group plus its persisted source references. Downstream profiles consume the whole healthy group. Display picking/voice identifies the current owning sketch/group and checked generation. Per-output persistent constraints require a separately proved naming rule before being exposed, rather than an invented ordinal alias.

Projection-only sketches contain no automatic rectangle. Ordinary authored geometry can coexist with groups and uses the same exact profile builder. A broken group prevents use of the entire affected profile; it cannot silently disappear while the remaining edges produce a different solid.

## Graph, transactions and broken references

One shared SketchDependencies calculation returns datum support plus every source owner in all groups, deduplicated deterministically. Use it for normal mutations, graph reconstruction after Undo/open, incoming document validation, delete guards and recompute. A source edit reevaluates the target in its newly resolved frame before dependent solids, preserving sketch/group/downstream feature IDs. A failed attempted mutation restores all stores, graph, native selection metadata, revision and Undo state.

Broken references already present in a loaded document need an inspectable repair state. They must not expose the saved downstream B-Rep as current. Implement one common derived geometry-availability check from group/source status and dependency closure, used before native geometry queries, mesh-cache lookup/tessellation, semantic picks and new native modeling that consumes existing geometry. Canonical feature state carries explicit geometryCurrent/status/error; blocked features have no current mesh or current measured volume/bounds. Do not report fabricated zero measurements as healthy geometry. Saved historical B-Rep may remain for recovery, but cannot cross the current-geometry boundary. Unrelated healthy branches remain usable.

Malformed metadata/cycles remain document validation errors; structurally valid but unresolved persistent source lineage produces broken status. Repair reevaluates the group and affected downstream closure atomically. A repair that cannot rebuild dependent geometry fails without publishing a half-repaired branch. Removing a broken group uses the same rule when dependents exist.

## Required proof before lifecycle acceptance

1. Native source closed curved edges -> translated/tilted target sketch -> actual Extrude/Revolve, measured curve/placement/volume; no polygon surrogate.
2. Source parameter edits update the same group/sketch/solid IDs; ordinary sketch model edits preserve groups and unrelated branches.
3. One Undo/Redo, real .icad save/open and recovery retain definitions, private source bindings, source graph dependencies and current geometry. Include deliberately reordered/ambiguous indexed topology, not only box semantic faces.
4. All new mutation errors are atomic: invalid definitions, ownership, cycles, wrong source kind, lost/ambiguous reference and collapsed/empty native result. Include native failure and multi-command transaction rollback.
5. Load a structurally valid document with broken projection lineage. Query exposes broken group and dependent unavailability; cached mesh, pick, metric and new dependent modeling cannot use the stale solid. Healthy branches still work. Explicit replacement repair restores the same group and downstream IDs.
6. Referenced-source deletion is refused until the owning group/dependents are explicitly removed through normal history. Undo/open rebuild the same guard.
7. Canonical registry metadata, generated contracts, session/delta/query caches, MCP and Desktop/controller-free Quest all expose matching IDs/status/definitions. Show native results and repair controls in compact UI; no first-run rectangle on a projection-only sketch. Normal ARM64, hidden UI/local fake-server gates, fresh immutable review and exact-head hosted CI follow.

## Implementation sequencing

Finish and parent-accept the active exact native profiles packet first. Then write the lifecycle implementation plan with exact owned files, public schema limits, the common source-binding/availability APIs and bounded independent native/client tasks. The private naming and geometry-availability boundaries above must be implemented across all actual consumers before claiming lifecycle acceptance. No server/Hermes/device action is needed for this local work; physical/live acceptance remains separately required when permitted.
