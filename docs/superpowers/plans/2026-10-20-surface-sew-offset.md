# Surface sew/offset implementation plan

Design: `../specs/2026-10-20-surface-sew-offset-design.md`.
Route: separate GPT-6-Luna/Max worker; parent review/verification. Full goal
remains broader than this increment.

- [x] Preserve original hashes/copies in external QA; add meaningful failing native
  tests for open/closed/curved sewing and signed exact offsets, including atomicity.
- [x] Implement shared exact OCCT evaluators; integrate creation, numeric edit,
  recompute, kind validation, persistence and legitimate surface-to-solid conversion.
- [x] Append IDs 51–52; strict schemas/defaults/fixed creation counts; regenerate
  only affected enums. Add fenced multi-owner bindings and tests.
- [x] Integrate derived kinds and localized labels/properties in Desktop/Quest;
  preserve surface versus solid rendering/picking/analysis/section behavior.
- [x] Worker verifies focused native/TS/Quest checks and returns exact diff/evidence.
- [x] Parent reviews actual baseline-relative changes, runs native/contracts and
  actual hidden Electron/native plus Quest GPU workflows, packages and updates.
- [x] Record evidence; retain sweep/trim/extend/thicken, assembly/direct editing,
  live integration and physical acceptance in the active full goal.

Evidence: `../evidence/2026-10-20-surface-sew-offset-verification.md`.
