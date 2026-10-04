# Phase 11: authoritative shared CAD session

Status: IN PROGRESS. Phase 10 accepted by the participant on 2026-10-03.
Baseline: `88a85aabcfdb297164c48273573ee0904bed0941`; implementation branch
`codex/phase11-session-service`. This plan implements the approved roadmap
sections 11.0–11.17 and Slice 7 decision B. It does not redefine acceptance
as a smaller session-relay patch.

## Delivery and ownership

Sol owns architecture, inspected diffs, parent verification and acceptance.
The separate GPT-6-Luna/Max task implements bounded packets in sequence.
Use Caveman for updates and Ponytail for code. Preserve the dirty primary
checkout and the participant's running accepted portable. Runtime checks
use hidden windows, isolated profiles and a separately staged native core.
No merge or publication; push and draft pull requests only.

## Settled design

### Transport and contract

Keep v1 WebSocket JSON control and the existing native stdio transport.
`schemas/session-control-v1.json` owns the network contract. The FlatBuffers
schema continues to own binary meshes. Additive fields and methods retain
valid old clients; generate control DTO/metadata from machine-readable
definitions in the JSON source. Generation must have a reproducible check
which fails on drift. Do not add a parallel REST or CAD implementation.

Reject non-object JSON, invalid request IDs and explicit non-object params
before dispatch. A repeated hello cannot create another socket identity.
Validate typed network fields through the existing command registry before
native dispatch, preserving native validation as the final authority.
Export command parameter JSON schemas from those same Zod definitions;
never maintain another hand-written validator or a custom Zod converter.
An additive named `command` method maps registry IDs to native operations;
legacy integer `invoke` remains compatible but receives the same validation.
Reject unimplemented commands honestly instead of advertising support.
Reject fields which override native envelope identity/type/transaction
metadata. Serialize trusted envelope keys first and filter reserved user
keys. This retains compatibility with older lexical parsers; packet 6a
now reads typed top-level DOM fields. Validate that
fields are an object and numeric revisions are finite nonnegative integers.
Network preview operations use their dedicated lifecycle methods.
The protected prefix also includes the internal transactionId and isPreview
flags before arbitrary nested fields; omitted flags mean empty/false.
Packet 6 also replaces native lexical scalar lookup with top-level typed
JSON lookup using `nlohmann-json` (header-only vcpkg dependency). The current
Boost PropertyTree headers are installed but lose number/string/bool type
information, so they cannot preserve strict numeric validation. Keep the
existing JSON wire and helper interfaces; malformed/non-object payloads
reject before dispatch, nested metadata never becomes envelope metadata,
and quoted numbers remain invalid where strict numeric validation applies.
Add real native regressions for reordered/nested fields and invalid JSON.

### Session, ownership and serialization

Use an actual random session ID for each server/core lifetime, not an ID
derived only from documentId. Report session/document/revision, connected
clients with capabilities and connection state, and current transaction.
Keep camera, hover, UI layout and selection local by default. Publishing
selection/highlights is explicit. Active preview targets and transactions
hold real ownership until commit, cancel or disconnect; conflicting clients
receive BUSY/CONFLICT. One shared serialized mutation entry owns both
Desktop IPC and network calls. Preserve binary return bytes for Desktop.
`setSelection`/`clearSelection` use optional `publish: true` to emit shared
highlight metadata; omitting it changes only that client's selection.
Read-only queries remain read-only and cannot escape transaction fences.
Disconnect must roll back an owned transaction without leaking identities.
Instantiate the shared service even with its network listener disabled;
local IPC must always use the same queue. Reserve overlapping mutation
scopes before enqueueing, not only inside an already serialized job.
During an open transaction, foreign geometry/snapshot queries return BUSY
instead of exposing uncommitted native state under a committed revision.
Metadata-only connection/status/schema queries remain available. The owner
may inspect its working state. A disconnect during a pending begin must
still release or roll back the unit once its native outcome is known.

### Retry identity

Mutation envelopes support an operationId independent of requestId and a
sessionId. The server associates operations with authenticated device,
logical client, session and document. A credential-authenticated logical
client may resume after disconnect but cannot replace a still-live socket.
Check replay before consuming preview/transaction state or stale-revision
guards. Keep one in-flight promise and terminal reply per operation, rebind
only its requestId on replay. Canonicalize payload key order; reuse of an
operationId with a different method or payload returns CONFLICT and never
calls the core. Cover invoke, named commands, previews and transactions.
New clients generate operation IDs and expose explicit replay; no automatic
blind mutation retry. Preserve old requestId retry semantics on a connection.

