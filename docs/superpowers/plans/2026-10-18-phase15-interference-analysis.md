# Phase 15 interference analysis

**Goal:** expose a real, read-only OCCT interference check through Desktop and the canonical session protocol.
**Spec:** roadmap 15.6; full Phases 12–16 objective remains open.
**Execution:** parent fallback, because the authorized Luna lane exhausted quota. Preserve concurrent work.

Existing geometry-query and analysis-panel architecture is reused. `measureInterferences` compares
current visible body tips and placed instances, or 2–128 explicitly selected feature/body IDs.
OCCT common volume above a finite nonnegative `volumeToleranceMm3` (default 1e-6) is interference;
mere face/edge contact is not. Return stable component IDs, intersection volume, centroid and bounds.
Surfaces are reported as excluded. Invalid/stale geometry fails explicitly. No geometry, revision,
Undo history or persistence mutation. No remote Hermes calls or foreground windows.

## Review focus

- Body-history ancestors must not collide with their own current tip.
- Hidden cutters are excluded by default; explicit scope remains inspectable.
- AABB overlap alone must never be reported as a volumetric intersection.
- Pending UI results must be discarded after selection/document/revision changes.
- Excess work must fail before boolean operations: 128 components, 256 overlapping candidate pairs.

## Tasks

- [x] Native RED/GREEN: overlapping instances, touching/disjoint bodies, visibility, exact volume,
  unchanged revision/Undo and invalid inputs/budgets. Use nondestructive OCCT common operations.
- [x] Add canonical read-only session method/schema, generated bindings and a typed Desktop client.
- [x] Add compact Desktop analysis panel with current-result fences; meaningful UI regression tests.
- [x] Hidden real Electron → OCCT → session query proof, scoped native/managed/protocol/UI gates.
- [x] Record actual evidence and remaining full-roadmap limitations. No blanket completion claim.

Evidence: `../evidence/2026-10-19-phase15-interference-verification.md`.
