# Quest reference construction and editing

Follow-up to the datum view/target adapter, not concurrent implementation of its files. Full Phases12–16 goal remains active. This implements the already specified compact reference controls from the Phase15.1 spec; it does not introduce a new CAD architecture.

## Goal and settled flow

On Quest with hands and no controllers: open Riferimenti, choose Piano/Asse/Punto and construction, choose actual sources or enter numeric mm/degrees, inspect the definition and confirm one canonical command. Select an existing datum to inspect or edit its definition while preserving its UUID. A current healthy plane offers Sketch sul piano using the PC-returned support binding. No raw JSON, manual IP/code provisioning or geometry inferred by the renderer.

Reuse the accepted panel/page/buttons and system numeric keyboard. The current generic QuestCommands object field would require nested JSON, so a dedicated small form supplies that object to the same canonical command path. Root accepts the view/target adapter before dispatching this task to separate GPT-6-Luna/Max. Parent then verifies and requests fresh immutable GPT-6-Sol/High review.

## Ownership and interfaces

- New Runtime/QuestReferences.cs and Editor/QuestReferencesTests.cs with their .meta files: form state, field traversal, source choices and canonical definition composition.
- Runtime/QuestControls.cs: dedicated compact page and existing pinch buttons, numeric keyboard ticket routing, entry from the visible menu; preserve panel sizing/dragging/voice/section.
- Runtime/QuestCommands.cs: expose one guarded canonical form submission entry; reuse existing command execution/timeout/snapshot/error/Undo path. Definitions and command schemas remain PC-authoritative. Do not create a second network mutation path.
- Editor/QuestBuild.cs: wire the new component both during normal scene preparation and validation. Preserve scene/material source bytes after hidden builds.
- Focused existing Editor controls/commands/scene tests only where new integration changes behavior.

Use actual current SessionClient model, command schema/context and datum adapter interfaces accepted by the previous packet. Numeric range labels reflect canonical definitions: coordinates/offset ±1000000mm, degrees [-360,360], finite values. Native geometry/kind/degeneracy/cycle validation remains authoritative. Missing, broken, stale or wrong-kind sources never become principal sources implicitly. Forms capture session/document/revision and a ticket; edits or keyboard completions against another context are cancelled, never reissued blindly.

## Construction coverage

| Kind | Operations | Editable inputs |
|---|---|---|
|Plane|principal|XY/XZ/YZ|
|Plane|offset|PlaneRef base; offsetMm|
|Plane|mid|PlaneRef first/second|
|Plane|angle|PlaneRef base; AxisRef axis; angleDeg|
|Plane|threePoint|PointRef first/second/third|
|Axis|twoPoint|PointRef first/second|
|Axis|planeNormal|PlaneRef plane; optional PointRef through|
|Axis|planeIntersection|PlaneRef first/second|
|Point|coordinates|positionMm X/Y/Z|
|Point|midpoint|PointRef first/second|

PlaneRef choices: principal planes, current healthy native datum planes, real selected native planar faces. AxisRef: principal axes, current healthy datum axes, real selected straight native edges. PointRef: numeric coordinates or current healthy datum points. Choosing a face/edge carries its actual owner feature UUID and persistent face/edge identity; do not derive identity from view order or a generated label. Native validation reports nonplanar/curved sources. Existing missing/broken definitions remain inspectable with their status/error and cannot be presented as a healthy selectable source.

## UI decisions

One page reuses the accepted panel. Top shows kind/operation and create/edit mode; middle shows the current field or source with readable labels and explicit units; bottom has previous/next field, source choice or numeric value, confirm/cancel. Paginate source choices and show real source label/UUID/status. Long text uses the existing bounded text policy. Keep buttons separated with the accepted minimum dimensions; diagnostics and native JSON stay outside the product flow. State required optional through-point explicitly: plane origin or chosen point. Edit starts from the actual native definition, not fresh defaults. Cancel abandons the form without a CAD command.

## Implementation and meaningful gates

- [ ] RED: all ten constructors compose their exact discriminated definition from typed field/source input; edit retains featureId; comma-decimal numeric input supported; nonfinite/out-of-range/missing source blocked. Coordinates remain distinct from datum references.
- [ ] RED: document/revision/connection change, source removal/broken status, stale keyboard ticket and focus/tracking loss cannot commit an obsolete form. No automatic retry after lost acknowledgement. Source kind mismatch cannot be selected as valid support.
- [ ] Implement small typed form and one canonical guarded submission, reusing PC schemas and existing client execution. Confirm makes exactly one create or UpdateDatum request; Undo remains the existing shared history.
- [ ] Integrate hand-only page/buttons/numeric input with existing release/confidence/UI-priority routes. Test button/field/source traversal and cancel through actual control routing, rather than only checking method existence.
- [ ] Editor integration proof: create an offset plane24 and supported sketch through fake canonical client; inspect exact emitted payload/session/document/baseRevision and bound supportRef; edit offset and Undo each emit one command; stale data emits zero commands. No fake results claimed as native or live proof.
- [ ] Root repeats managed gates if helper code changes and full hidden Unity Editor suite with current staged managed assemblies. Require discovered tests, zero failures/skips/inconclusive; retain XML/logs and pre/post source hashes including new authored .cs/.meta files.
- [ ] Normal hidden ARM64 build using scripts/build-quest-client.mjs with actual Editor/Android SDK, no bypassed validation. Preserve all authored bytes after Unity mutations; record APK hash, source manifests, managed manifest, validation warnings and actual build report.
- [ ] Parent inspect actual diff, ownership, source/artifact evidence; fresh source-frozen Sol/high review. Current-head hosted CI and physical/live acceptance remain separate required gates.

## Constraints and self-review

No new dependency, secondary CAD solver, schema duplication or mesh requests for datums. No Hermes/server/SSH/AI probes, remote changes, device install/capture, mic/camera, PC audio or foreground GUI while image-work restriction remains active. Primary dirty checkout remains untouched. No push/merge/release by worker.

Coverage maps each of the ten Phase15.1 constructors, real source choices, edit/inspect, supported sketch, controller-free controls and ordinary Undo to tasks above. Critical tests cover stale lineage, wrong source kinds, keyboard retargeting, numeric validity and one-command history. Adapter-specific frame/picking/freshness tests belong to the predecessor; they must remain passing. This plan is sequencing evidence, not implementation or acceptance.
