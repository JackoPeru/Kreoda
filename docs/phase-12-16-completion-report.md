# Phase 12–16 Completion Report

**Status: software scope implemented and verified on this machine; hardware/live-agent acceptance partially open**
**Software gate: PASS (automated suites + packaged-desktop smoke)**
**Physical/live gate: OPEN — see "Remaining acceptance" below**

This report covers Phase 12 (Quest spatial client foundation), Phase 13 (Quest interaction & MR UX),
Phase 14 (autonomous modeling agent), Phase 15 (advanced CAD) and Phase 16 (intent/generative modeling).
It replaces the earlier interim status in
[`superpowers/evidence/2026-10-17-phase12-16-integrated-status.md`](superpowers/evidence/2026-10-17-phase12-16-integrated-status.md)
and the open-work ledger in
[`superpowers/evidence/2026-11-12-baseline-verification.md`](superpowers/evidence/2026-11-12-baseline-verification.md).

## Verified suites (2026-11-12, current source)

| Suite | Result |
| --- | --- |
| Native Release (OCCT 8.0.1) | **430/430 gtest** (86.4 s) in the worktree build; **433/433 CTest** including the three crash-barrier controls |
| Desktop unit (vitest) | **640/640** across 96 files |
| Protocol / command schema / units / plugin-SDK | **75/75**, **28/28**, **4/4**, **2/2** |
| Managed .NET | **465/465** (SessionClient 197, ModelingAgent 91, HermesBridge 144, Benchmark 33), 0 failed/notExecuted |
| Session contract | `pnpm check:session-contract` exit 0 — 69 DTO schemas regenerated identically |
| Desktop production build | `tsc --noEmit` + renderer/main/preload Vite builds exit 0 |
| Desktop E2E (real Electron + real native kernel) | **93 passed / 0 failed / 2 skipped** (`KREODA_BACKGROUND_TEST=1`, serial, 26.8 min). Skips: `phase10-installed` (disposable-CI-runner only) and `phase10-file-picker` (needs native OS dialogs). |
| [solo] native configurations flow | PASS (17.0 s) — two solids, B-Rep, Undo/Redo, persistence and Desktop requery |
| Crash/recovery gate (`test:e2e:crash:full`, hidden) | **32/32 passed** (6.5 min); `SolverCrashBarrierControl` passed; `PHASE10_CRASH_GATE {"passed":true,"production_core_restored":true}` and the worktree core restored with barriers OFF |
| Phase 14 deterministic native seven-fixture benchmark | **7/7 geometry, 7/7 fully checked, 0 failures** (1.9 min, real MCP → installed native) |
| Installed runtime smoke | PASS — packaged `Kreoda.exe` + kernel `908b7d5b…`; box 40000 mm³ → 4-hole pattern 39434.51332235384 mm³ → Undo → Redo |
| Installed Desktop payload | `app.asar` `a13b0345…` extracted and compared with the current build: **170/170 files byte-identical** (`src` 96/96, `electron` 15/15, `dist` 31/31, `.vite/build` 27/27, `package.json`). No Desktop redeploy was needed; only the native kernel was stale and has been replaced. |
| Quest Unity EditMode suite | **274/274 passed**, 0 failed, 0 skipped (`Unity -batchmode -runTests -testPlatform EditMode` with the current managed plugins and `node` on PATH) |
| Quest ARM64 APK + install | Built `5420c648…` (43,915,653 B, `arm64-v8a`, Unity `Succeeded`, 0 errors, 26 warnings, no source changed), installed with `adb install -r`: data retained (`firstInstallTime` 2026-10-10), `lastUpdateTime` 2026-11-13 00:09:49, signature accepted |
| Quest 3 live session | `KREODA_DISCOVERY peers=1` → `KREODA_CONNECTED`; Desktop box `box-qa-1794525479622` (revision 1) delivered as `KREODA_MESH_APPLIED revision=1` and `KREODA_MODEL objects=1 triangles=12`; TCP `192.168.1.11:44414 → 192.168.1.7:63803` established. Evidence: [`superpowers/evidence/2026-11-13-quest-device`](superpowers/evidence/2026-11-13-quest-device/README.md) |

The native kernel is built from exactly the committed worktree source (verified by hashing all 175 build
inputs against the build tree used for the suite).

## Phase 12 — Quest spatial client foundation

**Implemented.** LAN discovery/pairing/auto-reconnect (`QuestConnection.cs`, `SessionDiscovery.cs`,
`session-discovery.ts`, `session-devices.ts`), canonical mesh streaming with incremental deltas and LOD
(`QuestMeshView.cs`, `SessionMesh.cs`), stereo display and placement (`QuestDisplay.cs`), MR/passthrough Home
(`QuestHome*.cs`), trusted PC project opening with a Desktop consent dialog and single-use opaque IDs, shared
targets with revocation, and per-PC identities that survive port changes.

