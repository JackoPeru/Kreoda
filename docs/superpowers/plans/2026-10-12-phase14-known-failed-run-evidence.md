# Known failed Hermes run evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let the benchmark inspect events for unsuccessful voice turns whose native Hermes run identity is actually known.

**Architecture:** Preserve a validated run ID in existing exception metadata after the gateway has received it. Add the optional ID to existing proxy error JSON, parse it into a read-only SDK error property, and reuse the current metadata reader in the benchmark. Do not change planning, submission, cancellation, stop, CAD rollback, deadlines or status codes.

**Tech Stack:** Existing .NET8 bridge, .NET8/netstandard2.1 QuestFoundation SDK, System.Text.Json and xUnit. No dependency additions.

**Spec:** Frozen Phase14 invariant to retain failures/commands in `docs/superpowers/benchmarks/phase14-requirements.json`; failed-turn event gap documented in `docs/HERMES_BENCHMARK.md`.

## Global Constraints

- Full Phase12–16 goal persists. This packet improves known failed-turn evidence only; full command arguments, aborted HTTP receipts and seven live fixtures remain pending.
- User's Hermes is creating images. Use local fake gateway/HTTP/session fixtures only; no real run, remote mutation, model reload, restart, Quest action or audio capture/playback.
- Frozen requirement content/hash unchanged. Keep all runner reports `accepted=false`.
- Preserve exception types, cancellation tokens, the existing two-argument `VoiceServiceException(int,string)` constructor, status codes, cleanup and ownership fences.
- Never fabricate a run ID from voiceRequestId/sessionId or resubmit a failed mutating turn. Lost submission acknowledgement before a known ID remains explicitly unknown.
- IDs are optional ASCII `[A-Za-z0-9_.-]`, length1–128. Never return private gateway credentials/URLs, full arbitrary exception.Data or reasoning.
- No increase/reset of the 180s work/deadline budgets. Client-aborted HTTP may have no delivered ID; do not claim its trail is available.

## Review Focus

- Failure after native acceptance retains the same validated run ID and original exception type; no new submission.
- Cancellation after a known run still stops the same run with the original cancellation semantics; metadata does not turn cancellation into success.
- Lost acknowledgement before any known ID carries no fabricated identity and no claim of server stop.
- Malformed/missing error IDs are ignored safely by both SDK targets while preserving status/message behavior.
- CAD-unfinished error after a completed reply may expose that known reply ID; uncertain rollback identity/fences must retain priority.

### Task 1: Retain known failure identity through the existing voice path

**Files:**

- Modify `clients/session-dotnet/tools/Kreoda.HermesBridge/HermesGatewayClient.cs`.
- Modify `clients/session-dotnet/tools/Kreoda.HermesBridge/BridgeHost.cs`.
- Modify/test `clients/session-dotnet/tests/Kreoda.HermesBridge.Tests/HermesGatewayTests.cs` and `VoiceHttpTests.cs`.
- Modify `clients/session-dotnet/src/Kreoda.QuestFoundation/HermesVoiceClient.cs`.
- Modify/test `clients/session-dotnet/tests/Kreoda.SessionClient.Tests/HermesVoiceClientTests.cs`.
- Modify `clients/session-dotnet/tools/Kreoda.ModelingAgent.Benchmark/Program.cs`.
- Modify `scripts/run-dotnet-tests.mjs` only to raise genuine new suite/total counts.

**Interfaces:** Use one internal exception.Data key `kreoda.hermes.runId`, populated only after `RequiredId` has validated a real native run. Existing error JSON gains optional `runId`. `VoiceServiceException` gains nullable read-only `RunId` without removing its current constructor; SDK parsing validates the ID. Benchmark report/metadata reader use either completed reply ID or delivered error ID, retaining the failed outcome.

- [x] Add gateway tests for native failed/cancelled status after acceptance, known cancellation preserving OperationCanceledException, and unknown submission cancellation retaining no ID; preserve existing stop/submission assertions.
- [x] Add local proxy/SDK tests for known error ID, missing/malformed ID, unchanged status/message, and unfinished CAD reply identity if supported by the existing session fixture.
- [x] Observe new assertions fail before implementation; test both actual SDK targets where the existing harness supports them.
- [x] Attach only the validated known ID to the original exception; rethrow rather than replace it. Expose only that sanitized field in appropriate existing proxy error responses. Keep rollback failure priority, no changes to CadBridge.
- [x] Parse the optional field into SDK errors, retaining binary/source constructor compatibility. Share the ID validation within each applicable file; use netstandard2.1-compatible APIs.
- [x] Benchmark uses a known delivered failure ID for `RunMetadata.Read`, preserving error/failed predicates and `accepted=false`. It must not fabricate identity for transport abort or unknown receipt.
- [x] Run relevant gateway/proxy/SDK tests, full managed runner under Platform=x64, actual SDK target coverage and existing hidden native E2E. No external Hermes service required.
- [x] Parent inspects diff, verifies independently, freezes sources, obtains fresh Sol6/high review, then records/commits/pushes accepted packet. Exact new-head CI remains a separate gate.

## Remaining work

Complete command arguments and evidence for aborted/lost-ack turns, seven real Hermes fixture acceptance, actual editability/request Undo/DesktopQuest mesh observation, physical hands/voice and full Phases15–16. Do not represent this bounded fix as full failure-trail or goal completion.
