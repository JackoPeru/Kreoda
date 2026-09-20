# Phase 6 → Phase 7 handoff

Phase 6 acceptance (§61) is green: context toolbar, view cube, visual
dimensions, select-similar/connected, deterministic intent suggestions,
first-run onboarding — all working offline with no AI, verified by a new
E2E slice plus unit tests.

## Verified Phase 6 results

- Context toolbar (§18, §69): appears on face/edge/sketch selection with
  only registry-valid actions (Pull face, Hole, Sketch here, Similar /
  Round, Corner, Connected, Pull sketch). Availability comes from the
  command registry — the kind→candidate mapping is the only UI table.
- View cube (§23): T/F/R/⌂ presets via `CameraController.setView`
  (axial up-vector handling for top/bottom); direction asserted in E2E.
- Dimension chips (§22): amber DOM chips anchored to face centroids,
  repositioned imperatively every frame (zero React state at pointer/camera
  frequency); click → prompt → same `SetDimension` commit as the panel;
  nodes recycled with per-frame identity refresh.
- Select similar/connected (§16): role-class pairs (`box.+X`↔`box.-X`) and
  endpoint-proximity flood fill on committed overlay buffers; pure functions
  with unit tests.
- IntentEngine (§27, offline-first): equal-holes rule (neighborhood band
  max(0.5 mm, 10%), silence when uniform); suggestion bar with Apply
  (sequential honest commits) / Dismiss persisted in localStorage.
- Onboarding (§56): empty-state card (box/cylinder/sketch/dismiss),
  auto-hide on first model, coaching hint with local dismissal.
- E2E `phase6-ux`: onboard → box → face context bar → top view asserted via
  camera direction → 3 chips with W 100 → two holes (8, 8.4) → suggestion →
  Apply → both ⌀8. 8/8 E2E green.

## Hard-won notes (do not regress)

- All previous notes still apply (see phase-5-handoff appendix).
- Playwright `getByRole(name)` is substring-insensitive: `exact: true`
  wherever buttons share a word; icon-only buttons need `aria-label`
  (accessible name falls back to letter content, not `title`).
- Electron reuses the OS profile: localStorage persists across launches —
  fresh-user E2E must `localStorage.clear()` + reload first.
- View direction sign: looking DOWN is −Z (`target − position`).
- Dimension chips must resolve the owner body from face/edge selections
  too, not just bare ids — otherwise they vanish exactly when the context
  toolbar appears.
- rAF overlay loops must read stores imperatively (`getState`) and recycle
  DOM nodes with per-tick identity refresh; never subscribe inside the loop.

## Appendix: Phase 6 bug-hunt (post-acceptance audit, FIX-FIRST → all fixed)

Per repo policy, a specialized bug-hunt subagent audited Phase 6 after the
acceptance run. Verdict was FIX-FIRST (4 critical + 12 major); every item is
now resolved and re-verified (57 ctest, 9/9 E2E, 25 unit):

- C1 chips used window coords in a container-origin layer → `projectPoint`
  now returns element-relative coords (pointer math keeps `worldToClient`).
- C2 intent grouping sorted by diameter first — same geometry can never
  suggest different targets by creation order again.
- C3 projection checks camera-space depth before the divide (mirrored and
  NaN anchors gone).
- C4 axial presets park epsilon off-pole with +Z up kept (no degenerate
  lookAt on later pan/zoom/frame).
- M1/M2 preset clamp unified with zoom range; drag gain measured at the pan
  target, not the world origin.
- M4 Combine entry in the context bar for two-body selections; M5 pull
  commits mark the hint learned; M6 `viewDir` propagates null when unready.
- M7 chips for Hole/Fillet/Chamfer/Revolve + exact (`endsWith`) anchors;
  M8 onboarding error surface; M9 prompt replaced by an inline chip editor
  (prompt() is unsupported in Electron — found via E2E pageerror) with
  panel-consistent unit parsing; M10 real face-only pick mode; M11 overlay
  loop paused behind the sketch modal; M12 sketch-store subscription.
- Minors: global-sign roleClass, ✕ disabled while applying, intent-test
  localStorage hygiene.
- Tests closed: T1 chip edit (inline editor), T2 Similar click (2 faces),
  T3 all four cube presets with direction asserts (+aria-labels), T4/T5
  dismiss persistence (onboarding reload + suggestion key).
- Deliberately deferred: off-queue fillet search, non-ASCII ids, toolbar
  vertex/sketch filters, qualifier-aware chip anchors for multi-wall bodies.

## Phase 7 entry (§61: natural-language commands)

1. Command bar local parser for deterministic short commands (no LLM).
2. `IntentModelProvider` abstraction + structured tool calls from COMMANDS.
3. Plan validation + visual preview + selected-object context (§28).
4. Acceptance: "100×60×10 plate, four 6 mm holes 8 mm from corners" yields
  an editable feature tree, not a baked mesh.
5. Deferred: shell/mirror/patterns/loft/sweep (still open from Phase 5).
