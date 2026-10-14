# Quest datum integration sequencing

Parent architecture follow-up to 2026-10-13-phase15-reference-geometry.md. Full Phases12–16 scope remains active. The current MCP proof worker owns only its probe/E2E lane; do not edit those files or start a second implementer on them.

## Verified current gaps

- Native session_geometry.cpp referenceCheck recognizes sketches, then resolves only ShapeStore entities. validateDocument calls it for sketch.supportRef; a legitimate supported sketch therefore needs datum reference validation before an actual MCP commit can pass.
- Native setSelection uses validateReferences. Quest cannot publish a datum UUID until that native route supports it.
- Canonical SelectionKind and the context-command reference allowlist have only body/face/edge/vertex/sketch. CreateSketch has no optional selected-datum support binding.
- Desktop shared-target visibility counts only body meshes and face/edge IDs; datum targets would be discarded even after native validation.
- QuestConnection observes only body/instance mesh targets; QuestControls selects QuestMeshView only. SessionModelState already retains datums/full sketch frames, but there are no Quest datum views or targets.
- Generic QuestCommands fields cannot provide a usable nested datum-definition construction UI; do not require the user to enter raw JSON.

## Sequence and ownership

1. Finish actual local MCP datum request proof. If its real RED confirms native support validation failure, authorize the same worker a narrowly scoped native correction in session_geometry.cpp and native session/datum tests. Keep bridge validation; no bypass or alternate resolver. Parent verifies and reviews changed native code.
2. Add canonical datum target kinds and optional sketch-support binding in a separate fully specified Luna/Max lane. Parent accepts contracts/native/relay/Desktop target identity before handing them to Unity.
3. Implement the Quest reference/frame adapter, compact construction/edit controls and hand input in one separate Luna/Max lane. Run managed/Unity Editor gates and a normal hidden ARM64 build. Device/live voice acceptance remains separate while the user's image-work restriction is active.

## Target contract decision

Use distinct semantic kinds datumPlane, datumAxis and datumPoint alongside unchanged existing kinds. They identify the actual native datum UUID, never a fabricated face/edge or body ID. Native referenceCheck obtains kind/status from DatumStore; no ShapeStore lookup or B-Rep body ownership for a datum. Broken/stale/removed records must fail current target validation.

Canonical SelectionKindSchema extends by these three values. Session context validation uses that canonical enum instead of a second hand-maintained list. Add an optional CreateSketch support binding named datumPlane: when exactly one valid datumPlane is selected, supportRef is bound to that UUID; when no datumPlane is selected, principal-plane sketch creation remains available with no supportRef binding. Axis/point selections must never become sketch support implicitly. Do not make optional binding mandatory for all CreateSketch calls.

Desktop selection classification, tree/context commands and shared-target highlighting recognize datums separately. Shared target filtering must count native datum identities as well as mesh IDs, retain current lineage/revision checks and reject ambiguity. A remote selected datum highlights its guide; this cannot select an unrelated solid.

## Quest frame/view requirements

Reuse generated datum/frame DTOs and CadMeshTransform's CAD-mm to Unity-metre convention (x,z,y)*0.001. Add only the needed pure reference conversion helper if the existing adapter cannot represent planes/axes/points. Generated sources are regenerated only when the schema changes.

Existing reuse confirmed from source: CadVector.Read in SpatialEditIntent.cs already validates finite triples and supplies vector operations; QuestDimensions.CadPoint already performs the reflected mm-to-metre point mapping. QuestSketchDimensions.ShowSketch already draws local 2D geometry using the complete native origin/xAxis/yAxis before that mapping. Reuse those paths, adding only missing frame validation/tests. Do not add a second coordinate converter or replace supported sketch drawing with a principal-plane reconstruction.

QuestConnection already captures SceneObservationStamp before its main-thread reconcile; SceneReconcilePlan.IgnoredStaleObservation identifies stale snapshots. Carry datum records with that captured observation and reconcile them only when the same observation is accepted. StartConnection/Forget/disconnection invalidate current targets; retaining offline guides for display must never leave them publishable or voice-selectable. OnDestroy disposes their owned objects alongside meshes. Datum-only model changes must notify the scene/display without requesting solid meshes.

Native resolved records remain authoritative. All reference view vertices and supported sketch positions use the complete native origin/basis; no fallback from planeKind Datum to XY. Keep the native definition, source UUIDs, status/error and sketch supportRef. The y/z reflection changes handedness; do not reconstruct the mapped basis as an arbitrary rotation that moves geometry. Compute display geometry from mapped native vectors and preserve semantic UUIDs under moved, rotated, nonuniform/scaled/reflected DisplayRoot test cases.

QuestConnection reconciles datum records on the Unity main thread with the same captured session/document/revision freshness boundary as meshes. Snapshot, ordered delta, removal, Undo/Redo, reconnect and document replacement must remove stale guides/targets; no RequestMesh for datums. Reference guides have no body/solid semantics. Invalid records fail explicitly, not as fabricated current geometry.

QuestDatumView is separate from QuestMeshView. Show planes, axes and points from native records; selectable borders/axes/points should preserve body-face and section-cap selection. Reference picking identifies actual UUIDs and respects UI hit priority and current lineage. Parent-owned data parsing and native target validation decide whether a selection can be published or used for voice.

## Hand interaction and controls

Use existing tracked-hand ray/index pinch routing; controllers remain optional. Datum selection, panel buttons, creation/edit/inspect and supported-sketch action must work with no connected controllers. Preserve tracking confidence gating, release requirement, lost-tracking/focus cancellation, panel dragging, two-hand placement and voice cancellation.

Add compact paged reference controls using real source choices and explicit mm/degrees; all ten constructors remain reachable. Numeric entries use existing supported UI input, not JSON. Select real datum points/planes/axes or native planar faces/straight edges and show actual source labels/status. Edits retain UUIDs. Supported sketch creation is enabled only on a current valid datumPlane. No new manual IP/code provisioning or required user setup on the headset.

## Required evidence before accepting this integration

- Actual native datum target validation, missing/wrong-kind/broken rejection, supported document validity and no body ownership.
- Canonical context-command tests: a single datum plane binds sketch support, principal creation remains available, axes/points never bind support, current revision required.
- Actual local session setSelection of a datum reaches Desktop guide identity; removal/Undo/document switch clears it. Existing mesh targets remain unchanged.
- Managed strict full-frame/reference conversion tests; no datum meshes or solid count changes.
- Unity Editor transformed-root plane/axis/point placement/picking, full supported sketch frame, stale callbacks/removal, section/body occlusion, current datum publication and voice selection.
- Controller-free index-pinch/button routes plus tracking-loss/release/focus cancellation; preserve existing panel/two-hand/section/voice test suites.
- Normal hidden ARM64 build with authored-scene restoration, source/artifact hashes and validation warnings recorded without suppressing required checks.
- Parent verification and fresh immutable GPT-6-Sol/High review; current-head CI and physical/live acceptance remain open until separately proved.

No Hermes/server/SSH/AI calls, remote service changes, device installation/capture, microphone/camera capture, PC audio or foreground GUI while the user's image work restriction remains active. Local native/fake-gateway/managed/editor/hidden UI builds are allowed. No merge or release inferred from these packets.