**Evidence.** `phase12-approved-project-open.spec.ts`, `phase12-shared-target-revocation.spec.ts`,
`agent-automatic-connection.spec.ts`, `quest-automatic-connection.spec.ts`; managed
`SessionDiscoveryTests`, `SessionMeshTests`, `QuestSceneStateTests`; Quest Editor tests in
`clients/quest-unity/Assets/Kreoda/Tests/Editor/QuestConnectionTests.cs`, `QuestWireFixture.mjs`.

**Limits.** Physical headset pairing/discovery and on-device stereo/mesh cadence are hardware acceptance, not
covered by the above. The APK installed on 2026-11-13 (built from the current sources and managed plugins) is the
packet exercised by the live-session row above; the headset was not worn, so hand-driven UI flows remain open.

## Phase 13 — Quest spatial interaction and MR UX

**Implemented.** Hand-ray + index-pinch routing without controllers (`QuestControls.cs`), two-step local
parameter review and intent lock, spatial edit/preview with stale-session fencing (`QuestSpatialEdit.cs`),
exact sketch dimensions (`QuestSketchDimensions.cs`), section plane with signed mm offset (`QuestSection.cs`),
voice capture/stop/resume with session/document/revision context (`QuestVoice.cs`, `QuestVoiceContext.cs`,
`QuestVoiceProposal.cs`), typed command-field validation against the live schema
(`QuestCommandFieldValidationTests.cs`), and the Phase 13 logical workflow probe in managed tests
(`Phase13LogicalWorkflowProbeTests.cs`).

**Evidence.** `phase13-context-session.spec.ts`, `phase13-preview-session.spec.ts`,
`phase13-workflow-session.spec.ts`, plus the Quest Editor suites above.

**Limits.** Hands-only completion of the 14-step physical workflow (real surface pull, numeric keyboard, panel
drag, two-hand scale, voice stop/resume) still requires the headset and the user.

## Phase 14 — Autonomous modeling agent

**Implemented.** Budgeted agent loop, command catalog/allowed read-only query set, typed begin/command/commit/
cancel request flow with one Undo group, B-Rep + numeric goal validation, rollback on `validation_failed`,
durable recovery on `uncertain`, MCP server (`/mcp`) exposing `kreoda_project_context`, `kreoda_describe_model`,
`kreoda_propose_intent`, `kreoda_query`, `kreoda_begin_request`, `kreoda_command`, `kreoda_commit_request`,
`kreoda_cancel_request`, and the frozen seven-fixture benchmark harness.

**Evidence.** Managed suites plus `phase14-generated-native.spec.ts`, `phase14-hermes-mcp.spec.ts`,
`phase14-hermes-benchmark.spec.ts`, `phase14-native-seven-benchmark.spec.ts`; frozen requirements
`docs/superpowers/benchmarks/phase14-requirements.json` (minimum pass 6/7).

**Limits.** The deterministic native seven-fixture benchmark is not an external live Hermes LLM run. A live
6/7 run with the real remote model remains open.

**Unity Editor / Quest packet (2026-11-13).** With the Editor licensed, the full Unity EditMode suite ran:
**274/274 passed, 0 failed, 0 skipped** (after staging the current managed plugins, which were stale, and
putting the Node LTS directory on PATH for the Quest wire fixtures). A fresh ARM64 APK was built from the
current sources (`5420c648…`, 43,915,653 B, `arm64-v8a`, Unity `Succeeded`, 0 errors, 26 warnings, no source
file changed during the build) and installed over the existing app with `adb install -r`, preserving app data.
The installed packet then joined a real Desktop session and received a live delta
(`KREODA_MESH_APPLIED revision=1`, `KREODA_MODEL objects=1 triangles=12`), recorded in
[`superpowers/evidence/2026-11-13-quest-device`](superpowers/evidence/2026-11-13-quest-device/README.md).

## Phase 15 — Advanced CAD

**Implemented.** Datum planes/axes/points with persistent typed definitions and sketch support frames
(`native/kreoda-core/src/features/datum/`), associative sketch projection with repair and broken-source gating
(`sketch_projection.cpp`), advanced sketch geometry (ellipse, elliptical arc, B-spline, trim/extend, mirror,
linear pattern, symmetric constraint, construction geometry), surface bodies/extrude/revolve/loft/sweep/offset/
sew/thicken/trim/extend, section view on both clients, analyses (mass, volume, area, center of mass, draft,
curvature, zebra, minimum thickness, interference), bounded assembly mates (ground, coincident, distance,
concentric, parallel, perpendicular, angle), sparse configurations (Small/Medium/Large without duplicating
geometry), and explicit direct-face history (MoveFace, OffsetFace, DeleteFace, ReplaceFace, imported STEP
outward push / inward pocket).

