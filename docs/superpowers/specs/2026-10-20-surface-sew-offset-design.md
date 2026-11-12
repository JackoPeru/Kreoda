# Associative surface sewing and offset

## Full goal and selected increment

Roadmap 15.4 still requires sweep, offset, trim, extend, sew/stitch and thicken.
This increment implements general sewing and offset on existing B-Rep surface
bodies. The other four operations remain required, along with the unfinished
assembly/direct-editing and live/physical acceptance work. The user authorizes
autonomous development and separate GPT-6-Luna/Max implementation, with parent
review and verification. Preserve the dirty worktree and installed foundation.

## Representation and body ownership

Append CreateSurfaceSew=51 and CreateSurfaceOffset=52, without renumbering IDs.
Canonical types: SurfaceSew and SurfaceOffset are surfaces; SurfaceSewnSolid is a
solid, regardless of its name prefix. Geometry kind remains derived, not duplicated
in persisted body metadata or closed session DTOs. Extend exact kind classifiers
in native, TS and Quest, including direct instances and OCAF prototype checks.

Each command allocates exactly one feature/new body with ordinary source-feature
dependencies. Inputs and their existing visibility remain unchanged and editable;
the result can be isolated with existing visibility controls. No automatic source
consumption, boolean fusion or implicit changes to other bodies. This deliberately
uses the current independent-body semantics. Editing inputs rebuilds the result.
Generic ordinal face/edge roles remain reference-fenced; no array index is persisted.

## CreateSurfaceSew

Parameters: featureIds (1–128 distinct stable IDs, ordered); toleranceMm finite in
[1e-7,1], default 0.01; makeSolid boolean, default false. Every input must be current,
valid face/shell geometry without any solid, including valid direct surface
instances. Reject unavailable/missing/solid/mixed inputs before mutation. Bound the
combined input to 4096 faces before expensive evaluation.

Copy input B-Reps before OCCT sewing so shared source topology is not modified.
Use BRepBuilderAPI_Sewing with the requested tolerance and manifold mode. Reject
deleted faces, nonmanifold output, disconnected leftovers, null/invalid results
and dropped source faces. Result must be one connected face/shell, including a
closed shell when requested without solidification. No repair that invents faces
or caps. Preserve curved geometry; this is not restricted to planes or lofts.

makeSolid=false creates SurfaceSew with paramsMm=[toleranceMm]. It has no SOLID
topology, even for a closed shell, and retains zero mesh volume / physical-query
rejection. makeSolid=true creates SurfaceSewnSolid with the same numeric slot.
The canonical type carries the mode; do not persist a second redundant flag.

For solidification, require an actually closed manifold shell. A single face may
be wrapped as a shell only when closure validation succeeds (e.g. a periodic torus).
Use BRepCheck_Shell closure validation, BRepBuilderAPI_MakeSolid and
BRepLib::OrientClosedSolid; require one valid positive-volume solid with no free
faces. An open shell fails atomically instead of being capped. Preserve the generic
solid-result gate but exempt this explicit converter from the old requirement that
solid-producing operations have only solid dependencies; validate its surface
dependencies in its shared builder. Other solid operations keep their gates.

## CreateSurfaceOffset

Parameters: targetId (one current surface feature or direct surface instance),
distanceMm finite with absolute value in [1e-6,100000], toleranceMm finite in
[1e-7,1], default 1e-6. Positive distance follows oriented B-Rep surface normals;
negative distance reverses it. Store paramsMm=[distanceMm,toleranceMm] and target
dependency. No sketch-plane coordinate conversion or polygon approximation.

Use a copied exact shape with BRepOffsetAPI_MakeOffsetShape.PerformByJoin, skin
mode and Arc joins. Do not fall back to an unrelated planar or per-face translation
when OCCT cannot offset the supplied geometry. Require valid uncapped surface
topology, finite bounds and positive area. Reject collapse, self-interference and
invalid results clearly and atomically. Use BRepCheck plus the available
BRepAlgoAPI_Check self-interference check (small-edge checking need not reject
legitimate degenerate seam/pole topology). Bound source input to 4096 faces.

OCCT's documented limits on continuity, intersections and large offsets remain
real limitations; fail clearly rather than silently changing the requested result.
No global mathematical guarantee beyond executed kernel validation is claimed.

## Integration

Reuse surface_modeling helpers, creation budgets, graph/rebuild/edit paths and OCAF
load/resync. Both new operations support numeric edits, undo/redo, save/open,
configuration/recompute and existing analysis. SurfaceSewnSolid has physical volume,
mass and minimum-thickness semantics; its surface inputs contribute no fake volume.

Add strict canonical schemas, defaults and fixedCount=1 metadata; regenerate only
the native/TS/C# command enum files affected by IDs. Use existing generic command
translation. Add selection binding owners for a distinct ordered array of selected
owners (SurfaceSew.featureIds) and existing owner for SurfaceOffset.targetId.
Bindings must remain reference/revision fenced; no cross-owner array-index aliases.
Wrong geometry kinds still fail at the native boundary, not through fake results.

Properties exposes sewing tolerance and offset distance/tolerance with correct mm
labels and slots. Surface types hide the compatibility volume; SurfaceSewnSolid
shows genuine volume. Localize types/commands in English and Italian. Quest keeps
hands/controller routing and minimal UI, recognizes the two new surface types,
and uses existing schema-driven command forms without hardcoded feature IDs.
No Home/pairing/voice rewrite, new mesh field, dependency or generic new subsystem.

## Required proof

- Native RED then GREEN: adjacent open patches sew as surface but refuse makeSolid;
  disjoint/nonmanifold/invalid/duplicate/oversized inputs fail without mutation.
- Actual loft lateral surface plus two separately authored end surfaces sews to
  one positive-volume solid; no automatic caps. Also a curved periodic torus source
  becomes a solid with analytical area and volume. Surface-only mode stays surface.
- Positive/negative offsets on actual planar, cylindrical and multi-face surface
  bodies: oriented displacement, analytical bounds/area, zero solids/mesh volume.
  Large inward collapse/self-interference fails without replacing canonical state.
- Dependencies and source shapes remain intact; upstream edits, numeric edits,
  failed edits, undo/redo, ICAD reopen and direct instance kind are exercised.
- Native solid/Sew gate and existing foundation regressions remain green. Strict
  command/default/creation metadata and multi-owner binding tests execute.
- Real hidden Electron/native workflow: create/edit/reopen and inspect surfaces
  versus sewn solids, area/volume and exactly one allocated feature per command.
- Focused Quest classification/material/selection tests and actual native-fixture
  GPU rendering distinguish sewn surface from sewn solid section behavior.
- Parent inspects original-baseline diff/scope, verifies runtime artifacts and only
  then updates owned installations with hashes/backups. Physical acceptance remains
  separate from Editor renders. No hosted CI/release or whole-goal completion claim.

## Protected runtime

Do not contact SSH/Tailscale/Hermes/STT/TTS or disturb the user's image work. Local
MCP bridge startup was rejected by automatic approval review; do not retry through
another execution mechanism or refactor it to evade that rejection. CAD work and
isolated local tests can continue. No foreground windows or headset wake/Guardian
overrides. No broad restore, commit or push.
