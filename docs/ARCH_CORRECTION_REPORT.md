# Architecture Correction Completion Report (Slices 1–8)

Final regression + docs slice. Tree: `main` at Slice 7 (`71968d4`) plus
~30 foreign uncommitted UI-track files (untouched, unstaged, unreverted).

## CI

- Workflow `.github/workflows/ci-windows.yml` runs: `pnpm -r lint`,
  `pnpm -r test`, vcpkg OCCT 8.0.1 configure, native build, self-test +
  ctest, `dotnet test`, desktop build, FULL `playwright test`.
- Status: **LOCAL PASS** (scoped, see Tests) vs **GITHUB ACTIONS
  UNOBSERVED** — CI runs cannot be observed from this environment (§16).
- CI caveat: the CI E2E step runs the unfiltered suite, so it will hit the
  same 3 failures documented below (2 foreign strict-mode violations + 1
  pre-existing golden-A gap) until the UI track lands and golden A is fixed.

## Native

- `cmake --build native/kreoda-core/build --config Release`: PASS
  (kreoda-core.exe + kreoda-core-tests.exe; 2 benign MSB8028 warnings).
- `./Release/kreoda-core.exe --self-test`: PASS ("kreoda-core self-test OK").
- Canonical runner `scripts/run-native-tests.mjs`: **117/117 PASS**.
- `ctest -C Release`: **117/117 PASS**.
- Real OCCT kernel linked (OCCT DLLs beside the exe); stub core requires
  explicit `-DKREODA_ALLOW_STUB_CORE=ON` (`native/kreoda-core/CMakeLists.txt:14,45-51`).

## Body/Feature

- Final rule: Body = ordered feature history + tip (`tip == history.back()`);
  only the tip renders. Documented in `KREODA_ARCHITECTURE_AND_BUILD_SPEC.md`
  §10 and `INTENT_…_ROADMAP…md` §2.1 (Slice 8 insertions).
- Native `BodyStore` (`native/kreoda-core/src/model/body.{h,cpp}`),
  renderer mirror `buildBodies` (`apps/desktop/src/stores/index.ts:57-88`),
  tip-only scene map + mesh pruning (`stores/index.ts:218-236`,
  `src/model/sync.ts:63-104`).
- Stale comment (src, out of scope, not touched):
  `native/kreoda-core/src/protocol/mesh_fb.cpp:21` ("bodies are 1:1 features").

## Hole Pattern

- Final rule: one user-level pattern = ONE cumulative `HolePattern` record
  advancing the target body (one Undo step; tip = base minus ALL tools).
  Native `CreateHolePatternFeature` (`src/features/hole/hole.cpp:322-409`),
  suites `HolePattern.*` (4) + `Bodies.HolePatternIsOneBodyOneUndo` green.
- Slice 8 updated `apps/desktop/e2e/phase7-nl.spec.ts:55-64`: `bodies 5 → 2`,
  `Hole×4 → HolePattern×1`, cumulative volume
  `60000 − 4·π·9·10`. E2E PASS.
- Foreign overlap in the same file (base for this edit is the current tree):
  import-line `openProject` + one `await openProject(window)` call (lines 7, 43).

## Session Protocol

- Decision B (Slice 7, unchanged by Slice 8): JSON control plane +
  FlatBuffers mesh data plane, `protocolVersion = 1`.
- Sources of truth: `schemas/session-control-v1.json` (40 methods, v1),
  `schemas/cad_protocol.fbs` (binary mesh); mirrors
  `packages/protocol/src/session-control.ts` ↔
  `clients/session-dotnet/src/Kreoda.SessionClient/SessionControl.cs`,
  pinned by conformance tests both sides (16 protocol vitests incl.
  `session-control.test.ts:2`, 21 dotnet tests incl.
  `SessionControlContractTests`).
- Decision record: `docs/SESSION_PROTOCOL_DECISION.md`.
- Slice 8 fixed the contradicting spec line: `KREODA_…_SPEC.md` §8
  ("FlatBuffer payload" everywhere → JSON envelopes, FlatBuffers mesh only).

## Session Service

- Electron relay + TS/C# clients green: `session-relay.test.ts` (8),
  `session-bodies.test.ts` Slice 6 G (3), phase11 E2E (3/3 PASS), dotnet 21/21.
- Body-aware deltas (tip-change names the body; undo names disappeared ids).

## Quest foundation

- `clients/session-dotnet/src/Kreoda.QuestFoundation` builds Release (in
  `Kreoda.Session.sln`); `QuestFoundationTests` green inside dotnet 21/21.
- No Unity started — foundation build + tests only.
- Relationship (unchanged, re-asserted in docs): Quest is a session client of
  the authoritative core, never a second CAD implementation (roadmap §2.2).

## Tests