Retain operation results for the current session/document lifetime without
silent LRU eviction. On core restart or document replacement, invalidate
that session identity and reject replay using its former sessionId with
NEED_FULL_SNAPSHOT. This is network timeout/reconnect idempotency, not an
unsupported claim of exactly-once persistence across core crashes.

### Incremental model changes

Publish baseRevision/newRevision, added and updated feature/sketch/body
entities, removed IDs, changed mesh IDs, reference remaps and warnings.
Keep revision as an additive compatibility alias. Ordinary changes must
not carry complete feature/sketch/body arrays. Compare full semantic
records so an edited parameter on an unchanged tip invalidates its mesh.
Resolve persistent references through the native reference state; do not
invent remaps. Empty remaps are valid only when none changed.

Seed the server baseline from an authoritative snapshot before mutating.
Use a shared delta application helper for clients: patch only on matching
baseRevision/documentId, drop true duplicates and fetch a full snapshot on
a revision gap or lineage switch. Desktop applies the patch through its
existing document/mesh synchronization and preserves camera/selection.
The C# client must expose the same delta fields and recovery semantics.
Full snapshots remain the explicit join/reconnect/recovery mechanism.

New clients advertise `incremental-deltas` in hello capabilities. Desktop
always uses incremental events. For older v1 clients without that capability,
send the former full-list delta as a negotiated compatibility fallback.
New-client runtime acceptance must assert the actual wire event contains no
complete arrays; do not hide a full-list event behind client projections.

The incremental control event uses `added` and `updated` arrays of entity
records `{ kind, id, index, value }`: kind is feature, sketch or body; index
is its position in the authoritative collection, and value is that entity's
semantic record. Identity is the pair (kind, id), since a sketch summary and
its feature may share an ID. `removedIds` removes that ID from every entity
collection. Include `baseRevision`, `newRevision`, compatibility `revision`,
`sessionId`, `documentId`, `originClientId`, `changedMeshIds`,
`referenceRemaps` and `warnings`. No complete current collections or tips
array is present on incremental wire events. The existing FlatBuffers mesh
delta layout stays compatible; these are JSON control entity records.

Compare semantic values and collection positions. Also mark the mutated
feature/sketch and its dependency descendants as affected even if summary
counts and the body tip ID stayed unchanged: changing sketch coordinates
must invalidate the dependent tip mesh. Include displayed Instance meshes
whose source was affected. Baseline capture happens before native mutation,
inside the serialized queue; transaction begin captures the committed
baseline before its first joined step, and only its terminal result emits.
If a legacy local notification arrives without a known committed baseline,
send an explicit snapshot-required event and seed from the current snapshot;
do not invent a base revision. Packet 8 removes that bypass.

Client application is serialized, including snapshot recovery. Drop only
duplicates for the same session/document with newRevision at or below the
current revision; a lineage switch always requires a snapshot. A gap fetches
the authoritative snapshot and resumes from it. A pure shared TypeScript
helper validates and patches model entities; Desktop preserves unaffected
mesh buffers and hydrates only changed/new visible IDs, pruning obsolete
meshes and selections. Mirror the semantics in C#, with a typed model state
and recovery outside its WebSocket receive loop so replies remain routable.
Desktop recovery uses a local session snapshot IPC entry, not a loopback
socket dependency. Keep async delta application and recovery in one ordered
chain with epoch/revision guards. Existing `CadViewport.syncMeshes` rebuilds
geometry for every supplied buffer; cache the original immutable core mesh
object in its body entry and skip unchanged objects before building geometry
or BVH. Verify unaffected geometry identity and disposal as well as buffer
identity. This preserves the incremental performance benefit in the scene.
C# serializes outgoing WebSocket sends, negotiates incremental support and
maintains model recovery in a separate ordered task queue; never await a
snapshot reply inside the receive loop which must route that reply.

### Semantic geometry and machine API

