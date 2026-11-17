# Phase 15.1 reference geometry — native preflight (13 October)

This is inspected source evidence, not implementation or acceptance. The full roadmap remains binding; Quest section Task2 is currently owned by its separate Luna/Max task.

## Existing native support

- Roadmap15.1 requires datum planes/axes/points plus offset, mid, angle and three-point planes. All require stable UUIDs, dependency graph and persistent references.
- `SketchPlane` already carries origin, xAxis, yAxis and normal; `SketchFeature` carries supportRef (features/sketch/sketch_store.h).
- `sketch_face.cpp` builds native edges and circle axes using that frame. Extrusion uses its normal; revolve uses its origin and xAxis. Thus the native geometry builders already consume a frame rather than only a principal-plane name.
- `FeatureGraph` supplies dependency-first deterministic recomputation, dirty propagation, cycle detection and upstream-failure isolation (model/feature_graph.h).
- DeleteFeature already refuses deletion when another sketch's supportRef names the feature or one of its persistent references (protocol/dispatcher.cpp, around1710).

## Required gaps before datum-to-sketch-to-feature acceptance

- CreateSketchFeature currently permits only XY/XZ/YZ and overwrites the frame with PrincipalPlane (sketch_commands.cpp, around139–161).
- SerializeSketchFeature writes the full plane, but ParseSketchFeature ignores that serialized frame and reconstructs PrincipalPlane (sketch_json.cpp, around171–198). A custom frame would therefore be lost across actual open/Undo rehydration.
- OcafLive reconstructs sketches through ParseSketchFeature (persistence/ocaf_live.cpp, around603–623); persistence and recovery must validate and restore custom frames explicitly before claiming datum support.
- Stable support references must participate in graph reconstruction/recompute and create validation. A serialized supportRef or deletion guard alone does not prove dependencies are registered and resolved.
- ShapeRecord stores B-Rep parameters/dependencies; datums must remain reference features and must not become solid-body tips merely to fit the existing record path.

## Required proof for the next implementation

Actual native datum plane → supported sketch → extrude/revolve; changing the datum recomputes the dependent feature; stable UUID/reference lineage; invalid or broken references explicit; normal CAD Undo/Redo; save/open and recovery preserve the frame and dependencies. Cover offset/mid/angle/three-point variants, datum axes and points, then Desktop/Quest/agent exposure. Existing image-reference and section-view planes are presentation state and do not satisfy these native requirements.

No native source changes or server/Hermes calls were made for this inspection. No tests/builds were run concurrently with the Quest worker.

Additional inspected client/graph gaps: SyncGraphFromStore in dispatcher.cpp currently adds sketches without supportRef dependencies; RequestSketch in Desktop coreClient.ts returns only model plus planeKind, discarding serialized plane/supportRef; native and Desktop body semantics default unknown types to NewBody. All three must be addressed by the written datum plan, not assumed covered by existing frame fields. Canonical command IDs currently end at30 across TS/native/FBS, allowing reserved new31–35 without changing old IDs.
