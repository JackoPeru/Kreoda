# Phase15.2 projected geometry

## Goal and preserved scope

Implement project edge, project silhouette, intersect geometry and associative external geometry references from roadmap15.2. Projection must feed ordinary editable sketches and downstream native features, recompute when sources change, persist with normal Undo/Redo/save/open/recovery, and show explicit broken references. Desktop, Quest and CAD MCP must expose the same native definitions. Full other Phases12-16 work and physical/live Hermes acceptance remain required.

The user already authorized autonomous continuation and routine design decisions. Continue without asking them to configure tools or approve each implementation detail. Separate GPT-6-Luna/Max tasks implement; parent owns design, immutable review and verification. The explicit user quota fallback applies only when an implementation lane actually fails for quota.

## Architecture

Reuse OCCT curves/edges, the current SketchPlane frame, SketchFeature/OCAF persistence and FeatureGraph. Projection geometry is authoritative native B-Rep, with analytic or spline curves retained; client display sampling is presentation only. Do not approximate CAD curves into a polygon profile to make the current line/circle/arc model accept them.

Associative projection definitions belong to the target sketch as named projection groups. A group has a stable ID and native persistent source references. It is external geometry of that sketch; the existing native sketch feature remains its graph/Undo owner. This avoids a new feature-store node that would both depend on and feed its target sketch. Sketch graph dependencies include source feature IDs and existing datum support. No direct renderer or AI geometry path is introduced.

Native evaluation is separated from source identity resolution. A small pure evaluator accepts resolved native edges/shapes and a validated target frame, returning native edges in world CAD millimetres. The lifecycle layer resolves actual IDs before calling it, attaches results to the sketch, preserves definitions, and handles atomic failures/status. It must not invent stable identity from vector order. Exact output naming, canonical command IDs and full typed projection-group wire layout are specified in the lifecycle task after the evaluator's actual OCCT results have been inspected, before any public protocol edit.

## Geometric semantics

- Edge projection is orthographic along the target plane normal. Preserve trimmed intervals, closed curves, transformed source location and genuine curved geometry. A projection collapsing to a point is an explicit degenerate result, not an invented line.
- Silhouette is the orthographic apparent contour of a native shape along that normal, including inner contour holes. Hidden edges and visible internal face creases are not silhouette geometry. Use the exact OCCT HLR/B-Rep algorithms; no mesh silhouette. Results are mapped from projector coordinates through the target origin/basis exactly once.
- Intersection is the actual section of the native shape with the infinite target plane. No artificial bounded display quad can crop the result. Empty/disjoint or degenerate results are explicit and do not publish stale output.
- Output edges lie on the validated plane, are finite/nondegenerate and retain native curve type/trim and orientation. Native kernel tolerances govern evaluation; target coordinates are not clipped to UI input ranges. Use a declared CAD tolerance and verify achieved geometry against it.
- Evaluators are read-only and failure-atomic: they do not mutate source topology, global stores, graph, revision, selection or the caller's previous output on failure. Null shapes, malformed frames and nonfinite/unbounded unsupported curve intervals fail explicitly.

## Required delivery stages

1. Native evaluator with actual OCCT edge/silhouette/section tests. This stage alone does not complete15.2.
2. Sketch projection groups, persistent native references, graph/recompute/atomic broken-reference handling, normal OCAF and .icad lifecycle, exact downstream face/extrude/revolve use, public canonical commands and queries.
3. Canonical schemas/creation metadata/generated contracts, session/delta/context/MCP exposure and client caches. Creation metadata counts actual new native features; projection-group identity must not be confused with a new solid or feature.
4. Compact Desktop and controller-free Quest projection/source/repair controls, current semantic targeting and native frame display. Projection-only sketches must not receive the editor's automatic first-run rectangle. Preserve existing datum/section/voice/panel/two-hand behavior.
5. Parent native/lifecycle/client/hidden UI/normal ARM64 gates, fresh immutable reviews and corrected-head hosted CI. Separate physical/live Hermes proof when permitted.

## Acceptance examples

Project an actual closed native edge loop to a translated/tilted sketch plane, extrude it and measure native placement/volume. Change source parameters and observe the same sketch/downstream feature IDs recompute; Undo/Redo and save/open retain definitions and relationships. Use a sphere/cylinder/curved imported edge to demonstrate curved projection, silhouette and section without polygon substitution. An oblique box silhouette must exclude its internal visible creases and have the analytic projected area. Remove or invalidate a persistent source: report the broken reference explicitly, preserve unrelated branches and never silently bind another ordinal edge. Desktop/Quest/MCP expose the same group and source IDs.

## Constraints

No new CAD solver/dependency or optional hardware/server requirement for local work. No Hermes/server/SSH/Tailscale/AI probes or remote changes while the image-work restriction remains active; no device installation/capture, microphone/camera, PC audio or foreground GUI. Build/test hidden. Preserve the human dirty checkout and concurrent worker edits. No merge/release or full-goal completion from one stage.
