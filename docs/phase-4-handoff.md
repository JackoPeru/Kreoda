# Phase 4 → Phase 5 handoff

Phase 4 acceptance (§61) is green: a first-time tester can create a
dimensioned plate with holes — here the vertical slice: sketch a 100×50
rectangle with H/V + 2 distance constraints, extrude 20, get exactly 100000;
edit the width dimension → downstream solid recomputes to 150000 in one Undo
step; save → reopen returns the identical sketch + solid.

## Verified Phase 4 results

- PlaneGCS vendored (`src/constraints/planegcs/`, LGPL-2.1-or-later, isolated
  `planegcs` static lib behind `ISketchSolver`, replaceable by D-Cubed):
  Eigen3 + Boost via vcpkg; FreeCAD `Base/`/`FCConfig` shims documented in
  `src/Base/` + `src/FCConfig.h` + `src/boost_graph_adjacency_list.hpp`.
- 5 solver unit tests: exact rect, circle radius, drag-target rigid move,
  conflicting dimensions diagnosed (not faked), under-constrained dofs.
- Sketch store + solve-before-commit: unsolvable edits rejected, stored
  coordinates always solved (§41 for sketches). 8 sketch tests: JSON
  round-trip, exact solve, extrude 100000, open profile refused at extrude,
  downstream propagation in ONE revision, conflict keeps old, revolve 360°
  Pappus-exact, save/open keeps sketch + solid.
- Extrude (MakePrism blind) + Revolve (MakeRevol 360° about sketch X):
  DAG nodes with sketch deps; `RebuildNodeFromStore` dispatches all types;
  `SetDimension` works on `distanceMm`/`angleDeg`.
- OCAF: sketch labels under a Sketches folder (UUID name + JSON comment) —
  Undo/Redo/save/open preserve sketches; `EncodeParams` now carries
  `@deps=` so extrude→sketch edges survive reopen; `Load` returns solids +
  sketch JSONs; open adopts without wiping (baseline, selections kept).
- UI: SVG sketch editor (H badges, dimension rows, drag with transient
  preview + inference badges, Esc cancels drag), extrude dialog, sketch nouns
  in tree + properties, Auto/Body/Edge filter untouched, downstream meshes
  re-pulled after sketch commits (dependsOn now flows to the store).
- E2E phase4: create rect sketch → extrude exact → dimension 150 →
  downstream 150000 + face ref kept → editor closed via Done → save/reopen
  identical (ids, volume). 6/6 E2E green.

## Hard-won notes (do not regress)

- OCCT 8 makers are lazy: explicit `Build()` before `IsDone()`.
- One TNaming evolution kind per builder (`Modify`+`Generated` conflict).
- OCCT includes must precede `namespace kreoda`.
- `TopoDS_Shape::Location()` is a getter; copy before transforming.
- Zustand selectors must return stable references (memoize derivations).
- three.js non-indexed `LineSegments` raycast reports the segment's start
  VERTEX index — divide by 2 for the segment number.
- Workspace packages resolve from `dist/`: rebuild them after `src` edits.
- `GC_MakeArcOfCircle` takes `gp_Circ`, not `Handle(Geom_Circle)`.
- `RebuildNodeFromStore` must check `SketchStore` FIRST (sketches are not
  in `ShapeStore`) — "unknown feature" trap.
- UI must display SOLVED coords from the server response, not the local
  draft; and `dependsOn` must reach the store or downstream re-pull finds
  nothing (both bit in Phase 4 E2E).
- Playwright `getByRole(name)` is substring-insensitive: use `exact: true`
  when two buttons share a word ("Pull" vs "Pull sketch").
- `vite build` needs no special flags; rebuild packages → renderer → E2E.

## Phase 5 entry (§61: core solid features)

1. Boolean union/cut/common (BRepAlgoAPI_Fuse/Cut/Common + TNaming history).
2. Hole feature (cylinder cut on a persistent face reference).
3. Fillet/chamfer with safe-range diagnostics (§41 binary search).
4. Shell, mirror, linear/circular pattern, loft, sweep.
5. `flatc` codegen from `schemas/cad_protocol.fbs` (C++ + TS together).

## Appendix: Phase 4 bug-hunt (post-acceptance audit, FIX-FIRST → all fixed)

Per repo policy, a specialized bug-hunt subagent audited Phase 4 after the
acceptance run. Verdict was FIX-FIRST (11 critical + 5 major); every must-fix
is now resolved and re-verified (41→43 ctest, 6/6 E2E, both self-tests):

- Solver: residual now verified on EVERY status (no blind `Success` trust);
  `Fixed`-kind constraints actually pin points (tags without GCS constraints
  excluded from residual); unknown drag point errors honestly; stub include
  fixed (stub build compiles + passes again).
- Validation: duplicate ids rejected for lines/circles/arcs/constraints;
  solid creates reject ids already in either store (was silent type-change
  via rebuild path); sketch entity caps (2000 entities, ±100000 mm).
- State: `ResyncStore` re-notes sketches + replaces the whole registry
  (stale entries vanish after undo); `syncFromCoreList` keeps sketch
  selection; `UpdateSketch` preview echoes the stored plane (was hardcoded
  XY); stub `CommitShape` keeps DAG deps.
- Roles: `extrude.*`/`revolve.*` branches (caps/walls/ring) stable across
  parameter edits; E2E now asserts `extrude.+Z` instead of the misleading
  `box.+Z` fallback.
- UI: arcs carried through load/commit/preview + rendered as SVG paths +
  strict zod; preview seq guard (no stale wins); commits read the live
  preview ref; failed commits roll back via re-fetch; `createRectSketch`
  is a single commit with current revision; `ExtrudeDialog` requires a
  sketch noun; `diameter` editable; revolve angles parse deg/rad with a
  deg label; Escape cancels active drags; status bar counts sketches;
  downstream meshes re-pulled after sketch commits (`dependsOn` now flows
  to the store).
- Schema: fbs gains `SketchArc` + `arcs` + `PreviewSketchRequest` in the
  union; extrude/revolve `BuildPreviewMesh` implemented (panel slots no
  longer mislead).
- New tests: duplicate/collision/Fixed/drag-unknown/roles-stability/
  extrude-preview/undo-sketch-edit (native), sketch payloads (TS).
- Deliberately deferred (minor/robustness, tracked for Phase 5): dead code
  (`PickingSystem` stub, `CommandBar` sketch verbs, `toSvg` removed already),
  `diagnose()` double-solve cost, non-ASCII id conversion, `replaceAllMeshes`
  merge, pre-load double-Reset, toolbar face/vertex/sketch filters.
