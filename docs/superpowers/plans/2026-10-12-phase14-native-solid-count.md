# Native single-solid benchmark proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the benchmark gap where one native body can contain several B-Rep solids.

**Architecture:** Add an integer `solidCount` to the existing authoritative `getBoundingBox` native result, counting the actual selected or complete displayed shape with OCCT `TopExp_Explorer(TopAbs_SOLID)`. Require exactly one in the independent benchmark evaluator. Reuse the current registry, query, MCP and body-tip/instance scope; do not create a parallel CAD implementation.

**Tech Stack:** Existing OCCT8.0.1/C++17, GTest, .NET8/System.Text.Json/xUnit, official MCP C# SDK2.2.0.

**Spec:** Frozen seven-fixture invariants in `docs/superpowers/benchmarks/phase14-requirements.json`; incomplete single-solid evidence described in `docs/HERMES_BENCHMARK.md`.

## Global Constraints

- Full Phase12–16 goal remains active. This packet proves one measurement capability, not seven live fixture acceptance.
- Frozen requirement bytes/SHA256 must stay unchanged: `78f72a3026a93c7ccf2102f29ab943b71c8c19b12e89007681cafd31a93af24a`.
- Additive query result only: existing bbox, volume, basis and modelScope retain semantics. No new command or protocol version.
- No model mutation during analysis; old feature history is excluded and displayed instances included exactly as `scopedShape` already defines.
- Keep `accepted=false` until command arguments, failed-turn command trail, editability, shared Undo and client observation are actually verified.
- User's Hermes is busy creating images. No live agent request, model reload, gateway restart or server mutation. All checks local and PC windows hidden at construction.
- Reuse the isolated worktree. Preserve concurrent E2E worker changes. Root owns documentation and final acceptance; implementation worker must not commit/push.

## Review Focus

- A single body tip with a disconnected two-solid imported compound must count2 and fail the fixture predicate.
- A displayed instance must increment complete-model count; old body history must not increment it.
- Selected-entity queries must count only their actual shape; face/edge scope has no solid and must not silently become1.
- Missing, fractional, zero or extra count rejects geometry instead of accepting body metadata as proof.
- Native SDK/MCP routing must preserve the new field; synthetic evaluator fixtures never count as live Hermes passes.

### Task 1: Native count and benchmark rejection

**Files:**

- Modify `native/kreoda-core/src/protocol/session_geometry.cpp`: getBoundingBox branch in `RunSessionGeometryQuery`.
- Modify/test `native/kreoda-core/tests/test_session_geometry.cpp`.
- Modify `clients/session-dotnet/tools/Kreoda.ModelingAgent.Benchmark/GeometryCheck.cs`.
- Modify/test `clients/session-dotnet/tests/Kreoda.ModelingAgent.Benchmark.Tests/GeometryCheckTests.cs`.
- Modify `clients/session-dotnet/probes/Kreoda.McpProbe/Program.cs` to assert the new field through the actual official MCP path.
- Modify `scripts/run-dotnet-tests.mjs` only to raise benchmark suite/total minimum after new tests exist.

**Interfaces:** `getBoundingBox` result gains `solidCount: nonnegative integer`; evaluator adds failed predicate `one-brep-solid`. Native primitives, query scope, transactions and existing assertions remain authoritative.

- [ ] Write native assertions: one primitive=1; box→hole old history excluded; displayed instance whole-model=2/selected-instance=1; one body with its tip replaced by a two-solid compound=2.
- [ ] Build `cmake --build native/kreoda-core/build --config Release --target kreoda-core kreoda-core-tests`, then run `native/kreoda-core/build/tests/Release/kreoda-core-tests.exe --gtest_filter=SessionGeometry.*`. Observe new-field assertions fail before implementation; do not rely on an old binary.
- [ ] Write managed rejection cases for missing/fractional/zero/2 solidCount with otherwise valid measured geometry. Update analytic positive test doubles to count1; they remain labelled synthetic.
- [ ] Run benchmark xUnit project and observe the new rejection tests fail before evaluator enforcement.
- [ ] Count actual OCCT solid occurrences in the existing getBoundingBox branch; require integer1 in GeometryCheck. Do not infer count from body collection or triangle count.
- [ ] Extend the actual MCP native probe to query complete-model bbox and assert count1 for its created solid.
- [ ] Rebuild native targets; run full native tests and the full managed runner (with environment Platform=x64), plus targeted actual MCP/benchmark boundary E2E after the current hidden-renderer correction. No forced clicks, timeout increases or skipped gates.
- [ ] Parent independently inspects diff, reruns relevant checks, freezes source inputs, obtains fresh Sol6/high review, then records/commits/pushes accepted packet. Exact hosted head remains a separate required gate.

## Remaining work after this packet

Seven real Hermes fixtures and complete metadata including failed/interrupted turns, actual parameter edit preserving identity, one shared request Undo, Desktop/Quest latest mesh proof, physical hands/voice acceptance, and full Phases15–16. Do not shrink the goal to these tests.
