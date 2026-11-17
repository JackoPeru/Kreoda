# Associative surface sweep

## Intent and authority

Next increment of the user's approved full CAD roadmap, section 15.4: create a
surface body by sweeping sketch boundary wires along an exact sketch path. The
user authorized autonomous continuation and requires separate GPT-6-Luna/Max
implementation. Parent owns design, review, verification and delivery. No renewed
approval request or root product implementation, including on quota failure.

The installed sew/offset packet is the preserved baseline. Source checkout is
`C:/Users/matte/Desktop/Saas/Kreoda-phase10-ci`; the human checkout is excluded.
External evidence root:
`C:/Users/matte/Documents/Codex-tools/Native/phase15-surface-sweep-20261020`.

## Command and persisted feature

Append `CreateSurfaceSweep = 53`; do not change IDs 1–52. Named command parameters:

- `profileSketchId`: stable sketch ID.
- `pathSketchId`: distinct stable sketch ID.
- `toleranceMm`: finite JSON number in [1e-7, 1], default 1e-6.

Strict native and TypeScript schemas reject unknown fields, invalid IDs, wrong
types and identical IDs before mutation. Exactly one independent new feature/body
is created, canonical type `SurfaceSweep`, numeric parameters `[toleranceMm]`,
dependencies `[profileSketchId, pathSketchId]`. No persistent body-kind field or
new mesh/session DTO. Source sketches, geometry and visibility remain unchanged.
Creation responses omit surface volume; mesh compatibility volume remains zero.

## Exact geometry and supported inputs

Use existing `surface_detail::LoadSketch` and `CollectSketchWires`: exact authored
curves and current projection edges in their world sketch frames, construction
geometry excluded. Broken/stale projections fail. Profile has 1–128 disjoint,
nonbranching open or closed wires; path has exactly one nonbranching connected
wire, open or closed. Retain the existing 4096-edge limit for each sketch, and
preflight profile-edge-count × path-edge-count <= 65536 before pipe construction.
Preflight raw edge counts before expensive geometry; no ignored components.

The canonical path start is the first oriented vertex of the deterministic wire
already assembled by `CollectSketchWires`. The profile sketch plane must contain
this point within tolerance and be perpendicular to the nonzero initial path
tangent (absolute normalized dot >= 1 - 1e-8). Reject misaligned inputs with an
actionable error. Do not silently move a profile to a different location or
choose an interior path point. This defines deterministic placement and direction.

For each profile wire, build an OCCT `BRepOffsetAPI_MakePipeShell` from copied
profile/path topology. Set corrected Frenet mode (`SetMode(false)`), explicit
3D/boundary tolerance from `toleranceMm`, angular tolerance 1e-6 radians, and
`BRepBuilderAPI_RightCorner` transition. Bind the section explicitly to the path's
first vertex using `Add(profile, firstVertex, false, false)`. This preserves the
authored initial section. Smooth curved paths and valid straight-segment corners
are supported. OCCT corner cases that cannot form a valid surface fail atomically.
No loft/extrusion approximation fallback, profile translation, automatic rotation,
scaling law, auxiliary spine or automatic solidification. Never call `MakeSolid`.

Combine all successful patches into a surface compound. Validate in the shared
builder (creation AND candidate/numeric/rebuild paths): non-null face/shell-only
geometry, no solids/loose edges/vertices, finite positive area and finite bounds,
valid B-Rep and explicit `BRepAlgoAPI_Check` self-interference validation. Reuse
sew/offset validation helpers where compatible. Check each patch before combining
as well as the combined result, so one failed component cannot be dropped.
Unusable zero-tangent, degenerate, branched, disconnected, self-crossing,
self-intersecting and collapsed results are rejected. Closed path/profile output
remains a shell surface even if it geometrically encloses a volume.

## Lifecycle and clients

