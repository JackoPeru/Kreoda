# Phase 3 → Phase 4 handoff

Phase 3 acceptance (§61) is green: drag box face → source dimension changes →
DAG recompute → exactly one Undo step; Undo restores the previous size.

## Verified Phase 3 results

- Feature DAG (`FeatureGraph`): dirty propagation to transitive dependents,
  Kahn topological order (deterministic via ordered map), cycle rejection
  before the kernel, upstream-failure skip with healthy branches continuing,
  tessellation-only dirty never triggers B-Rep work (6 graph unit tests).
- OCAF transactions: every create/rebuild runs in one OpenCommand/Commit
  pair (SetUndoLimit 100); Undo/Redo resync the store + graph and count one
  revision step each (4 black-box tests: create round-trip, volume restore,
  empty stacks honest, new-command-clears-redo).
- Commits are atomic (store + OCAF mirror, rollback otherwise); every
  OCAF/TNaming entry point is `Standard_Failure`-guarded (kernel never
  throws across IPC).
- Typed registry wired: toolbar renders from `COMMANDS` (availability
  disables with reason — "Make hole" waits for a face AND Phase 5);
  `executeCommand` = zod validate → availability → typed core call → resync.
  Dialog, panel, pull, undo/redo, test hooks all go through it.
- PropertiesPanel: exact dimension edit (Enter/blur commits, remount shows
  new value); E2E asserts tree `Box 200×50×20`.
- Pull tool: pointer drag on free faces (+X/+Y/+Z caps, cyl cap+wall, sphere)
  along the outward normal → throttled `isPreview` ghost → release commits
  ONE revision; anchored faces explain why instead of mis-editing; Esc
  cancels. E2E drags a real pointer path, asserts growth + revision+1,
  then Undo restores 100×50×20.
- E2E total: 5 specs green (boot, phase1 create/save/reopen, phase2 face
  persistence, phase3 panel + pull/undo).

## Hard-won notes (do not regress)

- OCCT 8 makers are lazy: explicit `Build()` before `IsDone()`.
- One TNaming evolution kind per builder (`Modify`+`Generated` conflict).
- OCCT includes must precede `namespace intentcad`.
- `TopoDS_Shape::Location()` is a getter; copy before transforming.
- Zustand selectors must return stable references (memoize derivations).
- three.js non-indexed `LineSegments` raycast reports the segment's start
  VERTEX index — divide by 2 for the segment number.
- Workspace packages resolve from `dist/`: rebuild them after `src` edits
  or the shell runs stale code ("unknown command" trap).
- `vite build` needs no special flags; renderer rebuild required after any
  `src` change before E2E (also rebuild packages first).

## Phase 4 entry (§61: sketches)

1. Sketch plane + local 2D coords, entities (line/circle/arc/rectangle).
2. PlaneGCS behind `ISketchSolver` (own shared lib, replaceable).
3. Constraint inference badges + drag solving (temporary drag constraint).
4. Extrude/revolve from sketches as DAG features (depend on sketch node).
5. `flatc` codegen from `schemas/cad_protocol.fbs` (C++ + TS together).
