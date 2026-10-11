# Phase 14: Hermes CAD MCP and Quest voice

User steering11October supersedes the raw local-model/replacement-agent design. Hermes retains native planning, memory, tools and policy. Full Phases12–16 goal remains active; Phase13 physical acceptance remains unproven. Separate GPT6Luna/max task hit terminal quota; root implementation fallback explicitly authorized. Fresh actualSol6/high review remains required for acceptance.

## Architecture and requirements

- Official MCP C# SDK bridge exposes authoritative PC SessionClient and canonical runtime command schemas. No parallel CAD kernel or command registry.
- Seven tools and project resource provide context outside the Quest UI. Hermes server registers native kreoda-agent route and persistent Kreoda skill/context.
- Read current metadata and semantic IDs; capture immutable numeric checks before mutation; build, inspect, measure, validate and correct. Native commands create editable features and one Undo group.
- Limits:64 actions,32createdfeatures,16observable CAD command attempts,3corrections,180s. Native Hermes route separately bounds16modeliterations. Monotonic deadlines and shared voice correction budgets cannot reset.
- Stale session/document/revision, invalid B-Rep, failed measures or exhausted budgets cannot report success. Uncertain commit reconciles the same operation ID. Cancellation rolls back owned uncommitted CAD. Unknown server run after canceled lost-submit ACK is explicitly unproven, never falsely reported stopped.
- Quest on-demand Parla/Invia uses existing resident STT→actualHermes→TTS via private PC voice proxy. Stop/focus/tracking/pause cancels mic, HTTP, queued replies and owned playback. No always-on capture.
- Hermes key stays PC-private; headset gets separate voice token. CAD/voice provisioning requires Android DUMP-protected alias, force-stop before bootstrap, saved app-private credentials thereafter. ADB setup automatic, no headset screenshots or manual user setup.
- Hidden PC companion preserves existing user model/profile/accepted UX. No merge/public release without required gates.

## Implementation evidence

- [x] Bounded helpers33, bridge20, managed125 eachactualtarget, JS276, lint/drift0.
- [x] Actual officialMCP→Electron/OCCT box proof and oneDesktopUndo.
- [x] Unity45; normalARM64 protectedAPK installed; nativePC reports agent+Questconnected.
- [x] Actual nativeHermes model/context response and6.065s synthetic STT→Hermes→TTS, conversation continuity.
- [ ] Persistent memory confirmation and real agent mutation/measurement proof.
- [ ] Fresh completed Sol6/high corrected review (prior reviewer terminalquota).
- [ ] Physical Quest mic/button/playback comfort evidence; do not infer from synthetic server tests.

### Task 3: Permanent measured benchmark and multi-client proof

**Files:** `clients/session-dotnet/tools/Kreoda.ModelingAgent.Benchmark/`, permanent prompt/requirement fixtures, existing Desktop session E2E harness and new agent integration tests.

- [ ] Freeze seven prompts: centered-hole plate, U bracket, six-hole flange, hollow box, chamfered shaft, enclosure and mounting plate. Define independent dimensions/hole counts/volume/placement/editability predicates before live runs.
- [ ] Execute real local-model runs on isolated actual OCCT documents; record all attempts, durations, commands, repairs and failed predicates. At least6/7 must meet the≥80% gate; do not omit failures or substitute scripted plans.
- [ ] Check valid editable B-Rep and actual semantic references; mutate a resulting parameter, preserve identity and verify one shared Undo group.
- [ ] Prove Desktop observes the actual latest revision; prove Quest receives updated native mesh using autonomous USB/credential reconnect when available. No synthetic physical usability claim.
- [ ] Run relevant native/managed/JS/schema/lint/Unity gates, exact hosted head and fresh actual Sol6/high review with source-before/after manifests. Mark Phase14 only when all required predicates and boundaries are satisfied; retain Phases15–16 and Phase13 physical acceptance openly.