Keep semantic snapshot projections for document, history and dependencies.
Count visible body tips for total volume; never sum intermediate features.
Resolve body IDs to their tip and history for body-scoped queries.
For document material volume, use the same current solids/occurrences as
`CollectSolidsCompound` in the exchange pipeline. Include displayed linked
instances once per occurrence and report that aggregate basis; it is a sum
of part volumes, not the volume of a boolean union of overlapping parts.
Add a native read-only session query command, using the next unused wire
type, for geometric metadata, measurement and B-Rep/reference validation.
The next unused native type is 30 (`RequestSessionQuery`): method plus
featureId/bodyId or persistent a/b references, JSON result in the existing
native response envelope. Include it in the read-only transaction policy
and the schema enum/bindings; do not change any existing numeric wire ID.
Reuse persistent face/edge resolution and existing OCCT functions:
minimum shape distance, surface/volume properties, bounding boxes,
analytic radii/axes and BRepCheck validation. No raw B-Rep serialization.
Angles require suitable geometric directions and reject ambiguous cases;
do not silently describe centroid distance as minimum distance or mesh
area as an exact B-Rep measurement.

Face/edge/body searches return all qualifying persistent candidates with
confidence, description, owner and geometric summary. Support surface or
curve type, role, owner, orientation/normal/axis, approximate dimensions
and radius with explicit numeric tolerance. Invalid filters reject.
Unsupported or ambiguous geometry returns a structured error/candidate
set rather than choosing an arbitrary face/edge. Manipulator metadata is
computed server-side using actual sketch/face placement and native axes;
the Quest client consumes it without duplicating feature geometry rules.
Implement validateReferences and getCommandSchema now, not in Phase 14.

### LAN pairing

Default to loopback. An explicit LAN listener may bind only an address
actually assigned to an intended local private interface. Reject wildcard,
public, multicast and unresolved arbitrary hosts. Do not change firewall,
router/NAT rules or expose a public endpoint.

Desktop offers session connection settings, Pair Device and trusted-device
revocation. Pairing uses a short-lived one-use high-entropy token, explicitly
started by the local user. Exchange it for a per-device credential stored in
the Desktop user-data directory with atomic writes and restrictive access.
Store only a credential digest on the server; persist trusted identity and
name. A fresh session binds authentication to its current session token.
Revocation closes that device's sockets and removes its credential; replay
of a consumed/expired pairing token fails. Existing environment token is
an explicit test/developer bootstrap path, not the production device store.
No credentials in logs, screenshots, evidence or committed files.

Pairing wire sequence is settled: pre-auth `pair` exchanges the one-use
pairing token for a random 256-bit device credential and a random token for
that device in the current server session. Persist only SHA-256 credential
digests; compare with timingSafeEqual. A returning device uses pre-auth
`authenticate` with its deviceId and credential to obtain its current
per-session token; `hello` then requires deviceId plus that session token.
Authentication cannot create a connected client identity. Revoked device
authentication fails, all its sockets close, and a new server lifetime
rotates all session tokens. The high-entropy pairing token expires after
five minutes or its first successful exchange. Do not replace it with an
unprotected six-digit code. Default local-only mode needs no token display
or listener. The local connection panel owns enabling, pairing and revoking.

## Implementation packets

1. Malformed-frame boundary guards and raw WebSocket regression.
   Parent rerun: 134 workspace tests, Desktop typecheck/build, diff check PASS.
   Commit: `6b1f8cf`.
2. Single hello identity, transaction ownership and disconnect rollback.
   Parent rerun: 138 workspace tests, Desktop typecheck/build, diff check PASS.
   Includes disconnect during native begin, hostile envelope fields and
   blocked raw native transaction controls. Commit: `397c89e`.
   Follow-up native probe found fields-first serialization can dispatch a
   nested type instead of the requested type. Parent corrected its earlier
   ordering specification; correction is required in packet 3.
3. Operation identity, replay across reconnect, preview/transaction retry.
   Parent rerun: 152 workspace tests (129 Desktop, 17 protocol, 2 SDK,
   4 units), 25 .NET tests, Desktop typecheck/build, protocol build and diff
   check PASS. Real OCCT probe: concurrent CreateBox and reconnect replay
   execute one native create, consumed preview commit executes once, repeated
   transaction begin executes once; final one feature has volume 72000 mm3.
   The isolated native PID exited; loaded source hashes remained unchanged.
   Evidence: `docs/evidence/phase11-operation-replay-local-2026-10-03.json`.
   This is packet-level headless evidence, not full Desktop acceptance.