**Evidence.** Native suites `test_datum`, `test_sketch_projection`, `test_advanced_sketch`, `test_surface_*`,
`test_assembly_constraints`, `test_configurations`, `test_direct_face*`, `test_session_geometry`; Desktop
`phase15-*.spec.ts` including the [solo] native configurations flow; Quest projections/configurations/analysis
panels with Editor tests.

**Limits.** General curved-surface thickening, arbitrary face-to-face mating and a full industrial assembly
solver are not claimed; the implemented operations are the bounded ones above. On-device display of every
Phase 15 flow is hardware acceptance.

## Phase 16 — Intent / generative modeling

**Implemented.** Typed intent proposals (`kreoda_propose_intent`) with canonical commands, rationale and
session/document/revision fences; pattern inference (three authored holes → one reversible pattern in a single
transaction); symmetry inference with explicit acceptance; constraint suggestions; parametric generators
(mounting plate, brackets, enclosure, spacer); design-from-function alternatives (explicit choice, never silent);
Quest-selected geometry/spatial point as intent context (`SpatialVoiceIntent.cs`, `VoiceSelectionContext.cs`);
reference-guided parametric reconstruction with explicit calibration (no automatic pixel detection);
alternative approval with guarded transactional execution (`VoiceCandidateApproval.cs`).

**Evidence.** `GenerativeIntentTests`, `SemanticInferenceTests`, `SketchConstraintSuggestionsTests`,
`ReferenceReconstructionTests`, `CadIntentProposalTests`, `SpatialVoiceIntentTests`,
`VoiceCandidateApprovalTests`; E2E `phase16-brackets-native.spec.ts`, `phase16-enclosure-native.spec.ts`,
`phase16-native-pattern.spec.ts`, `phase16-manual-hole-inference.spec.ts`,
`phase16-symmetric-approval-native.spec.ts`, `phase16-approved-alternative-native.spec.ts`,
`phase16-reference-reconstruction-native.spec.ts`, `phase16-projection-mcp.spec.ts`.

**Limits.** Image line/circle detection (Stage B) and vision-assisted feature proposals (Stage C) are not
implemented; Stage D (editable parametric reconstruction) is implemented only with an explicit calibration
fence. A live Hermes agent proposal accepted on the physical headset remains open.

## Fixes delivered in this session

- **Hole-pattern joined transaction** (`hole.cpp`): a pattern created inside an existing transaction now commits
  exactly one document revision when the OCAF command produced a delta, restoring one-revision/one-Undo
  semantics. Proven with the real installed Bridge proposal on the fixed candidate kernel
  (`PASS_INSTALLED_BRIDGE_PROPOSAL_APPLIED_TO_EXACT_HISTORY_ON_FIXED_NATIVE_CANDIDATE`,
  `conversionUndoGroups: 1`).
- **MCP tool catalog** (`McpProbe`, two E2E specs): the eighth tool `kreoda_propose_intent` is now asserted by
  name, fixing the whole MCP-backed E2E cluster.
- **Headless E2E**: `KREODA_BACKGROUND_TEST=1` runs the whole suite with windows never shown; visual specs use a
  `capturePage` fallback because `page.screenshot` hangs on never-shown windows. Two specs carried CP1252/UTF-8
  mojibake in their "Box 100×50×20" regexes and could never match; repaired.
- **Installed runtime**: verified kernel `908b7d5b…` deployed with a hash-checked rollback copy; packaged
  desktop smoke passed on a hidden isolated profile.

## Remaining acceptance (not software)

1. Physical Quest, with the headset worn: hands-only 14-step Phase 13 flow, panel drag/recenter, numeric
   keyboard, two-hand scale, microphone/voice stop/resume, passthrough/real-surface alignment. The
   "Individuazione della posizione" system dialog must be confirmed once by the user; while the headset was
   off-head it stayed in front of the app and blocked visual capture of the synced box (the mesh delta itself is
   proven by logcat in the 2026-11-13 evidence bundle).
2. Live Hermes: one real remote-agent run of the seven frozen fixtures with ≥6/7 success and recorded
   commands/repairs/timing (the deterministic native baseline is not a substitute).
3. Pristine LAN pairing on a factory-clean headset (no USB provisioning).
4. On-device performance acceptance for the current APK (frame cadence/LOD under the roadmap targets).
5. Any remaining visual sign-off of Phase 15/16 flows on the headset.

Nothing above is claimed as passed by this report.
