# Phase 9a (parametric expressions) → handoff

Dimensions accept formulas (`set widthMm =heightMm * 2`): core-owned,
OCAF-mirrored, fixpoint-evaluated before the DAG recompute. Dependents
reflow on any source edit; cycles/typos fail honestly; formulas persist,
undo and reopen with geometry.

## What landed

- `native/.../expressions/expressions.{h,cpp}` (new): safe recursive-descent
  evaluator (numbers, refs, `+-*/()`, unary minus — no `eval`, no functions
  in slice 1), `ParamIndexOf` slots mirroring `ResolveParamsForEdit`,
  `ExpressionStore` registry, `EvaluateAllExpressions` bounded fixpoint,
  `EvaluateOneExpression` read-only (preview + set-time validation),
  `MirrorFeatureExpressions`, flat JSON codec for OCAF labels.
- OCAF: `Expressions/` folder + per-feature labels (`UpsertExpressions`);
  `Reset` creates it; `ResyncStore`/`Load` re-adopt + rebuild the registry;
  fresh baselines clear it (`DocumentStore::create`).
- `RebuildFeature(..., expression)` (old 4-arg callers untouched via
  overload): validate → stage formula → open command → mirror → fixpoint →
  dirty closure → recompute → commit, with store+formula rollback on abort.
- `kSetFeatureParameter`: optional `expression` field (replaces `valueMm`);
  preview evaluates read-only.
- Protocol/UI: `expressions` on feature summaries (list + single), TS
  schemas, command-schema (valueMm optional iff expression present),
  provider validation + forwarding, `set ... =formula` syntax, `ƒ` chip
  markers with tooltips, chip `=...` entry, snapshot field, HELP text.
- Tests: 5 ctest (parse, chain, reflow, cycles/typos/ranges, persist,
  undo/redo), parse unit, phase9-expressions E2E (set/reflow/persist/cycle).

## Verified

- `pnpm -r lint/test/build` green; ctest 78/78; Playwright 18/18.

## Hard-won notes (do not regress)

- Workspace deps resolve from `packages/*/dist`: rebuild them (`pnpm -r
  build`) after touching `command-schema`/`protocol`, or the renderer runs
  stale schemas (an edit once clobbered CreateFillet's schema — caught by
  the dist diff + E2E, now clean).
- Face-local coordinates are frame-dependent: hole tests map centers
  through the actual face frame (imports), never assume canonical frames.
- `RebuildFeature` 4-arg overload keeps old callers compiling; the 5-arg
  form is the only one the dispatcher uses.
- Deleting features has no command yet, so stale refs arise only from
  undo edge cases — eval skips missing targets with a log line; typos
  fail at set-time validation.
- Remaining Phase 9: plugins (9b), reference Stage A (9c), assemblies (9d).
