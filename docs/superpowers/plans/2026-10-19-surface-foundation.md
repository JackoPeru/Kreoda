# Surface foundation implementation plan

Design: `../specs/2026-10-19-surface-foundation-design.md`.
Execution: user-requested separate GPT-6-Luna/Max worker; parent advisor reviews and
verifies. Quota failure permits parent implementation, as explicitly authorized.

- [x] Add failing native tests for real surface extrusion, revolution and open loft;
  assert topology/area/bounds, displaced/rotated inputs, unordered edges, invalid
  input atomicity and clear surface analysis errors.
- [x] Implement shared exact sketch-wire evaluation and bounded OCCT builders;
  integrate canonical feature creation, recompute, numeric edits and persistence.
- [x] Separate surface validation/metrics from solid validation/physical metrics;
  preserve whole-document solid queries when surfaces coexist.
- [x] Append IDs 48–50 and regenerate only the affected native/TS/C# artifacts.
  Register strict command parameters and one-feature allocation metadata.
- [x] Integrate surface type/labels and both-side presentation in Desktop and Quest;
  preserve selection, revision fences, section/zebra/curvature and solid culling.
- [x] Worker runs focused tests and reports exact diff, commands, results and gaps.
  Initial report received; correction quota failed, parent completed fallback.
- [x] Parent inspects baseline-relative scope, reruns native/contract/client tests,
  verifies actual hidden Electron/native and Unity GPU workflows, then packages and
  updates the owned Desktop and Quest installations with source/hash guards.
- [x] Record exact evidence and leave physical acceptance and the remaining six
  roadmap surface operations explicitly open until implemented and verified.

## Review focus

Evidence: `../evidence/2026-10-20-surface-foundation-verification.md`.

1. Non-origin open surfaces must never acquire a fake volume or mass.
2. No wire can lose edges, silently close, branch or swap plane coordinates.
3. Failed create/edit/rebuild/open must preserve prior canonical state.
4. Full-turn revolution and closed-profile loft must stay surface bodies.
5. Both-side culling must survive section and analysis toggles without geometry or
   collider mutation, including stale uploads and replaced documents.
