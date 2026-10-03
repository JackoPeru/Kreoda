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

### Session, ownership and serialization

Use an actual random session ID for each server/core lifetime, not an ID
derived only from documentId. Report session/document/revision, connected
clients with capabilities and connection state, and current transaction.
Keep camera, hover, UI layout and selection local by default. Publishing
selection/highlights is explicit. Active preview targets and transactions
hold real ownership until commit, cancel or disconnect; conflicting clients
receive BUSY/CONFLICT. One shared serialized mutation entry owns both
Desktop IPC and network calls. Preserve binary return bytes for Desktop.
Read-only queries remain read-only and cannot escape transaction fences.
Disconnect must roll back an owned transaction without leaking identities.

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

### Semantic geometry and machine API

Keep semantic snapshot projections for document, history and dependencies.
Count visible body tips for total volume; never sum intermediate features.
Resolve body IDs to their tip and history for body-scoped queries.
Add a native read-only session query command, using the next unused wire
type, for geometric metadata, measurement and B-Rep/reference validation.
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
3. Operation identity, replay across reconnect, preview/transaction retry.
4. Incremental deltas and Desktop/C# revision-gap recovery.
5. Typed commands and generated control contract conformance.
6. Native semantic geometry, accurate measurements/reference validation.
7. LAN pairing, trusted devices, revocation and local interface guards.
8. Unified Desktop mutation entry and active-edit ownership.
9. Real native, Desktop and second-client acceptance with no GUI input.
10. Exact hosted CI, evidence report, fresh Sol review, primary safe copy.

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
