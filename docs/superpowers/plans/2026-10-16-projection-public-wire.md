# Projection public wire and generated DTO packet

Required continuation of the projection-groups contract and contract-client handoff. Native base 6483a1040a82424f51933bba95944732bc0c7941 has parent independent 275 passing tests; final accumulated review failed on quota without a verdict. User-authorized continuation does not accept that base. Preserve all subsequent relay, managed context, Desktop, hands-only Quest, physical/live, review and hosted gates.

## Exact contract decisions

IDs36/37/38 and fields are those in the projection-groups contract. Set and Remove return the ordinary authoritative feature/sketch summary and revision; optional projection query data may accompany them. Request returns `projection:{featureId,plane,groups}` plus `documentId` and `revision`. `plane` reuses SketchPlaneFrame exactly (`origin`, xAxis, yAxis, normal), in world CAD mm. Missing requested sketch/group is NOT_FOUND. Invalid fields are BAD_PARAMS. Failed native mutation is PROJECTION_FAILED. No query-side rebind, store update, revision or history change.

Each query group includes existing public inspection fields groupId, definition, sourceFeatureIds, status, error, blockingSourceIds, generation, plus `edges`. Each display edge has memberIndex (zero-based, evaluation-local), curveType (native descriptive type), firstParameter, lastParameter, closed and pointsMm (world positions). Closed curves include both trim endpoints. Lines use two points; other finite trimmed curves use 129 uniformly spaced parameter samples. These are display approximations with no CAD tolerance guarantee; native edges remain authoritative for profiles. Apply native edge location exactly once. Broken/unavailable groups expose no stale edges. Never create persistent output IDs. A malformed/nonfinite display curve returns an explicit query error rather than partial healthy geometry. Bound each edge to129 points and whole sketch to existing2000 edges; never truncate silently. This is at most258000 points, within native256MiB frame ceiling; no additional lower metadata aggregate cap is introduced.

Public Set definitions mirror the native validator, including UTF-8 byte limit65536, exact source kinds, owner-qualified IDs, duplicates and unknown/private field rejection. Canonical named/integer calls agree and creation.fixedCount is zero. Ordinary native request envelope keys (protocolVersion/documentId/requestId/type/transactionId) remain permitted; unknown projection argument keys fail. Native has no expectedRevision envelope semantics: reject that key rather than silently ignore it. Ordinary revision fencing remains relay baseRevision; the following session query checks expectedRevision inside orderedRead without forwarding it natively. Native transaction fence recognizes38 as read-only and36/37 as joined mutations. Existing lifecycle APIs own atomicity and binding.

Shared schema adds strict projection source/definition/summary/display/result DTOs; nested SketchDescriptor projectionGroups; optional geometryCurrent/status/error/blockingSourceIds on affected descriptors. Unavailable measured volume stays absent. Regenerate TS/C# and FlatBuffers from their real sources, never hand-edit generated files. Preserve legacy group-free descriptors. This packet adds contracts/native dispatch only: it must not claim session relay/runtime adoption.

Parent draft audit amendment: projection result also carries geometryCurrent/status/error/blockingSourceIds from the common native GetGeometryAvailability walk. A cached group.status=ok does not prove its source/support closure is current. When the whole target is unavailable, retain inspectable group definitions/status but return no display edges for any group, without rebind/recompute/store writes. Prove both an ordinary broken group and a cached-ok group whose support/source closure is unavailable. This closes the newly exposed display boundary using the existing availability API.

## Worker ownership

- native/kreoda-core/src/protocol/dispatcher.h and dispatcher.cpp; native/kreoda-core/src/features/sketch/sketch_projection.h/.cpp for read-only serialization helper; native/kreoda-core/tests/test_sketch_projection.cpp and test_codegen.cpp as needed.
- schemas/cad_protocol.fbs, schemas/session-control-v1.json; packages/protocol/src/index.ts, session-control.ts, new sketch-projection.ts; relevant protocol tests; generated outputs from existing generators.
- packages/command-schema/src/index.ts, native-command.ts only if necessary, canonical tests.
- clients/session-dotnet/src/Kreoda.SessionClient/Generated/SessionDtos.g.cs and SessionMethods.g.cs ONLY generator output, not managed runtime.
- clients/session-dotnet/tests/Kreoda.SessionClient.Tests/SessionControlContractTests.cs if needed for meaningful generated DTO round-trip proof.
- focused new evidence under docs/superpowers/evidence/2026-10-16-projection-public-wire. No other product paths without parent amendment.

## Execution and proof

Separate GPT-6-Luna/Max implementation task; no nested tasks/agents, commits or pushes. Root owns architecture, evidence audit and independent verification. Worker is not alone; preserve other changes. Hidden local processes only; no Hermes/SSH/Tailscale/AI server, physical Quest/ADB, audio/mic/camera or foreground GUI.

1. Add meaningful RED tests: actual dispatcher36/37/38, same stable IDs and measured downstream source-edit result; query read-only; transaction owner/failure rollback; Undo/save/open; broken query has zero stale edges and useful status; tilted/translated curved source display endpoints/frame; reject private fields/unknown args/UTF-8 overflow; named/integer parity and zero allocation; generated schema broken/healthy compatibility.
2. Implement using current native lifecycle APIs and inspection serializer, without reimplementing source binding or evaluator/profile geometry.
3. Generate both protocols. Run focused tests then complete native suite on existing isolated real OCCT build, core self-test, protocol/schema suites plus build/lint and deterministic generated checks. Compile managed generated DTOs and run meaningful contract tests. Preserve exact discovery/results and source hashes. No GUI E2E in this packet.
4. Parent independently checks implementation and tests before commit; later fresh accumulated review is still required. Relay/session runtime, display freshness, managed/MCP real sidecar, Desktop and Quest controls remain next required packets.

Transport discovery: current managed/relay control ceiling4MiB is below legal projection metadata/display size. This packet must not claim session compatibility or silently lower native limits. The next runtime packet raises the shared control envelope64MiB with bounded receive and boundary/worst-case tests, as recorded in the session preflight. Native256MiB frame remains unchanged here.
