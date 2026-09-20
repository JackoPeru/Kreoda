# Phase 9c (reference Stage A) → handoff

Images import as calibrated background planes to trace over: file → bounded
data URL (main), textured quad on a principal plane (viewport), two-click
UV-mapped calibration against a real distance (or known width). Session
view aids (like the grid) — deliberately not persisted, not undoable, never
model state. Stage B/C (vision) stay future.

## What landed

- `src/reference/store.ts`: session store + pure `calibrateSize`
  (pixel distance → mm/px → plane size), `decodeImageSize`, opacity/plane
  controls. Unit-tested (mapping + degenerate rejects).
- `CadViewport.syncReferencePlanes`: textured quads (sRGB, depthWrite off,
  renderOrder -1, per-plane offsets), full disposal parity with bodies;
  `beginReferenceMeasure` captures two UV clicks (misses swallowed, cancel
  supported), exposed via `viewportHandle` + `Viewport.tsx` wiring.
- `electron/main.ts` `kreoda:reference-import` (dialog png/jpg/bmp, 8 MiB
  cap, ext-derived mime) + preload; `ReferenceDialog` (import/list,
  plane/opacity/delete, Measure → inline distance, known-width path);
  Toolbar image button; `addReference`/`calibrateReference` test hooks.
- E2E `phase9-reference.spec.ts`: generated checkerboard → inject →
  calibrate (100×50 mm asserted) → dialog shows size → screenshot proves
  the render.

## Verified

- `pnpm -r lint/test/build` green (reference unit 2, desktop 48);
  Playwright 20/20.

## Hard-won notes (do not regress)

- `window.prompt` does not exist in Electron: capture-then-inline-field is
  the pattern for any future measured input (Measure flow does this).
- UV mapping gives image pixels directly — no plane-scale math in the
  calibration path (the first draft converted through mm and was deleted).
- Unit-test mocks of `CadViewport` must add every new method
  (`syncReferencePlanes` broke `app.test.tsx` until mocked).
- Boot auto-load guards a missing preload API (`window.kreoda?`) so jsdom
  stays quiet.
- Remaining Phase 9: assemblies (9d).
