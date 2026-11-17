# Phase 12 Packet 2 — Implementation report

**Status:** Complete for Packet 2. This does not complete Phase 12.

**Objective:** Deliver native FlatBuffers body-tip mesh data from the Desktop session relay to managed clients with typed identity, freshness fences, bounded transport, and validation before geometry allocation.

## Changes

- Added `requestMeshLOD`, `binary-mesh-v1`, and the typed mesh identity header to the canonical session-control schema and generated TS/C# contract outputs.
- The relay validates the session, document, revision, body root, visible tip, and quality through the existing ordered read queue. It forwards the exact native `MeshUpdate` bytes. It sends the JSON header and raw binary frame before releasing that queue and rejects a peer whose outbound buffer would exceed 64 MiB.
- The managed client negotiates binary mesh support, registers the outer request before sending and records the native request ID synchronously from the validated JSON header before completing that request, assembles fragmented binary messages, and completes or fails correlated operations on cancellation, malformed replies, lineage changes, or disconnect.
- Added structural and semantic validation for frame sizes, FlatBuffers tables and vectors, finite geometry, indices, bounds, and non-overlapping face/edge spans before large geometry arrays are allocated. Optional absent edge-vertex vectors decode as empty when there are no edge ranges. The result retains normals, edges, semantic IDs, and spans, and exposes the exact raw-frame SHA-256.
- Kept `Kreoda.SessionProbe`'s Phase 11 native recovery probe as its default mode with the original `TOKEN`/`INSTANCE` inputs and eight assertions. The mesh proof is a separate `KREODA_SESSION_PROBE_MESH=1` mode used explicitly by the E2E test.
- Added regression coverage for capability negotiation, ordered header/binary issuance, distinct clients and IDs, stale/transaction fences, fragmented frames, cancellation, malformed and oversized frames, and all three mesh qualities. Added the real mesh hashes and lengths to [mesh-frames.json](mesh-frames.json).

## Verified

- `node scripts/generate-session-contract.mjs --check` — verified all 5 generated artifacts against schema source hash `d5804785c2840e6cec157bd09648cda36f56ced3cbd1128f352a99352e18d16e`.
- `pnpm --filter @kreoda/protocol exec vitest run src/codegen.test.ts src/session-control.test.ts` — 30 passed, including pre-allocation rejection and the omitted optional edge-vector case.
- `pnpm --filter @kreoda/desktop exec vitest run tests/session-relay.test.ts tests/session-bodies.test.ts` — 59 passed.
- `dotnet test clients/session-dotnet/tests/Kreoda.SessionClient.Tests/Kreoda.SessionClient.Tests.csproj -c Release -p:KreodaManagedTargetFramework=netstandard2.1 --no-restore` — 50 passed, 0 failed.
- `dotnet build clients/session-dotnet/probes/Kreoda.SessionProbe/Kreoda.SessionProbe.csproj -c Release --no-restore` — succeeded with 0 warnings and 0 errors.
- `dotnet build clients/session-dotnet/Kreoda.Session.sln -c Release` — succeeded with 0 warnings and 0 errors.
- `pnpm lint` — all workspace projects passed.
- `pnpm build` — all workspace builds passed. Vite emitted its existing advisory for a renderer chunk over 500 kB.
- Final ordinary hidden cohort: `python (Join-Path $env:TEMP 'kreoda-phase11-hidden-cohort.py') ordinary 'unified session: saved document, paired client, existing edit, Desktop undo, reconnect and rejects without GUI input'` — 1 E2E passed. It exercised 16 Desktop/client checks and 4 real mesh checks against Desktop, the compiled C# client, and native OCCT 8.0.1. The probe returned six raw frames, all three LODs, the untouched second body, a one-body edit, Undo, credential reconnect, and rejection of the old revision. No GUI input was used.
- Runner restoration was verified: `.vite/build/main.cjs` SHA-256 `3d29990e6382b1733806942a503b132cd0a32a7f63b6d42073e636b2e402770e`; native core SHA-256 `80d7120494a298ab4ce74a5f6790bf94a8d4dab920b5bb79bafc259eb06ee99c`.
- `git diff --check` passed; only Git line-ending normalization notices were emitted.

## Judgment calls

- Retained the tested managed dependency graph: System.Text.Json 8.0.6 and Google.FlatBuffers 25.2.10. The package audit reported no known vulnerable resolved packages. Moving to the available 10.x System.Text.Json line would change runtime assets without improving this compatibility packet; the current graph is the one exercised with the actual Unity ARM64 IL2CPP fixture in Packet 1.
- Binary delivery is opt-in through the negotiated `binary-mesh-v1` capability; clients without it retain existing JSON behavior.
- The endpoint resolves persistent CAD body roots to visible body tips. Instance-level mesh queries are outside this packet; the evidence makes no all-object or Quest-scene completeness claim.

## Gaps

- This packet was not pushed, so no hosted CI result exists for its final commit.
- Unity scene integration, Quest APK, and Quest 3 hardware acceptance belong to Packets 3–5 and remain unverified. No app was installed on the headset.
- The hidden E2E harness and its complete runtime JSON remain in the local Codex tools directory; this report and the sanitized six-frame evidence are committed with the packet.
