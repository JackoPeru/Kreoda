# Phase 5 → Phase 6 handoff

Phase 5 acceptance (§61) is green: boolean union/cut/common, parametric
holes, fillets, chamfers — every operation an editable feature with explicit
diagnostic states and no silent corruption. Scenario A (§62) runs end to end
in the UI: 100×50×10 block + 8 mm hole, undo, reopen identical.

## Verified Phase 5 results

- Booleans (`boolean.cpp`): fuse/cut/common of two solids via
  `BRepAlgoAPI_*`, empty-result guard, `refExtra` carries `op=<name>`,
  multi-input DAG deps; rebuild re-resolves both inputs with "vanished
  input (needs repair)" errors. Fuse 100×50×20 + 40³ = exactly 132000.
- Hole (`hole.cpp`): cylinder tool positioned in the persistent face plane
  frame, cut from the target; throughAll drills past both sides, blind cuts
  depthMm; ⌀8 through 10 mm plate = exactly 100000 − π·16·10; face role
  re-resolves on rebuild (target resize keeps the hole); vanished/non-planar
  faces are explicit repair errors; **miss guard**: a tool removing nothing
  fails loudly instead of a silent no-op.
- Fillet/chamfer (`fillet.cpp`): `BRepFilletAPI_MakeFillet/Chamfer` over
  resolved persistent edges; oversize radii binary-search a safe range and
  report "Maximum stable value appears to be approximately X mm" (§41);
  cross-feature edge ids rejected; rebuild re-resolves all edges.
- Refs: `ShapeRecord.refExtra` (hole face/pos/mode, fillet edge list,
  boolean op) persisted via OCAF `@ref=` and served in `shape_body`/
  `feature_list`; `SetDimension` edits diameter/depth/radius/distance with
  DAG recompute; previews work for all dress-up types.
- IPC 19–22 + fbs tables + zod + registry (hole/fillet/chamfer gated on
  face/edge selection, boolean on 2 bodies) + `executeCommand` cases.
- UI: hole dialog (diameter, through/blind, face-center default), dress-up
  dialog (multi-edge, single-solid guard), boolean Combine/Subtract/Overlap
  buttons, properties slots, tree names with deps, `makeHole` test hook.
- 10 native `Solids` tests + 5 registry tests; E2E `phase5-hole` (dialog box
  → typed hole → exact volume → undo → redo → reopen identical). 53 ctest,
  7/7 E2E.

## Hard-won notes (do not regress)

- All previous notes still apply (lazy `Build()`, one TNaming evolution per
  builder, includes before namespace, `Location()` getter, stable zustand
  selectors, LineSegments index/2, dist-rebuilds, `gp_Circ` not handle,
  SketchStore-first dispatch, solved-coords display, `dependsOn` to store,
  `exact:true` role selectors).
- OCCT edge role adjacency is SORTED (`box.+X~box.+Z`, never `+Z~+X`).
- `BRepFilletAPI_*` lives in **TKFillet** (link!) — missing lib = 7 LNK2019s.
- `gp_Dir` has no unary-minus constructor from `gp_XYZ`; use `.Reversed()`.
- `ostringstream` default precision is 6 sig figs: kernel volumes
  (99999.99999999997) need `setprecision(17)` or tests assert on rounded
  ghosts — and old substring tests must become numeric `ExtractVolume`
  comparisons.
- Anonymous-namespace hygiene: exposing a builder means moving it out of
  `namespace{}` AND deleting the old closing brace — a stray `}` silently
  closes `intentcad` and cascades into nonsense errors.
- Fillet/chamfer `Add()` takes `(value, edge)`; `MakeRevol`-style `Build()`
  before `IsDone()` applies to dress-ups too.

## Appendix: Phase 5 bug-hunt (post-acceptance audit, FIX-FIRST → all fixed)

Per repo policy, a specialized bug-hunt subagent audited Phase 5 after the
acceptance run. Verdict was FIX-FIRST (2 must-fix + 6 recommended); every
item is now resolved and re-verified (57 ctest, 7/7 E2E, both self-tests):

- C1 empty booleans: cut-to-nothing / disjoint-common now fail honestly
  (faceless-or-zero-volume guard) instead of committing fake bodies.
- C2 malformed `edgeIds` crash: length guard + whitespace/dedupe hardening.
- M1 miss-guard is now tool-relative (micro-holes in giant parts pass).
- M2 full `setprecision(17)` in OCAF `EncodeParams` + hole `refExtra`;
  exposed a real kernel truth in passing (GProp box volume is
  99999.99999999997 — substring tests converted to numeric comparisons).
- M3 `FailsafeRadius` probe budget capped at 12 (granularity break dominates).
- M4 shared `ValidFeatureId` (`[A-Za-z0-9_-]`) enforced at every create
  entry (solids, sketches, booleans, holes, dress-ups).
- M5 hole-on-extrude frame divergence proven empirically (prism cap origin
  is the face center, box cap is the corner) → new `kRequestFaceInfo`
  returning the world plane frame; dialog maps centroid through it; C++
  test uses the real frame instead of reverse-engineered coords.
- M6 edge ids reject `|`/`,`.
- UI minors: blind-depth slot hidden for throughAll (index-safe mapping),
  face added to the selection filter, target→tool chips, blind hint text.
- Tests added: cut-to-empty/disjoint-common, hole-on-extrude via real
  frame, chamfer rebuild-after-resize, hole+fillet save/open with refExtra
  assertions, blind-hole E2E step, dialog widget tests (hole submit +
  safe-range message).
- Deliberately deferred: shell/mirror/patterns/loft/sweep (Phase 6+),
  `kDeleteFeature` (still unhandled by design — no delete UX yet),
  Face-filter E2E for fillet (C++ + dialog-unit covered), off-queue
  fillet search (documented cap instead).

## Phase 6 entry (§61: beginner interaction layer)

1. Face pull for extrude/hole features (manipulator metadata → handles).
2. Context toolbar (face → pull/hole/sketch; edge → fillet/chamfer).
3. View cube + select-similar + align/center suggestions.
4. `flatc` codegen from `schemas/cad_protocol.fbs` (C++ + TS together).
5. Deferred from Phase 5 scope: shell, mirror, patterns, loft, sweep.
