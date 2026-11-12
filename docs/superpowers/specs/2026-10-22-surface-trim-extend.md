# Surface trim and extend

Approved direction: original roadmap Phase 15; autonomous user authorization to
complete remaining phases. Implementation uses the existing Luna/Max worker.

## Behavior

- Trim an exact connected surface body with another finite surface body or a
  healthy datum plane. Keep the physical connected region selected by the user.
  Reject a cut that does not partition the source, missing intersections,
  coincident/tangent-only tools and ambiguous points on an actual cut.
- Extend one selected free outer boundary edge on its continuing exact support.
  Positive distance is the 3D chord between corresponding boundary midpoints.
  It is not a uniform geodesic offset. Preserve the original surface and holes,
  add an annex, then sew. Reject inner-hole edges, seams, shared/nonmanifold
  edges, degenerate inputs, self-intersections and unsupported continuations.
- Both create independent editable surface bodies with zero volume; retain
  source visibility. Never cap, thicken, mesh-replace or silently change analytic
  support to B-spline. Failure is atomic.

## Settled wire contract

Append native commands 55 CreateSurfaceTrim and 56 CreateSurfaceExtend. Preserve
all existing IDs 1..54.

CreateSurfaceTrim: featureId, targetId, toolId, keepFace, keepUv, toleranceMm.
keepFace is {type:"face", featureId:targetId, persistentFaceId:string}; keepUv
is exactly two finite numbers. toolId identifies a pure surface feature or a
healthy DatumPlane. Target and tool differ. toleranceMm defaults to 1e-6 and is
within [1e-7,1]. Strictly reject unknown/malformed fields.

CreateSurfaceExtend: featureId, targetId, boundaryEdge, distanceMm, toleranceMm.
boundaryEdge is {type:"edge", featureId:targetId, persistentEdgeId:string}.
distanceMm is finite positive [1e-6,100000]; same tolerance rules as trim.

Read-only RequestSessionQuery method resolveSurfacePoint: targetId, pointMm
(three finite numbers), optional persistentFaceId and optional maxDistanceMm
([1e-6,1], default 0.5). Return keepFace, keepUv, exact pointMm and
projectionDistanceMm. Project onto exact trimmed faces, reject holes, out-of-face
points and unresolved geometric ambiguity. Face hint must belong to target.
The query does not bind labels, change IDs, revision, graph, visibility or BREP.
Acquisition projection tolerance is separate from modeling tolerance; curved
tessellation clicks need projection before physical-membership validation.

## Persistent references and lifecycle

Store a versioned refExtra object with the face/edge reference. Reuse existing
OCAF BindDatumSources and its resolver inside a real OCAF command; no new naming
subsystem. Keep UV in editable params (keepU, keepV, toleranceMm), dimensionless
in UI. Extend params are distanceMm, toleranceMm. A face/UV follows support and
location edits. An erased face, invalid UV or lost indexed reference fails
explicitly, without nearest-face/ordinal fallback. Map selected shapes through
deep-copy history rather than selecting ordinals again after copying.

Use existing graph dependencies, candidate maps, save/open, Undo/Redo,
configuration and SetDimension paths. Recompute tool datums against candidate
sources. If a preview lacks genuine naming/datum context, reject it explicitly;
creation supportsPreview=false. Never use stale live geometry as a candidate.
Snapshot/abort must restore model, OCAF labels, IDs and revision on failure.

## Kernel basis

Research is frozen under .codex/research/surface-trim-extend-20261021.
Probe 1: exact PaveFiller + Splitter regions, section identity, plane/holes,
cylinder/sphere/torus, L-shell and sewn box; non-partition controls reject.
Probe 2/3: source-preserving sewn annexes, native UV strips/pcurves, midpoint
chord calibration, analytic support retention, hole Common-area checks.
Use Splitter history to locate fragments of the bound source face. Use UV on
that same support and physical distance as appropriate. A 3D FaceClassifier
alone can falsely clamp a remote point onto a trimmed boundary.

Support natural UV boundaries plus nonisoparametric pcurve edges and closed
outer loops demonstrated by probes. Bounded support continuation must preserve
the old domain/tangents; do not drop holes by returning raw ExtendFace.
All operations validate finite geometry, positive area, connected surface,
BREP/self-interference and no solids/loose geometry, with 4096-face budget.

## Desktop and Quest

Desktop compact surface form: select target/tool, explicit cancellable click
for keep point or numeric XYZ, exact query resolution then normal fenced command.
Retain fields/errors; cancel on source/doc/revision/epoch/generation change.
Drag still rotates, right drag pans, wheel zooms. No hidden persistent click.
Extend uses persistent semantic edge selection. Properties show correct units.
Schema, TS/C#/Unity command IDs, agent metadata and exact surface classification
must agree. Quest keeps passthrough and hands paths; no opaque background.

## Verification and boundaries

Native RED before builders; real public sketch/surface constructors as well as
raw geometry fixtures. Test holes, curved supports/pcurves, ambiguous cuts,
source immutability, candidate/upstream edits, naming loss, failed transactions,
Undo/Redo and save/open. Then Desktop/schema/protocol/Quest tests, actual native
stdio and hidden GUI/GPU proof. Package/deploy only after fresh idle identity
and trust backup checks. No physical-device, live AI or release claim from local
tests. Do not contact Hermes or restart the denied TCP9843 MCP bridge.
