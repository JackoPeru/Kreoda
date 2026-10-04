# Phase 12 Quest Foundation Implementation Plan

> For agentic workers: use superpowers:executing-plans, packet by packet. User authorizes Luna/Max delivery through a separate Codex task; root continues when Luna quota is exhausted. Fresh Sol/High review follows parent verification.

**Goal:** Quest 3 joins the existing Desktop CAD session, renders its actual model, places it in passthrough, selects persistent geometry and follows Desktop edits/reconnects without file transfer.

**Architecture:** Preserve the approved JSON control plus FlatBuffers mesh protocol. The PC owns geometry and revisions. Reuse the generated C# session client as precompiled .NET Standard 2.1 assemblies; Unity owns display transforms, rendering, XR input and local preferences. Network work never runs on Unity's frame loop.

**Tech stack:** Unity 6000.3.25f1, Android ARM64 IL2CPP, installed JDK 17.0.18+8 and NDK 27.2.12479018. Stable official registry versions verified 2026-10-04: OpenXR 1.18.0, Meta XR Core/Interaction/MR Utility Kit 207.0.0, Unity Meta OpenXR 2.6.1. Import only packages required by each packet; verify actual compatibility through batch builds before claiming readiness.

**Spec:** Approved INTENT_CAD_REVISED_ROADMAP_DESKTOP_QUEST_AGENT.md sections 12.0–12.12 and docs/SESSION_PROTOCOL_DECISION.md (decision B).

## Constraints

- Finish Phase 11 gates against its fixed source before modifying its implementation for Phase 12.
- Preserve accepted desktop UX, dirty primary checkout, credentials and existing SDK configuration.
- Hidden commands and isolated profiles; show no Unity Editor windows. Personal activation is authorized and verified.
- Blank toolchain APK proves only compiler readiness; never install it on the headset as the product.
- Quest performs no B-Rep work. Persistent body, feature, face and edge IDs come from the core.
- Keep three mesh LODs: preview=0, interactive=1, inspection=2.
- Display scale and world placement never send a CAD mutation. CAD millimeters convert to Unity meters once (0.001).
- Credentials stay outside logs and source. Pair once; reconnect using device credentials. Listener remains explicitly enabled on an assigned private interface.
- Generated DTO/binding edits go through their canonical schemas/generators.
- No merge or public release authorization. Hardware acceptance remains pending until actually performed.

## Review focus

1. A delayed mesh from an old document/session/revision must never replace current geometry.
2. Changed tip identity must update the same persistent body object and dispose superseded Unity resources; unrelated bodies retain their objects.
3. Coordinate handedness and winding changes must preserve triangle-to-face and edge-to-reference mapping.
4. Disconnect, permission denial or passthrough unavailability must leave a usable reconnect/VR path.
5. Rendering, head tracking and basic local selection must remain responsive during slow network/geometry operations.

## Packet 1 — Shared managed client runs in Unity's runtime

**Files:** packages/protocol/csharp/Kreoda.Protocol.csproj; clients/session-dotnet/src/{Kreoda.SessionClient,Kreoda.QuestFoundation} projects and compatibility helpers; scripts/build-quest-managed.mjs; existing .NET tests.

- [ ] Build current libraries targeting netstandard2.1 to capture exact incompatibilities before changing them.
- [ ] Multi-target net8.0/netstandard2.1. Resolve unsupported runtime APIs with standard equivalents, preserving cancellation, immutable capabilities, number validation and disposal semantics.
- [ ] Pin serviced compatible System.Text.Json/FlatBuffers packages. Stage dependency DLLs from MSBuild assets, not guessed filenames. Avoid framework DLLs that Unity supplies.
- [ ] Add managed-plugin import configuration and explicit IL2CPP preservation for generated DTOs and JSON converters.
- [ ] Run existing .NET tests plus cancellation/serialization checks against the compatibility output. Compile an owned Unity fixture with these actual DLLs, then ARM64 IL2CPP. No network/Quest claim from an empty scene.
- [ ] Commit verified packet with hashes, pinned package versions and actual compiler outcome.

## Packet 2 — Real binary mesh delivery over the session

**Files:** schemas/session-control-v1.json; generated contract outputs; apps/desktop/electron/session.ts; protocol mesh validators; shared SessionClient mesh transport/decoder; relay/.NET/integration tests.

