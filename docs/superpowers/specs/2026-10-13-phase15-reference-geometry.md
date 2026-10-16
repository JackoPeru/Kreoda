# Phase 15.1 — native datum geometry and supported sketches

## Intent and scope

Implement all reference geometry named in roadmap15.1: datum planes, axes and points; offset, mid, angle and three-point planes. Each is a native parametric feature with stable UUID, explicit dependencies and persistent references. A datum supports a real sketch and subsequent native feature. Presentation-only section/image planes do not satisfy this requirement. Full Phases12–16, other Advanced CAD and physical Quest acceptance remain open.

Execution stays in separate GPT-6-Luna/Max tasks, with parent verification and fresh Sol6/high review. User already authorized autonomous continuation and that execution method. The current Quest section worker keeps ownership until delivery; this specification is for subsequent tasks.

## Settled architecture

Reuse the existing SketchPlane frame, FeatureGraph, OCAF command/Undo lifecycle and native persistent face/edge resolution. Store datums in a dedicated native DatumStore alongside SketchStore, with an OCAF Datums folder containing versioned JSON definitions. Do not put reference planes into solid BodyStore or fabricate B-Rep shapes for them. A datum definition plus resolved geometry, status and dependencies is authoritative; renderers display it without deriving CAD geometry.

An alternative of storing degenerate datum shapes in ShapeStore would route them into solid-body tips and mesh/volume code. Renderer-only planes would lose parametric dependencies and save/open guarantees. Dedicated reference records fit the existing sketch pattern and keep those semantics explicit.

## Frame contract

PlaneFrame uses CAD mm origin[3], unit xAxis[3], yAxis[3], normal[3]. All components finite; basis lengths and pairwise dot products within1e-9 of unit/zero, cross(xAxis,yAxis) aligned with normal within1e-9. Resolved frames may originate from translated native geometry; do not truncate valid positions to a UI input limit. User-entered coordinate/offset parameters follow the existing ±1000000mm bounds, angleDeg is finite within[-360,360], explicit degrees converted once to radians internally. Legacy XY/XZ/YZ sketches remain compatible.

SerializeSketchFeature already writes the frame. ParseSketchFeature must validate and restore it, not reconstruct PrincipalPlane when a valid serialized frame exists. Legacy records without a plane use their supported principal plane; malformed present frames are explicit errors, never silent fallback. Existing arbitrary offset/oriented frames must survive actual OCAF Undo/Redo/save/open/recovery.

CreateSketch accepts optional supportRef naming an actual DatumPlane UUID. Native resolution sets the frame and planeKind=Datum; client labels show the datum rather than falsely calling it XY. The local solved sketch model stays two-dimensional. Native extrusion/revolve/face builders consume the resolved frame. Datum changes recompute supported sketches before their solids, retaining sketch/feature UUIDs and ordinary editability. Existing CreateSketch without supportRef remains principal-plane creation.

## Definition interfaces

Use discriminated JSON definitions; stable IDs retain the existing1–128 ASCII letters/digits/_/- validation.

- PlaneRef: principal{planeKind:XY|XZ|YZ}, datum{featureId}, face{featureId,persistentFaceId}. Face source must resolve an actual planar native face.
- PointRef: coordinates{positionMm:[x,y,z]} or datum{featureId} resolving an actual DatumPoint.
- AxisRef: principal{axis:X|Y|Z}, datum{featureId}, edge{featureId,persistentEdgeId}. Native edge must be a straight line, not an arbitrary curved tangent.
- DatumPlane definition: principal{planeKind}; offset{base:PlaneRef,offsetMm}; mid{first:PlaneRef,second:PlaneRef}; angle{base:PlaneRef,axis:AxisRef,angleDeg}; threePoint{first:PointRef,second:PointRef,third:PointRef}.
- DatumAxis definition: twoPoint{first:PointRef,second:PointRef}; planeNormal{plane:PlaneRef,through?:PointRef}; planeIntersection{first:PlaneRef,second:PlaneRef}.
- DatumPoint definition: coordinates{positionMm:[x,y,z]}; midpoint{first:PointRef,second:PointRef}.

Native definitions retain references, not only resolved coordinates. Reject mismatched datum kinds, missing/ambiguous native references, coincident axis points, collinear plane points and cycles before a create/update commit.

Degeneracy thresholds: point separation or third-point distance from the first/second line ≤1e-7mm is rejected; parallel normal cross-product length ≤1e-9 is treated as parallel. These match CAD-scale tolerance rather than permitting unstable near-zero frames.

