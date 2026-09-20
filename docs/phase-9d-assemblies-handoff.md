# Phase 9d (rigid assemblies) → handoff

Solids can be instanced: placed live copies that follow target edits
through the DAG, persist, undo, and accept holes/dimensions like native
bodies. Placement is explicit translation + ZYX degrees; mating
constraints are honestly deferred (that is a solver project of its own).

## What landed

- `features/instance/instance.{h,cpp}` (new): `CreateInstanceFeature`
  (id/target validation, no self-target, no nesting, ±1000000 mm
  translations) + `RebuildInstanceFromStore` + pure `BuildInstanceShape`
  (T then extrinsic ZYX rotation, copied shape).
- Core wiring: `rebuild.cpp` dispatch, `ResolveParamsForEdit` Instance
  slots (tx/ty/tz/rx/ry/rz — translations may be ≤ 0), expressions
  `ParamIndexOf` + range-by-suffix (Deg = any finite), generic OCAF mirror.
- Protocol vertical: `.fbs` `CreateInstanceCommand` + id 24, dispatcher
  `kCreateInstance`, TS `CommandType` + payload schema, command-schema
  entry (body-selected availability), coreClient `createInstance`,
  execute dispatch, LLM tool spec + `runPlan` (explicit target or live
  selection), `describeStep`.
- UI: `InstanceDialog` (6 fields, target caption, honest errors), toolbar
  entry (copy icon), App mount.
- Tests: 4 ctest (create/volume/bbox, reflow on target edit, move via
  SetDimension, nesting/self/garbage refusals + undo), phase9-assemblies
  E2E (dialog place, dimension move, persist).

## Verified

- `pnpm -r lint/test/build` green; ctest 82/82; Playwright 21/21.

## Hard-won notes (do not regress)

- Workspace `dist/` staleness again: the toolbar missed CreateInstance
  until `pnpm -r build` refreshed command-schema — always rebuild packages
  before renderer runs.
- Rotation convention (translate AFTER extrinsic ZYX) is load-bearing for
  the bbox assertions; document any change with the test.
- Instance faces classify under generic axis roles (`box.+Z` naming is a
  misnomer on copies but stable + unique — holes work).
- Face-local coordinates are frame-dependent (regression from 9a applies).
- Full Phase 9 remaining: bug-hunt + final verification + push.
