# Surface modeling foundation

## Goal and full scope

Roadmap 15.4 requires surface bodies, extrude, revolve, loft, sweep, offset,
trim, extend, sew/stitch and thicken. This design establishes real open B-Rep
bodies and the first three creation operations. The remaining operations stay
required in the full goal; the existing sewn-solid loft and planar face thicken
do not satisfy that remaining scope.

Use the existing parametric feature graph, OCAF storage, session command registry,
native mesh transport and client workspaces. No new subsystem or geometry format.
The user has authorized autonomous implementation and separate Luna/Max execution.

## Representation

Persist feature types SurfaceExtrude, SurfaceRevolve and SurfaceLoft. They open
independent bodies with sketch dependencies. Their geometry contains faces/shells,
never a TopAbs_SOLID and never automatically generated caps. A closed shell remains
a surface until an explicit later sew-to-solid operation.

Geometry kind is derived from the canonical feature type and checked against actual
topology at the native boundary. Do not add duplicated kind state to the ICAD body
manifest or change closed session body DTOs. Clients recognize these three types;
legacy feature types retain their current solid behavior. Surface summaries omit
enclosed volume. The internal numeric volume slot remains zero for transport/storage
compatibility, never an analysis claim.

## Creation contracts

Append command IDs without renumbering: CreateSurfaceExtrude=48,
CreateSurfaceRevolve=49, CreateSurfaceLoft=50. Regenerate C++, TS and C# bindings.
Each allocates exactly one feature under existing atomic creation budgets.

- Extrude: sketchId, distanceMm, finite nonzero signed distance with absolute value
  at most 100000 mm. Extrude exact sketch boundary wires along its actual plane
  normal, including open chains and closed curves; no face/prism caps.
- Revolve: sketchId, angleDeg in (0,360], world axis origin XYZ mm and direction
  XYZ, all finite, nonzero direction normalized internally. Flat numeric parameters
  default to world origin / X direction in the command schema. Store the seven
  numeric values in canonical parameter slots so edits and configurations rebuild.
  Revolve exact wires; no solids or closing caps, including a complete turn.
- Loft: 2–128 distinct ordered sketchIds, exactly one connected nonbranching wire
  per section, consistently open or closed sections, no caps/solidification.

Build exact edges using existing sketch entity evaluators, including projected
geometry where supported. Connect/reorder edges deterministically; reject branching,
missing/ambiguous IDs, zero/degenerate entities and any dropped edge. Extrude/revolve
may produce disconnected surface patches in one body. Bound evaluated input sizes
(maximum 4096 edges per sketch) and reject excess before expensive evaluation.

Invalid input, unavailable dependencies, failed OCCT evaluation or persistence must
leave graph, bodies, revision, geometry and OCAF unchanged. Updates reuse the same
build path. Preserve source sketch planes, associations and persistent entity IDs;
no face/edge array index may enter persisted parameters or references.

## Analysis and validation

Recognize valid face/shell surface bodies in validateFeature/Body/Document rather
than requiring a solid unconditionally. Area and bounds work for both kinds.
Explicit surface mass/volume/thickness queries must fail clearly rather than
integrating an open shell into a fake enclosed volume. Whole-document physical
volume/mass considers actual solid tips/instances and ignores free surfaces, while
explicit mixed or surface selections are rejected. Bounding-box results identify
surface kind and return no usable enclosed-volume number for it. Interference keeps
its existing skip-nonsolid behavior. Existing solid query results remain compatible.
Global volume for an empty document or a document containing only surfaces is zero;
this preserves the existing empty-document and cancelled-MCP-request contract.
Known solid operations must reject a non-solid result atomically. Direct surface
instances keep their surface kind; unresolved/cyclic metadata must not silently turn
a surface into a solid. Preserve the existing C8 rejection of nested instances;
support for nested instances is not introduced by this packet.

OCAF RecordFromLabel currently unwraps solids and culls every faces-only shape.
Decode the canonical type before choosing that adoption path. Permit valid surface
face/shell geometry for the three new types and direct surface instances, with the
numeric volume slot zero. Preserve the existing solid and unknown-type cull behavior.

## Client integration

Register all commands in the canonical catalog with strict parameter schemas and
accurate creation metadata. Use existing command execution/forms and MCP discovery.
Surface types are explicit in tree/session descriptions and have localized labels.
The existing Properties panel exposes SurfaceExtrude distance and all seven
SurfaceRevolve slots, with degrees, millimetres and dimensionless axis components
parsed/labeled correctly. A loft is edited through its source sketches. Do not show
the compatibility zero-volume slot as a surface volume in any transient UI state.
Do not invent a surface preview or an unsupported Quest sketch-creation workflow.

Both Desktop and Quest render surface bodies from either side without changing CAD
vertices, winding, indices, picking ownership or colliders. Section, zebra and
curvature state must preserve surface culling when toggled/restored. Solid material
behavior remains as before. Do not add a new mesh wire field solely for culling;
derive kind from the already current feature summary at upload/update time.
Section clipping/contours work on surfaces, but surfaces receive no filled section
cap even when a cylinder cut forms a closed contour.

## Acceptance

Real OCCT tests cover open/closed profiles, reordered edges, displaced/rotated planes,
curved geometry, full/partial revolution, lofts, area/bounds, no solids/caps, atomic
failures, edit/recompute, undo/redo, ICAD save/open and body-kind persistence by type.
Analyses must not invent a volume for an open surface displaced from the origin.
Contract tests cover the three appended IDs, schema validation and creation budgets.
Client tests cover tree kinds, both-side rendering and section/analysis restoration.
Parent then verifies a hidden Electron/native workflow and actual Unity rendering,
builds and updates the owned installations. No fresh physical-device acceptance is
inferred from tests, renders or installation.