Construction rules: offset translates base origin along its unit normal. Mid requires parallel planes, aligns opposing normals and places the frame halfway in signed distance using the first plane basis. Angle rotates the entire base frame around the directed axis with the right-hand rule. ThreePoint uses first as origin, normalized first→second as x, normalized cross(first→second,first→third) as normal, normal×x as y. PlaneNormal defaults through to plane origin. TwoPlane axis uses normalized normal cross product and a point satisfying both equations; reject parallel/coincident ambiguity. Midpoint averages resolved points.

## Native lifecycle and invariants

DatumRecord{featureId,kind,definition,dependsOn,resolved,status,error}. Resolved planes use PlaneFrame; axes use finite origin/unit direction; points use finite positionMm. Kinds are DatumPlane/DatumAxis/DatumPoint, all NonBody in native/Desktop/managed projections. A new/update/delete is one normal OCAF command and revision step; participates in session transactions/rollback. Undo/new/open synchronize all stores and rebuild graph edges, including supportRef edges that SyncGraphFromStore currently omits.

Changing numeric datum parameters via existing SetParam or replacing definition with UpdateDatum preserves UUID and atomically updates graph/persistence/resolved data. Downstream reference failure is explicit broken state; do not silently replace a missing datum with XY or publish last-good geometry as current. Deleting a referenced datum is refused by the existing non-cascade policy. Reject invalid/cyclic updates without altering revision, document, graph, feature parameters or Undo depth.

Add JSON-control commands31 CreateDatumPlane,32 CreateDatumAxis,33 CreateDatumPoint,34 UpdateDatum and35 RequestDatum, after existing30. Keep enum mirrors/codegen synchronized. Creation metadata fixedCount1 for creates,0 for update/query; MCP/agent budgets consume canonical schema metadata. Preserve old numeric command IDs. Create parameters contain definition; UpdateDatum contains featureId and replacement definition; RequestDatum contains featureId. SetParam exposes numeric fields supported by the definition without changing its kind or sources.

Read-only session query getDatum{featureId} delegates to RequestDatum so the existing MCP query tool can inspect it without starting a mutation request.

Snapshots/session deltas expose datums and full sketch frames with compatible generated contracts. RequestDatum returns definition, geometry, dependencies and status. Datum creation must not trigger RequestMesh or change solid count/volume of existing bodies. Body/feature registries and persistent semantic selection distinguish datums from solid faces/edges.

## Desktop, Quest and Hermes exposure

Compact advanced Reference geometry controls use canonical schemas. Show datums in the feature tree, definition/parameters editable, source references inspectable and broken state visible. Principal/offset/mid/angle/three-point plane workflows, axis and point workflows are reachable; supported sketch creation selects DatumPlane. Datums are separate reference renderers, not cap geometry or a claimed B-Rep face. Keep accepted mouse controls and viewport space.

Quest receives the same native records/frames, uses existing CAD↔Unity(x,z,y)*0.001 conversion under DisplayRoot, and displays/selects persistent datum UUIDs with existing hand/pinch routing. Keep panel dragging, two-hand placement and voice cancellation. Semantic voice targets identify real datum features; no manual IP/code/keyboard setup added. Existing section clipping does not invent datum IDs or mutate them.

Existing CAD MCP exposes datum definitions/commands and context so Hermes can use them outside Quest. Do not bypass Hermes with direct unknown LLM calls. No live server calls while the user's image work constraint is active; use local native/fake-gateway proof only and report that boundary.

## Acceptance evidence

1. Deterministic frame/constructor/invalid/cycle tests, all stated construction variants.
2. Actual OCCT datum→sketch→extrude/revolve, measured placement/orientation/volume, stable UUIDs and source refs. Editing an upstream point/plane/axis recomputes its dependents; unrelated branches stay unchanged.
3. Real save/open/recovery plus one ordinary Undo/Redo preserve definition, resolved frame, dependencies and geometry. Legacy principal sketches load unchanged; malformed frames explicit.
4. NonBody tests and actual snapshot/mesh behavior: datums never masquerade as solids and cannot change existing volume/solidCount by display/selection.
5. Desktop real controls/native E2E; generated contract/schema checks; actual managed targets; Quest editor transformed-root/pinch/semantic tests and normal hidden ARM64 build.
6. MCP→native local proof and editable agent-created features, using canonical creation counts. New-head hosted CI and fresh source-frozen Sol6/high review. Physical Quest comfort/voice and live Hermes are separate unproven gates until permitted evidence exists.

## Constraints

No new dependency or second CAD solver. No plaintext credentials in outputs. Preserve local data, old IDs/protocol behavior and current Quest worker edits. Hidden local testing/builds; no microphone/camera/person capture, PC audio, SSH/AI/server probe, remote service changes or foreground GUI while the image-work constraint remains active. No release/merge or full-goal completion inferred from this feature.