4. Incremental deltas and Desktop/C# revision-gap recovery.
   Packet 4a: parent fallback completed after the Luna task stopped with its
   usage limit. Server emits negotiated incremental entity patches; the
   shared TypeScript helper preserves ordering and untouched object identity.
   Parent rerun: 164 workspace tests, 25 .NET tests, Desktop typecheck/build
   PASS. Real OCCT/three-WebSocket probe passes 15 checks, including equal-count
   sketch edits, dependent Extrude/Instance invalidation and Undo snapshot
   agreement. Native PID exited. Evidence:
   `docs/evidence/phase11-incremental-local-2026-10-04.json`.
   Packet 4b: Desktop applies patches through one ordered recovery/hydration
   chain and local snapshot IPC. Only changed/new visible meshes hydrate;
   unchanged buffers, geometry/BVH, camera and valid selections stay intact.
   C# negotiates incremental events, maintains a typed model, serializes sends
   and recovers outside its receive loop. The local service exists without a
   listener; a foreign transaction blocks local snapshot recovery.
   Parent rerun: 173 workspace tests, 31 .NET tests, Desktop typecheck/build,
   .NET probe build (zero warnings/errors) PASS. Hidden Electron/real OCCT
   verifies remote edit, actual geometry identity, camera/selection and one
   lost-event recovery with zero GUI input. Compiled C#/real OCCT verifies
   eight runtime checks, including Undo and lost-event snapshot agreement.
   Source hashes stayed fixed, instrumented main was restored, owned PIDs
   exited. Evidence: `docs/evidence/phase11-incremental-clients-local-2026-10-04.json`.
   Unified Desktop mutation ownership remains packet 8. Phase 11 is incomplete.
5. Typed commands and generated control contract conformance.
   Packet 5a: named commands and legacy integer invokes share the canonical
   parameter registry and native adapter. Seventeen implemented commands
   export their real JSON parameter schemas through zod-to-json-schema.
   Generated creation identity is replayed once; invalid parameters, binary
   mesh control calls and malformed previews are rejected before native
   dispatch. Native sketch drag hints and valid field aliases are preserved.
   Parent rerun: 186 workspace tests, 32 .NET tests, workspace build/typecheck
   PASS. Real OCCT/WebSocket probe verifies eleven checks, including named
   existing-parameter edit, Undo restoration and dependency-free deletion.
   Source hashes stayed fixed and owned native PID exited. Evidence:
   `docs/evidence/phase11-typed-commands-local-2026-10-04.json`.
   Packet 5b: the same JSON Schema source generates nineteen control/model DTO
   schemas, TypeScript/C# metadata and standalone Ajv validators. quicktype
   generates types; esbuild bundles standard validator helpers ahead of time,
   preserving renderer CSP. C# helpers serialize generated request DTOs and
   decode generated model DTOs while preserving raw semantic entity content.
   Required-field metadata rejects incomplete patches; ordering/conflict and
   lineage checks remain in the model applicator. CI has a generation drift
   gate. Parent rerun: 188 workspace tests, 33 .NET tests, workspace build and
   compiled probe build (zero warnings/errors) PASS. Hidden Desktop and real
   C# gap-recovery probes PASS; real OCCT snapshots, constrained sketches and
   deltas validate against the generated schemas. Deliberately corrupted
   generated output is rejected; restoration and positive drift check PASS.
   Evidence: `docs/evidence/phase11-generated-contract-local-2026-10-04.json`.
   Phase 11 remains incomplete; hosted CI/final review are later gates.
6. Native semantic geometry, accurate measurements/reference validation.
   Packet 6a: nlohmann-json DOM reads only typed top-level fields; nested
   metadata cannot replace request/transaction identities. Typed sketch
   parsing rejects scalar coercion, malformed arrays and wrong field types.
   Five new regressions failed before implementation and pass now. Full
   real OCCT native suite: 146/146 PASS. Old Windows-path fixtures were
   corrected to serialize valid JSON; all persistence/torture assertions
   remain. New isolated native build passes sixteen real Sidecar/WebSocket
   checks, including mutation replay, parameter edit and Undo. Owned PID
   exited; source and binary hashes recorded. Evidence:
   `docs/evidence/phase11-typed-native-json-local-2026-10-04.json`.
   Packet 6b: native read-only query 30 projects exact OCCT minimum distance,
   surface/volume properties, analytic directions/radii and bounding boxes.
   Total material volume uses current body tips and displayed instances.
   Persistent searches return semantic descriptors and flag duplicate roles;
   measurements reject ambiguous references/radii. Selection validates actual
   native references. BRepCheck, solid presence, dependency and authored
   support-reference checks cover document/body/feature validity. Native
   manipulators use actual sketch frames, hole centers and degree-based
   instance placement. No client-side triangle/centroid measure remains.
   Parent rerun: 156 native tests, 191 workspace tests, 33 .NET tests,
   workspace build/typecheck and generation drift check PASS. Fifteen real
   OCCT/Sidecar/WebSocket checks PASS; native PID exited, source/binary hashes
   fixed. Evidence: `docs/evidence/phase11-native-geometry-local-2026-10-04.json`.
   Phase 11 remains incomplete; LAN and unified ownership are next packets.
