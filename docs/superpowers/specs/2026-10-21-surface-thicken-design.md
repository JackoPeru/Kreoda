# General surface thickening

## Authority and scope

Continue the approved full Phases 12–16 goal, roadmap 15.4. Product implementation
belongs to the existing separate GPT-6-Luna/Max task. Parent designs, reviews,
verifies and delivers. Keep the full goal active after this increment.

All project files and outputs remain under `C:/Users/matte/Desktop/Saas/Kreoda`.
Active worktree: `.worktrees/phase10-ci`; primary `Kreoda` checkout is read-only.
QA: `.artifacts/Codex-tools/Native/phase15-surface-thicken-20261021`.
Kernel research: `.codex/research/surface-thicken-20261021`.

## Proven kernel strategy

Independent parent runs measured 166 outcomes, 22 admissible analytic Arc cases
and eight negative controls. Exact source BREP hashes stayed unchanged. Low-level
`BRepOffset_MakeOffset::Initialize(sourceCopy, thickness, tolerance,
BRepOffset_Skin, false, false, GeomAbs_Arc, true, false)` followed by
`MakeOffsetShape()` passed planar, holed, cylindrical, reversed, L, open tube,
closed box, sphere and torus fixtures, with signed thickness.

Use this single proven algorithm. No prism, tessellation, synthetic cap, alternate
join, high-level Simple/Join or hand-built nested-shell fallback. OCCT-generated
walls close the free boundaries. Arc joins define the corner behavior.

Kernel success and valid BREP alone are insufficient: an excessive inward sphere
offset returned the original solid with no offset skin. Generic face history,
independently verified on 30 Arc cases, detects this without shape-specific math.

## Command, feature and lifecycle

Append `CreateSurfaceThicken = 54`; preserve IDs 1–53 and planar face command 46.
Strict named/native parameters:

- `targetId`: stable current surface-feature or direct surface-instance ID.
- `thicknessMm`: finite number, absolute value in [1e-6, 100000], signed along
  the oriented source normal.
- `toleranceMm`: finite number in [1e-7, 1], default 1e-6.

Create exactly one independent `SurfaceThicken` solid feature/body, parameters
`[thicknessMm, toleranceMm]`, dependencies `[targetId]`, empty refExtra. Retain
source geometry, metadata and visibility. Use normal CommitSingleFeature and
CommitShape, OCAF, dependency graph, parameter candidate evaluation and rebuild.
Support numeric edits, upstream changes, direct instances, Undo/Redo and ICAD.
Include real solid volume; never classify the result as a surface.

Interfaces: `BuildSurfaceThickenShape(const ShapeRecord&, double thicknessMm,
double toleranceMm, TopoDS_Shape*, std::string*)`; corresponding target-ID overload,
CreateSurfaceThickenFeature and RebuildSurfaceThickenFromStore. Candidate evaluation
must resolve the source from the supplied candidate-record map when present.

## Geometry validation and atomicity

Before the kernel: validate IDs, range and current geometry; require pure face/shell
topology, finite positive area/bounds, valid BREP and no self-interference, no loose
edges/vertices, one connected face component, no nonmanifold shared edges. Preserve
the established 4096-source-face budget. Handle periodic seam ancestry correctly.
Normalize face/shell/compound containers without adding, dropping or sewing geometry.
Copy exact geometry before OCCT construction; the stored source must remain untouched.

Before copying or normalizing the result, use the copied input face identities and
`OffsetFacesFromShapes()` history. For EVERY source face require:

1. Its original boundary face is retained in the output (`IsSame`/shape-map semantics).
2. `HasImage` is true and at least one final `LastImage` is a FACE, distinct from
   every original source face and present in the output. `LastImage` returning the
   original face when HasImage is false is not offset coverage.

For a closed input skin require an actual additional closed offset boundary, with
all candidate shells closed and at least two shells. Preserve multiple valid
cavities rather than imposing exactly two shells. Retain the history gates for
open inputs too; partial disappearance must fail rather than silently omit a face.

Result must contain exactly one material solid, no loose faces/shells/edges/vertices,
valid BRepCheck_Analyzer(true), valid BRepAlgoAPI_Check(false,true), finite bounds
and area and positive finite volume. Unwrap a sole-solid compound only after proving
no geometry would be discarded. Normalize orientation on owned topology and recheck.
Reject collapsed, disconnected, solid, mixed, stale, failed or self-intersecting
inputs/results with actionable errors. Do not add fixture-radius special cases.

Run these checks in the shared evaluator for creation, edits, candidates and rebuild.
Every failure leaves revision, history, IDs, source/body visibility, parameters and
previous geometry unchanged. Extend the exact surface-to-solid exception in the
common commit gate for this type; do not weaken ordinary solid dependency checks.

## Contracts and UI

Regenerate affected enum outputs using the installed matching flatc, with scoped
TEMP/TMP/TMPDIR inside the root. No new session or mesh DTO. Shared registry uses
strict schemas, fixedCount=1 and target owner binding. Existing agent catalog is
dynamic and needs no duplicate command list or Hermes call.

Add the seventh operation to the existing compact Desktop SurfaceToolsPanel and
ordinary fenced execute/coreClient.createSurface path. Healthy friendly source
chooser includes hidden sources and valid direct surface instances, excludes
solid results. Fields: signed thickness with unit parser and advanced tolerance.
Explain the signed normal direction briefly in EN/IT. Preserve all existing
in-flight, lineage, ACK/refresh retry and source-visibility behavior.

Properties exposes editable thickness/tolerance and actual solid volume. Add EN/IT
command/type/property labels. Quest's exact surface classifier must continue to
classify this and its solid instances as solid. Extend offline provenance/GPU
verification only as necessary, preserving legacy assertions and the solid section
cap path; current passthrough, Home, hands, navigation and pairing are unchanged.

## Required evidence

- Real RED then GREEN native command/evaluator tests; strict schema/native negatives.
- Analytic rectangle/hole and cylinder, both signs and reversed normal; L and tube
  with Arc corners; closed box, sphere and torus. For radius5/height20 cylinder:
  pi*20*abs((5+t)^2-25); sphere: 4*pi/3*abs((5+t)^3-125); torus R10/r2:
  20*pi^2*abs((2+t)^2-4), for admissible offsets.
- Sphere -5/-6 rejected by production history/boundary gates despite raw valid
  BREP; disconnected/mixed/solid input, unknown fields, IDs, scalar types and bad
  ranges rejected atomically. Source hashes/parameters/visibility unchanged.
- Real native lifecycle, numeric/upstream candidate changes, instance, Undo/Redo,
  save/open and positive physical queries. Existing solid operations still reject
  surface dependencies outside the two explicit conversion types.
- Focused registry/Desktop tests and build; actual hidden Electron manual creation,
  properties, failure preservation and lifecycle with the real native core.
- Quest classifier/solid section and actual native-mesh offline GPU proof, including
  hollow-body cap holes. No editor evidence substitutes for physical Quest acceptance.
- Parent baseline-relative review, full relevant native/contracts/Desktop gates,
  source-stable packaging and hidden install only after acceptance and idle checks.

No remote Hermes/SSH/Tailscale/AI/STT/TTS calls. TCP MCP bridge stays stopped after
prior approval-review denials. No foreground app, headset wake, commit or push.
