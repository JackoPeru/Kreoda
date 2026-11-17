# Projection protocol and client handoff

This is the required continuation after the native lifecycle packet, not an implementation or acceptance claim. Preserve the full Phases12–16 objective. The active native worker owns native files; this document changes no code or generated artifacts.

## Settled interfaces

- Add public native IDs36 SetSketchProjection,37 RemoveSketchProjection,38 RequestSketchProjection together with canonical definitions. Parameters and semantics are in the projection-groups contract. Mutations count zero new native features: canonical creation.fixedCount=0. A group is owned by its sketch; do not invent a separate session feature/body/entity kind.
- Carry strict version1 projectEdges/silhouette/section definitions. Preserve native limits:128 groups/sketch,128 sources/group,128 unique authored entity IDs/source,65536 UTF-8 definition bytes,2000 total evaluated edges/sketch. Enforce byte length independently from JavaScript UTF-16 length. Reject private naming labels at the public mutation boundary.
- Native query returns public definition, source dependencies, stable groupId, derived status/diagnostic and current evaluated frame/generation. Native output member indices are local presentation indices; they are not persistent selectable references. Never return private bindings as editable source fields.
- Keep projection groups nested in the owning SketchDescriptor and sketch incremental patch. Include enough summary information to invalidate downstream geometry and expose broken sources. Heavy display geometry can be fetched by RequestSketchProjection. Do not serve a cached healthy profile/mesh when the native availability result is broken.
- Broken geometry is unavailable, not a valid zero volume or empty bounding box. Confirm exact native diagnostic JSON from the lifecycle handoff before implementing typed response schemas. Healthy group-free documents retain their current behavior.

## Inspected integration seams

| Concern | Authoritative existing seam |
|---|---|
| Numeric native command IDs | packages/protocol/src/index.ts; native dispatcher and native command enum inspected in implementation task |
| Canonical parameters/allocation | packages/command-schema/src/index.ts and native-command.ts |
| Shared control DTO source | schemas/session-control-v1.json |
| Deterministic generation | scripts/generate-session-contract.mjs; pnpm generate:session and pnpm check:session-contract |
| Runtime schema exports | packages/protocol/src/session-control.ts |
| Incremental entity ownership | packages/protocol/src/session-model.ts; existing sketch patch kind |
| Relay native semantic queries | apps/desktop/electron/session-queries.ts |
| Desktop transport/state | apps/desktop/src/ipc/coreClient.ts; model/sync.ts; stores/index.ts |
| Managed session and context | clients/session-dotnet/src/Kreoda.SessionClient/SessionClient.cs and SessionModel.cs |
| Agent canonical catalog | clients/session-dotnet/src/Kreoda.ModelingAgent/AgentCommandCatalog.cs |
| Quest interaction/runtime | clients/quest-unity/Assets/Kreoda/Runtime; existing datum/section/semantic target adapters |

Generated TS/C# files are regenerated from the actual source, never hand-maintained. Discover the concrete managed context/MCP entry points and native enum path before assigning the following task; do not assume nonexistent modules.

## Required behavioral proof

1. Canonical named and integer calls agree on IDs/parameters; malformed definitions, unknown keys, duplicate IDs, wrong source kinds, private labels and exceeded limits fail before mutation. Creation budgeting remains zero for all three commands.
2. A real local native sidecar receives a group mutation through session/MCP, then source edit recomputes the same sketch/solid IDs. Assert native measured geometry and exact persisted relationships, not only a successful response or mocked method invocation.
3. Initial snapshot, ordered incremental sketch update and summary-only Undo/Redo refresh preserve group definitions/status. A reconnect/document switch cannot reuse old display samples or unavailable geometry from a matching feature ID in another document. Out-of-order query replies cannot overwrite newer generation/status.
4. Broken reference status reaches native query, relay, managed context and Desktop/Quest state. Requesting geometry/measurements/export fails with a typed reason. An unrelated healthy branch remains usable. Repair is explicit Set with the same group/sketch/dependent IDs; Undo restores the broken state.
5. Query is read-only: no source binding, revision/history bump or hidden repair. A lost acknowledgement/replay must not create duplicate groups or extra native features.

## Required interaction continuation

Desktop exposes compact operation/source/target controls and explicit repair. Quest exposes the same definitions and persistent source IDs with hands alone: pointing/pinch selection, panel manipulation and controls retain existing controller-free behavior. A projection-only sketch must bypass automatic first-run rectangle initialization. Preserve actual datum frames, section controls, two-hand behavior and voice semantic selection.

Use separate user-authorized GPT-6-Luna/Max implementation tasks under the parent architecture, exact file ownership and applicable verification/review route. Current native packet must be inspected before finalizing ownership and payload fields. No live Hermes, SSH/Tailscale, device/ADB, capture, microphone/camera, PC audio or foreground UI while the user's image-work restriction remains active.

## Gates and limits of proof

Focused RED/GREEN plus canonical/protocol generation checks; meaningful managed TRX discovery with zero failed/skipped; actual local MCP/native edit/Undo proof; hidden native Electron flow; source-stable Quest Editor and normal ARM64 build. Parent independently verifies the accumulated candidate and obtains the required fresh review when available, then exact-head hosted CI. Physical hand/voice/comfort and live Hermes fixtures remain separate open acceptance gates until permitted. No individual green packet completes15.2 or the overall goal.