| Suite | Result |
|---|---|
| `pnpm -r exec tsc --noEmit` (whole tree) | PASS, 0 errors |
| desktop vitest | 17 files / 69 tests PASS |
| plugin-sdk vitest | 1 file / 2 tests PASS |
| units vitest | 2 files / 4 tests PASS (src+dist mirror) |
| protocol vitest | 3 files / 16 tests PASS |
| native build + self-test | PASS |
| `run-native-tests.mjs` | 117/117 PASS |
| `ctest -C Release` | 117/117 PASS |
| `dotnet test …/Kreoda.Session.sln -c Release` | 21/21 PASS |
| Electron `build` | PASS (pre-existing chunk/dynamic-import warnings) |
| E2E phase7-nl (Slice-8 edit) | 1/1 PASS |
| E2E phase9 expr/plugins/ref | 3/3 PASS |
| E2E phase9-assemblies | 0/1 FAIL — FOREIGN |
| E2E phase10-golden A | 0/1 FAIL — PRE-EXISTING (proven at HEAD, see Regressions) |
| E2E phase10-golden B | 0/1 FAIL — FOREIGN |
| E2E phase10-golden C | 1/1 PASS |
| E2E phase10-crash + phase8-crash-bundle | 2/2 PASS |
| E2E phase11-session | 3/3 PASS |
| E2E phase10-perf | 1/1 PASS (env OK; boot 6745ms, box 252ms, 21-body avg 118ms/max 135ms, save 38ms, reopen 124ms, STEP export 96ms/340456B) |

## Known limitations

1. Golden A pre-existing gap (see Regressions): `CreateHolesCorners`
   reads `meshes[selectedBody]` (`provider.ts:572-577`) but Slice-4
   tips-only hydration drops non-tip ancestor meshes; branching a pattern
   from a non-tip box fails honestly with "Body mesh not loaded yet".
   Proposed fix (reviewer to schedule, src change deliberately NOT made in
   Slice 8): resolve the owning body's tip mesh (or on-demand pull the
   ancestor mesh) when the selection names a historical feature.
2. `mesh_fb.cpp:21` stale "1:1" comment; E2E `Snapshot.bodies` field name
   actually carries the feature list (history + projection in
   `treeBodies`/`tips`). Naming only; behavior correct.
3. Foreign UI track active during this slice (new files appeared mid-run:
   `selectionAnchor.ts`, `context-toolbar.spec.ts`, `DimensionChips.tsx`
   edit). Its `openMore` helper + duplicate "More" button break 2 archived
   specs; owned by the UI track, not this slice.

## Regressions

- phase9-assemblies + golden B: `getByRole("button", {name:"More"})`
  strict-mode violation — 2 matches: foreign `workspace-topdock` button
  (`apps/desktop/src/components/workspace/*`, untracked) vs "More actions".
  Evidence: `apps/desktop/e2e/helpers.ts:90` (foreign-added `openMore`) +
  `phase9-assemblies.spec.ts:48` / `phase10-golden.spec.ts:339` (foreign-added
  `openMore` calls). FOREIGN. No spec weakened, no foreign file edited.
- Golden A: byte-identical failure reproduced at clean HEAD `71968d4` in an
  isolated worktree (no foreign files, no Slice-8 changes; HEAD spec line 81
  ≡ tree line 83, 2-line shift = foreign `openProject` insert):
  `Stopped after 0 steps: Step 1 (CreateHolesCorners): Body mesh not loaded
  yet`. Causal chain is 100% committed code (`ObjectTree.tsx`,
  `provider.ts:480-493,572-577`, `stores/index.ts:218-236`,
  `sync.ts:63-104`, `execute.ts:67-81`; drawer hosts the same `ObjectTree`
  per `WorkspaceChrome.tsx:9,170`). PRE-EXISTING, not foreign, not Slice-8.
  Worktree removed after the check.

## Files/formats migrated

- Slice 8: `apps/desktop/e2e/phase7-nl.spec.ts` (HolePattern assertions);
  `README.md`, `KREODA_ARCHITECTURE_AND_BUILD_SPEC.md`,
  `INTENT_CAD_REVISED_ROADMAP_DESKTOP_QUEST_AGENT.md` (surgical insertions
  only); new `docs/ARCH_CORRECTION_REPORT.md` (this file). No src, no schema,
  no format migration (cumulative: Body/tip model, HolePattern record,
  `.icad` manifest bodies section, decision-B session contract — Slices 1–7).

## Ready YES/NO + blockers

- Arch-correction track: **YES** — Body/Feature, tip semantics, history,
  cumulative HolePattern, decision-B session contract (TS/C# pinned),
  real-kernel release rule, and Quest-client relationship are implemented,
  tested (native 117/117, dotnet 21/21, vitest 91 total, relevant E2E green
  except as attributed), and documented.
- Release/E2E-green: **NO** — blockers: (1) pre-existing golden-A mesh gap
  (fix proposal above); (2) foreign UI-track strict-mode `openMore`
  ambiguity in 2 archived specs (UI-track owner). GitHub Actions status
  unobserved from here.
