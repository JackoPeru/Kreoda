# Manual Surface UI Implementation Plan

**Goal:** Make all six existing surface creation operations usable from Desktop UI.
**Spec:** `../specs/2026-10-21-surface-ui-design.md`.
**Execution:** Separate GPT-6-Luna/Max worker; parent review, verification, packaging
and installation. User authorized autonomous continuation; no root fallback.

## Files and boundaries

New: `apps/desktop/src/commands/surface-commands.ts`,
`apps/desktop/src/components/workspace/SurfaceToolsPanel.tsx`,
`apps/desktop/tests/surface-tools-panel.test.tsx`,
`apps/desktop/tests/surface-execution.test.ts`,
`apps/desktop/tests/surface-creation-core-client.test.ts`.

Modify narrowly: `apps/desktop/src/ipc/coreClient.ts`,
`apps/desktop/src/commands/execute.ts`, `src/components/workspace/TopToolDock.tsx`,
`src/components/workspace/WorkspaceChrome.tsx`, `src/app/App.tsx`,
`src/i18n/en.ts`, `src/i18n/it.ts`; existing test mocks only when new API requires it,
with explicit parent scope extension first. Optional worker evidence document.

Parent scope extension: narrow optional surface guard in
`apps/desktop/src/model/sync.ts` and new
`apps/desktop/tests/surface-sync.test.ts` to verify actual deferred mesh hydration
across connection-generation changes without epoch changes. Capture preimage first.

Native, Quest, registry/shared packages, viewport, auth, discovery and voice are
read-only. Preserve all dirty work in `Kreoda-phase10-ci`; do not edit human checkout.

## Implementation and acceptance

- [x] Capture preimages/hashes and real RED checks for missing surface client and UI.
- [x] Implement bounded allowlist/context, typed CoreClient creation and optional
  response-side-effect guard; test invalid command/params and stale undo protection.
- [x] Integrate six central dispatch cases and canonical snapshot refresh; test
  explicit sweep context without global selection changes and acknowledged-create
  refresh failure without duplicate mutation. Preserve provider/other commands.
- [x] Add compact nonmodal panel and More entry, lifecycle routing and localized
  fields. Test all six mappings, ordered lists, units, custom axis, invalid/stale
  sources, duplicate submission, failure draft preservation and read-only retry.
- [x] Worker runs focused tests/typecheck, reviews actual scope, freezes and reports
  exact files, verification, live handles and remaining gaps.
- [x] Parent reviews baseline-relative diff, full Desktop tests and build, plus
  actual hidden Electron GUI-to-native six-operation workflows and layout bounds.
- [x] Parent packages and installs Desktop hidden with source/hash/trust guards,
  preserving native642/Questfef artifacts and the original UX profile/shortcut.
- [x] Record evidence; retain all remaining full-goal requirements as active.

## Review focus

- A valid explicit sweep form must work with unrelated/empty global selection.
- A native commit followed by refresh failure must not invite a duplicate create.
- Late responses after document replacement must not change undo/mesh/selection.
- Multiple loft/sew inputs retain user order and never acquire guessed references.
- The form fits smaller Desktop windows and preserves access to the 3D viewport.