- [ ] Add typed RequestMeshLOD/body-tip request and capability. Validate quality, session lineage, revision, body ownership and pending transaction fences in the existing ordered read queue.
- [ ] Forward actual native FlatBuffers MeshUpdate bytes. Correlate native request ID to the outer request in a typed JSON header delivered before the binary frame. Register correlation synchronously in the receive loop, before completing any task, so fast binary arrival cannot be lost.
- [ ] Header records session/document/revision/body/tip/quality. Fail both JSON and binary pending operations on disconnect, cancellation and malformed replies; bound payload sizes. Never emit base64 geometry in JSON.
- [ ] Verify FlatBuffers structure, vector/index/range bounds and finite coordinates before allocation/upload. Preserve normals, edge polylines, face spans and semantic IDs.
- [ ] Test fragmented binary receipt, simultaneous request IDs on different clients, stale delivery, malformed frames, all three LODs, cancellation and a core error without a binary response.
- [ ] Real OCCT/Desktop + compiled C# proof: two bodies, request meshes, edit one existing feature, re-request only its changed body, Undo, reconnect and reject old lineage.
- [ ] Commit generated contract and exact raw-byte/source evidence.

## Packet 3 — Unity CAD scene and connection UI

**Files:** clients/quest-unity project (Packages, ProjectSettings, Assets/Kreoda/Runtime, Editor build script, tests); shared QuestFoundation scene state as needed.

- [ ] Create reproducible Unity project/build CLI with pinned stable packages, ARM64 IL2CPP and required network manifest permissions.
- [ ] Compact spatial connection panel accepts PC endpoint + single-use pairing code, then stores device credential locally; auto reconnects paired PC and reports actual connection state.
- [ ] Subscribe to model snapshots/deltas on background tasks; enqueue Unity changes on the main thread. Coalesce mesh requests per current body tip/revision and discard stale completions.
- [ ] Build shaded Unity Mesh objects, edge overlay, face/edge highlight and transparent preview style. Keep persistent mapping independent of GameObject/array indexes. Destroy replaced meshes and materials on removal/replacement/shutdown.
- [ ] Set display root to convert right-handed CAD Z-up mm to Unity world meters with correct winding/normals and unchanged semantic triangle spans.
- [ ] Implement local ray/controller selection, optional publish target, body/face/edge lookup and readable model status. Phase 13 owns modeling gestures.
- [ ] Editor tests use real shared decoder fixtures and scene diffs; actual Editor/IL2CPP builds verify plugin loading and no duplicate runtime assemblies.
- [ ] Commit verified client packet.

## Packet 4 — MR placement, display controls and performance

**Files:** Quest runtime placement/environment/preferences/metrics; minimal Meta SDK configuration; XR build validation.

- [ ] Configure real OpenXR loader and OVRCameraRig/OVRManager passthrough. Transparent camera + underlay; neutral VR workspace fallback. Verify required native library/manifest assets in built APK.
- [ ] Place, reposition, rotate and recenter display root; table placement can use controller/ray placement first. Persist local session anchor and display preference separately from CAD state.
- [ ] Add 1:10, 1:5, 1:1, 2:1, 10:1 and Fit display scales. Assert native CAD dimensions/revision unchanged across these controls.
- [ ] Retain local dominant-hand, UI-handedness, panel and passthrough settings. No network waits in Update/hand/head response.
- [ ] Track frame time/FPS, RTT, mesh latency, preview latency, memory and triangles; expose a small optional diagnostics view. LOD budget downgrade and inspection request use the server API.
- [ ] Hidden batch validation and ARM64 APK build. Record exact source, package lock, native plugins, APK hash and untested hardware boundaries.
- [ ] Commit verified MR packet and request headset connection only when this actual client APK is ready.

## Packet 5 — Actual Quest 3 acceptance and final gates

- [ ] User connects Quest 3 with developer mode; adb device authorized. Install only the actual CAD client APK and launch it.
- [ ] With saved CAD open on PC: pair, render same model, walk around in MR, place on table, switch display scale, select persistent body/face, optionally publish target, change existing parameter on Desktop, observe incremental update, disconnect/reconnect to current model.
- [ ] Record app logs/performance and user observations. Screenshots only if authorized/needed; do not infer comfort, passthrough or physical placement from headless tests.
- [ ] Verify existing Desktop ordinary/crash cohorts, native/.NET/JS gates, Unity tests, production APK dependencies, no leaked owned processes and exact hosted source result.
- [ ] Fresh Sol/High read-only review of inspected accumulated diff, hash freeze before/after. Fix-first requires correction and a new reviewer.
- [ ] Preserve hardware limitations honestly; Phase 12 complete only when all required acceptance actions pass. Continue Phase 13 spatial modeling UX.