7. LAN pairing, trusted devices, revocation and local interface guards.
   Packet 7: trusted device pairing/authentication now precedes hello. Tokens
   are single-use for five minutes; stored credentials are digests protected
   by owner-only Windows DACLs (0700/0600 on Unix). Session tokens rotate with
   listener lifetime. Explicit interfaces permit loopback or assigned RFC1918
   IPv4 only; public/wildcard/unassigned hosts fail before bind. Revocation
   persists before closing device sockets and rejecting queued device edits.
   Desktop More menu exposes narrow IPC controls for enable/disable, pairing,
   trusted-device status and revoke; closing the panel cancels pairing.
   Disabling transport preserves the local CAD lineage and processes remote
   transaction cleanup. Environment bootstrap tokens are development-only.
   Generated contract contains 23 DTO schemas; C# SDK supports pairing and
   returning-device authentication. Parent rerun: 204 workspace tests,
   35 .NET tests, workspace build/typecheck, final Electron build and contract
   drift PASS. Eleven actual native/compiled-C#/WebSocket/DACL checks PASS
   on this host's assigned private Ethernet interface. Owned PIDs exited.
   Evidence: `docs/evidence/phase11-device-pairing-local-2026-10-04.json`.
   This is same-host private-interface evidence, not a remote Quest test.
   Phase 11 remains incomplete; unified Desktop mutation ownership is next.
8. Unified Desktop mutation entry and active-edit ownership.
   Packet 8: Desktop framed IPC now enters the same SessionRelay queue as
   network commands. The notification/direct-sidecar bypass is removed;
   original binary mesh response bytes are preserved. Overlapping scopes
   reserve ownership before enqueueing and include dependency descendants.
   Preview targets remain owned through commit/cancel/disconnect. Foreign
   snapshot/geometry calls cannot observe an active or pending transaction;
   owner working-state and metadata remain available. Renderer loss cancels
   previews, rejects queued old-renderer edits and rolls back owned units.
   Create/Open rotate session lineage even for the same document ID and
   invalidate old replay; negotiated clients receive recovery events.
   Selection remains private until publish:true, including foreign lookups.
   Generated getSessionInfo reports document/session/revision, clients with
   capabilities/connection state and pending/open transaction ownership.
   Parent rerun: 212 workspace tests, 36 .NET tests, workspace build/typecheck
   and generated drift gate PASS. Fourteen actual OCCT/local-framed/two-client
   checks PASS; owned native PID exited and hashes fixed. Evidence:
   `docs/evidence/phase11-unified-session-local-2026-10-04.json`.
   Phase 11 remains incomplete; hidden Desktop acceptance is next.
9. Real native, Desktop and second-client acceptance with no GUI input.
   Packet 9: all ten roadmap actions pass against actual hidden Electron,
   the current OCCT core and production device pairing. Desktop opens a saved
   two-body ICAD file; the paired client edits an existing dimension; Desktop
   applies the patch and performs Undo through its framed IPC; the network
   client receives Undo, agrees on revision, reconnects using its credential
   and rejects invalid/stale commands without changing the model. Unchanged
   geometry identity, camera and selection are retained. Generated metadata,
   compiled C# pairing/edit/Undo/reconnect and device revocation also pass.
   The acceptance found competing Open synchronization: local Open/recovery
   now await the authoritative renderer queue, including hydration errors,
   instead of resetting a second epoch after its event. The regression failed
   before this correction and passes afterward. Fourteen focused unit tests,
   Desktop typecheck/build and the compiled probe build (zero warnings/errors)
   PASS. Two hidden integration scenarios PASS with zero mouse/keyboard input;
   source hashes fixed, original compiled main restored, owned PIDs exited.
   Evidence: `docs/evidence/phase11-desktop-network-acceptance-local-2026-10-04.json`.
   Private Ethernet clients run on this host; no remote Quest/Unity claim.
   Phase 11 remains incomplete pending the full regression/CI/review gates.
