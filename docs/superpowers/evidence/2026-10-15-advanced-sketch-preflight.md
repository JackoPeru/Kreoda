# Phase15.3 advanced sketch preflight

Read-only inspection at parent documentation HEAD eace23ac5ae4321cd22c00159fef7f845f82b08a while the separate Luna native projection lifecycle task is active. This identifies required follow-on work; it claims no implementation, solver acceptance or full-goal completion.

## Actual current boundaries

- Roadmap15.3 explicitly requires ellipse, elliptical arc, B-spline, control-point spline, construction geometry, trim/extend, sketch mirror and sketch patterns, with solver/regression coverage. None can be substituted by successful projected native curves alone.
- `native/kreoda-core/src/constraints/solver.h` owns SketchModel. Current authored collections are points, lines, circles, arcs and constraints; SolveResult returns solved points and circle/arc radii. It has no authored ellipse/spline/construction representation or write-back contract for their parameters.
- `src/constraints/planegcs/Geo.h` already contains native GCS Ellipse, ArcOfEllipse and BSpline representations; `planegcs/GCS.h` includes ellipse/spline point and alignment constraints. These are existing vendored facilities, not an exposed Kreoda feature. Reuse the existing solver instead of adding another dependency. Do not edit vendored code without a demonstrated missing capability.
- `src/constraints/planegcs_solver.cpp` currently constructs GCS points/lines/circles/arcs only. Arc angles are explicitly constant in the current adapter. EqualRadius, Concentric, Radius and Diameter branches identify arcs but explicitly reject them with the existing Phase4.1 messages. Advanced solver acceptance must cover the intended arc behavior as well as new curves; adding schema fields alone is insufficient.
- `src/features/sketch/sketch_commands.cpp` validates existing entity references, finite values and the total2000-entity cap. New authored curves/control points/operation expansion must participate in bounded validation before a mutation opens. Existing per-kind ID rules must not introduce ambiguous advanced source references.
- `src/features/sketch/sketch_json.cpp` parses/serializes existing authored collections; `sketch_store.cpp` writes solved points/radii back. New authoritative parameters must survive both ordinary updates and OCAF/.icad reconstruction without being silently omitted.
- `src/features/sketch/sketch_face.cpp` has the exact native profile seam from the preceding packet. Advanced authored curves must produce native trimmed curve edges through this seam, preserving planes and actual downstream geometry. Display tessellation cannot become CAD input.
- `packages/protocol/src/index.ts` defines only the current authored collections. Strict advanced validation must be carried through canonical schemas, generated transport, managed parsing and editable native model round-trip, not restricted to a new renderer.
- `apps/desktop/src/components/SketchEditor.tsx` currently draws/edits the simple model and auto-creates a rectangle when a loaded model has zero points. The projection client packet must correct projection-only initialization; advanced initialization must likewise distinguish genuinely new empty content from existing curves without ordinary point rows.
- Quest's inspected `clients/quest-unity/Assets/Kreoda/Runtime/QuestSketchDimensions.cs` edits current dimensional intents. This does not establish advanced curve creation/editing, trimming or patterns with hands alone. Those interactions remain required follow-on scope.

## Architecture work before the next implementation task

Settle one backward-compatible authored representation for ellipse/elliptical-arc frames and rational/periodic/trimmed B-spline data, shared stable control-point identity, and the solver result/write-back fields. The control-point authoring tool must create that same native editable spline representation. Preserve genuine knot/degree/multiplicity/weight validation and report unsupported configurations explicitly; never replace an unsupported spline with polyline geometry.

Settle construction-geometry behavior across all authored curve kinds: visible and constrainable, excluded from material profiles, preserved through transforms/Undo/open. Define trim/extend and mirror/pattern ownership, stable result IDs, source relationships, constraint remapping and atomic failure before task dispatch. Silent removal of constraints or projection source identity is unacceptable. The current associative projection module must be updated deliberately to recognize new authored kinds and construction eligibility after its own packet lands.

These decisions require the accepted projection lifecycle API and a bounded implementation plan. Do not dispatch overlapping sketch/solver work while the current Luna packet owns sketch files.

## Required verification scope

Behavioral RED/GREEN for actual solver-driven ellipse/elliptical-arc/control-point changes; malformed knots, multiplicities, weights and degenerate geometry fail atomically. Verify exact native closed ellipse and curved spline profile measurements, downstream Extrude/Revolve recompute, datum-frame transforms, stable authored/projection references, Undo/Redo and actual .icad save/open. Construction remains visible/constrainable but contributes no material region. Trim/extend and mirror/pattern edits retain explicit editable native results and intended constraints; rejected edits preserve the complete pre-image.

Following native acceptance, canonical/MCP/managed/Desktop/controller-free Quest tools must expose the same definitions with current generation/revision checks. Normal native, generated-contract, managed, hidden UI and source-stable normal ARM64 gates remain mandatory. Physical/live Hermes proof is separate and currently restricted by the user's image work.