Use ordinary CommitSurfaceFeature/CommitShape and dependency graph lifecycle.
Recompute uses both sketch dependencies. Add tolerance property validation,
candidate evaluation and rebuild without bypassing common commit gates. Invalid
creation/edit leaves revision, history, IDs and prior geometry unchanged. Verify
upstream edits to both sketches, tolerance edit, undo/redo, direct surface
instances, OCAF/ICAD save/open and global physical queries excluding this surface.

Add `SurfaceSweep` to exact native/shared TS/Quest surface classifiers. Keep all
existing solid types solid. Desktop exposes EN/IT command/type labels and the
existing localized tolerance property. Existing rendering/picking/analysis should
follow classifiers; no new viewport or runtime UI architecture.

For easy selection, extend the internal command selection-binding vocabulary with
`firstSketch` and `secondSketch`. Sweep's availability requires exactly two sketch
references in selection order. Bind profile to first and path to second. Resolve
both only after the existing native reference, revision, document and lineage
fences; no sorting or ambiguity fallback. Named invocations remain available with
explicit IDs through the session command path. No change to existing bindings.
The current Desktop renderer executor has no generic registered-command form;
this increment covers the real session catalog/context, creation through that
session path and ordinary Properties/rendering. A manual surface-creation UI is
an explicit remaining full-goal task; do not claim this binding creates a toolbar
workflow, silently broaden into a new UI, or add an unvalidated executor fallback.

Quest uses existing arbitrary command/catalog and surface transport. Add only
the exact kind classifier and focused tests. Extend offline QuestSurfaceRender's
explicit allowed provenance types for real sweep fixtures; if required, use its
existing multi-face camera-selection path for sweep without weakening old
extrusion/revolution or solid-cap proofs. No shader, controls, Home or auth edits.

## Acceptance fixtures

1. Profile line length 10 on XY, path line length 20 along +Z: open rectangle,
   area 200 mm², bounds [0,0,0,10,0,20], no solids, zero mesh volume.
2. Profile circle radius 2 on XY, same path: uncapped cylinder, area 80π mm²,
   bounds [-2,-2,0,2,2,20], no solids. Both section end boundaries remain open.
3. Curved path: XY quarter-circle, center (0,20), radius 20, start (0,0),
   end (20,20), initial tangent +X; profile circle radius 2 in YZ at origin.
   Exact quarter torus area 40π² mm², bounds [0,-2,-2,22,20,2], no solids.
   Deterministic wire orientation must make this the canonical start.
4. Closed circular path radius 20 in XY with perpendicular radius-2 profile at
   its actual canonical start: torus shell, area 160π² mm², no solid or fake volume.
5. Multiple disconnected valid profile wires: all patches included, analytic
   total area; a valid right-angle polyline path uses actual right-corner joins.
6. Reordered sketch entity storage yields equal geometry and deterministic path
   start; construction edges do not become sweep geometry.
7. Invalid IDs/types/tolerance, duplicate sketch IDs, empty/branched/disconnected
   paths, stale projection, misaligned plane, degenerate/self-intersecting input
   and geometry budgets fail atomically. Include a valid non-axis-aligned world-frame
   placement through a transformed datum/sketch frame, not only origin XY.
8. Actual hidden Electron: ordered two-sketch binding, create exactly one surface,
   tolerance property edit without volume UI error, undo/redo and save/open.
   Actual native mesh -> offline Quest GPU: two-sided rendering, semantic picking,
   visible section clipping without a filled cap, source identity/material restore.

## Boundaries

Luna may implement only the worker packet's exact file scope after preserving
preimages/hashes. All dirty work remains. Parent alone packages/installs after
verification. Pinned Unity is 6000.3.25f1; no other Editor, dependencies or broad
generated-tree replacement. No foreground windows, headset wake or user action.
No SSH/Tailscale/Hermes/AI/STT/TTS calls: Hermes image work remains protected.
The local MCP bridge stays stopped after automatic approval review denials; no
retry via another mechanism. No commit, push, CI or release. Full goal remains
  active beyond this increment: manual surface-creation UI, trim/extend/thicken,
  assembly mates, direct face
editing, later live Hermes/voice and physical Quest acceptance.