10. Exact hosted CI, evidence report, fresh Sol review, primary safe copy.
   In progress: full local rerun passes 213 workspace and 36 .NET tests;
   actual OCCT rerun passes 156/156. Initial ordinary hidden cohort at 16f53e3:
   49 passed, four failed, two skipped. Three large-mesh Open failures exposed
   lost session identity after local view drift invalidated the cached model.
   The queue now retains lineage separately; its new regression fails before
   the correction and passes afterward. The fourth failure was an obsolete
   query expectation (structural instead of the implemented native kernel
   validation scope). The full cohort is being rerun; no completion claim.
   Second full ordinary attempt at a44589c: 50 passed, three failed, two
   skipped. The initial native snapshot can itself lose the local view race
   before any cached baseline exists. The queue now learns that first native
   session identity even when it correctly discards the stale view reply.
   The new regression is RED before/GREEN after, and the actual 100k-triangle
   saved-file/parameter/Open/orbit/pick test passes. Full rerun follows.
   Full ordinary cohort at 8531a46: 53 passed, two intentionally skipped
   locally (native dialog and installed executable); hosted coverage remains
   required. Workspace rerun: 215 tests PASS. Crash cohort: 28 passed, one
   failed during renderer termination in STEP Open. A queued GetCoreInfo
   incorrectly inherited the old document lineage; the recovered renderer
   therefore stayed offline. Engine metadata now retains queue order and
   renderer generation checks without document/transaction ownership fences.
   Deterministic regression RED before/GREEN after, 44 relay tests and all
   216 workspace tests PASS. Actual focused STEP crash and full 29-case crash
   cohort PASS after correction. No timeout or retry-to-green changes.
   At ca8e988, local gates pass: 216 workspace, 36 .NET, 156 native,
   ordinary 53 passed/two local-only skips, crash 29 passed, production
   portable nine checks with unchanged payloads. Fresh Sol review returned
   fix-first: unsupported Desktop isPreview commands bypassed mutation
   ownership, and preview actions could commit an outdated value or report
   cancellation while a prior commit applied. Three deterministic regressions
   fail before correction and pass after it; preview actions now serialize
   per preview, preserving the existing shared native queue.
   Hosted ca8e988 run 37196940208 failed (ordinary 54 passed/one failed;
   crash not reached). The MSVC environment's Platform=x64 moved the compiled
   C# probe under bin/x64; the workflow now explicitly builds it as AnyCPU.
   The prior local evidence remains historical; new full gates and a fresh
   final review are required after these corrections.

## Required verification gates

Every packet leaves meaningful RED/GREEN regressions where behavior changes.
Parent inspects the actual owned diff and reruns focused verification.
Final gates: workspace tests/typecheck/build; real OCCT native tests; C#
client tests and generation drift checks; ordinary and crash cohorts;
production portable/runtime provenance and no leaked processes.

The Phase 11 acceptance artifact records all ten roadmap actions with real
core and Desktop renderer state: open a saved document, second client joins,
full snapshot, edit an existing parameter, Desktop applies incremental
delta, Desktop Undo through the same mutation path, second-client delta,
matching revisions, disconnect/reconnect, invalid and stale rejection.
Drive APIs only: no clicks, typing, keyboard shortcuts or fabricated mock
acceptance. Run hidden with an isolated profile. Separate loopback evidence
from an actual private-interface connection; neither proves a remote Quest
device was tested. Add retry-loss, duplicate-operation, conflict ownership,
pair/revoke, delta-gap recovery and exact native-query checks.

Record source commit, native/ASAR hashes, actual command counts and any
unexecuted check. Fresh Sol reviews the whole inspected Phase 11 diff after
parent verification. Phase 11 remains IN PROGRESS until every required gate
passes. Then continue the approved Quest phases; do not mark the original
all-phases goal complete after this phase alone.

## Primary references

Command-schema conversion uses the installed Zod v3 schemas with the
[maintainer's converter](https://github.com/StefanTerdell/zod-to-json-schema),
not a broad Zod migration. Native distance and validity use the official
[OCCT distance API](https://www.occt3d.com/dev/doc/refman/html/class_b_rep_extrema___dist_shape_shape.html)
and [BRepCheck API](https://occt3d.com/dev/doc/refman/html/class_b_rep_check___analyzer.html).
Boost documents the [PropertyTree parser's scalar type loss](https://www.boost.org/latest/doc/html/doxygen/namespaceboost_1_1property__tree_1_1json__parser_1aa8344dc0b7987cba89b0630195d7a34d.html),
which prevents its use as the typed native request parser.
