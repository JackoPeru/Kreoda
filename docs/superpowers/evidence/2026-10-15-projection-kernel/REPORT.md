# Native projection evaluator candidate

Implements only Task1 of the Phase15.2 spec/plan: pure resolved-topology edge projection, apparent silhouette and infinite-plane section. Associative sketch groups, persistent source lineage, graph/persistence/Undo, downstream profiles, canonical APIs and Desktop/Quest/MCP controls remain required. No full15.2 or goal completion is claimed.

## Source and delivery

Separate GPT-6-Luna/Max task01a13ec1-ddbd-7783-a456-28a09cf52694 wrote the five owned CMake/source/test paths. It ended with a terminal usage-limit error after launching the complete CTest gate; that gate finished243/243. Parent continued under the user's explicit quota fallback, without restarting/replacing the worker. No product source corrections were made by the parent before this candidate freeze.

The evaluator preserves native curves and world CAD-mm frames, publishes output only on success, validates finite nondegenerate/coplanar results, and reports errors explicitly. Source line projection uses projected endpoints; curved edges preserve trimmed native geometry. Silhouette uses native boundary-face sweep/fusion and plane section with HLR outline fallback. No mesh/polygon surrogate is introduced. TKHLR is linked to the actual core and test target.

Actual behavioral RED:9 tests ran,7 geometric success cases failed on temporary false-return stubs,2 error cases passed. Compile/link setup failures were not counted as RED. Parent identified missing spline-family coverage; the same worker added a genuine B-spline native-curve/parameter fixture. Final focused run10/10 includes source translation/rotation and tilted frame, trimmed and closed ellipse, B-spline, reversed orientation, sphere/oblique box/annular silhouettes, analytic sphere section and error atomicity. Intermediate failed logs remain outside Git.

## Parent independent verification

After the worker was authoritatively terminal, parent ran C:/Users/matte/Documents/Codex-tools/Native/phase15-projection-parent-20261015/verify.py against the worker's isolated build. This ran the complete native CTest independently and inspected the actual XML, not the worker's narrative:

-243 cases passed,0 failures/errors/skips;10 Projection cases included. This is240 GoogleTest cases plus the three separate existing production/barrier controls.
- Real OCCT ON,stub OFF,crash barriers OFF were checked in the actual build cache.
- Normal core self-test exited0 and printed its success confirmation with PATH restricted to System32/Windows. DLL loading therefore used the actual app-local runtime, including the new HLR dependency.
- The five captured source hashes were unchanged throughout parent verification. Manifest, actual XML/log and summary are retained here. Committed text log copies normalize whitespace only; raw logs remain in the QA folders.

Build output: C:/Users/matte/Documents/Codex-tools/Native/phase15-projection-kernel-20261015/build. Parent QA: C:/Users/matte/Documents/Codex-tools/Native/phase15-projection-parent-20261015. The human checkout and main production build were not configured or edited by this task.

## Review and scope boundary

Fresh immutable Sol6/high review is pending at this report's creation. Review must check general silhouette semantics, native source topology immutability (Boolean/section algorithm defaults are a particular focus), curve/parameter retention, transform handling and failure atomicity; the ten fixtures alone are not a proof for every native shape.

Hosted b5d1736 CI38707325681 completed success for the preceding source; it does not cover this new kernel. A new-head hosted runtime/package/regression gate remains required after acceptance. No merge/release, server/Hermes/SSH/Tailscale/AI probe, device/ADB action, mic/camera capture, PC audio or foreground GUI. Full original Phases12-16 remains active.

## Source-topology review correction

Fresh GPT-6-Sol/high reviewer01a13fd4-9adb-70d2-ac42-e97458bfb5a8 returned fix-first for candidate025fab: the public plane-section evaluator built directly from the caller's shape with OCCT's destructive default. Parent applied the user's explicit quota fallback after the original Luna worker's terminal usage-limit error; no replacement worker was launched for quota.

A real regression now serializes the source box B-Rep before and after sections at z=3, z=1e-8, z=0 and disjoint z=20. The near-coincident section reproduced source edge-tolerance changes from1e-7 to1.1e-7 on the original code. The first coarse-only fixture passed before correction; it was not counted as RED. The final near-coincident fixture failed behaviorally before the fix and passed afterwards. Failure also retains the sentinel output. The fix constructs the section without building it, enables SetNonDestructive(true), then explicitly builds it. All11 focused Projection cases pass after this correction. Raw pre-fix and corrected logs remain under the user's Temp folder.

Complete corrected parent verification and a new fresh immutable review are required before accepting this candidate. Earlier243/243 and hosted b5 success do not establish acceptance of the correction.

Corrected parent verification now passed244/244 CTest,0 failures/errors/skips, including11 Projection cases. The normal OCCT core self-test passed again with PATH restricted to System32/Windows; the five source hashes stayed unchanged. Actual corrected XML, source manifest, summary, native/self-test logs and behavioral RED/GREEN logs are retained in purity-correction/. A new fresh immutable review remains pending; no corrected-head hosted CI is claimed.
