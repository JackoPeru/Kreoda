# Exact native profiles and bounded Windows save correction

## Scope and implementation

Separate task01a13fdd-edbe-7612-aec8-e6913da609d6, verified GPT-6-Luna/Max, completed the delegated packet without committing or pushing. Parent inspected the actual eight-path product diff. Sketch profile assembly deep-copies native input edges, validates closed boundaries and intersections, classifies material/hole/island by native containment, and produces a face or compound of disconnected material faces. Existing legacy face API accepts exactly one material region. Actual Extrude/Revolve builders now consume complete profiles. Native curves remain authoritative; no polygon surrogate or new dependency is introduced.

The packet alone does not complete associative15.2. Projection-group ownership, persistent source binding, graph/OCAF/history, canonical public commands/transport, Desktop/Quest controls and original Phases12–16 continuation remain required.

## Behavioral proof and observed save failure

Actual profile RED ran five positive cases and failed all five: production disconnected Extrude/Revolve failed the old largest-outer face implementation; three new native-profile success cases failed temporary unavailable stubs. Compiler/link failures were not counted as behavioral RED. Final focused profile/sketch run passed36/36, including exact projected curved profile area/centroid/prism volume/placement, annulus/disconnected/nested regions, native closed B-spline, reversed/shuffled edges, legacy face rejection and invalid/ambiguous/source-atomic failures. Additional valid native self-intersecting closed B-spline and off-plane/null/empty cases reject correctly. Source BRep snapshots before/after have identical SHA256d0dcb5f6fa81da7aee4bf248ef7dd953365a8a935d92b735625f1b0f3b0db7aa.

Initial complete native gate passed249/250: the references-only save-cycle test failed during SaveDocument. A rerun passed250/250; parent did not accept that as a diagnosis. Bounded temporary assertion instrumentation, restored before final changes, reproduced the failure on diagnostic run9, cycle39: `SAVE_FAILED`, `save: publish failed: Accesso negato.` This identifies failed atomic publication, not the identity of any locking process/antivirus or historical provenance. Failed evidence is retained.

Parent explicitly amended scope to the saveAtomically helper and actual Windows lock tests. A native handle denying delete-sharing reproduces fs::rename system error5 even though the lock is temporary. The correction probes actual destination DELETE access, retries only eligible Windows publication failures for a200ms window with short backoff, and allows one immediate reattempt when the lock clears between rename and probe. Payload is written once; the old destination is never removed as a fallback. Persistent failure still reports an error and removes only its own temp. Non-Windows behavior is unchanged.

Real-lock behavioral RED: transient unlock still returned SAVE_FAILED on old code; persistent-lock response did not provide the required bounded waiting. Corrected focused save gate passed7/7, including transient unlock publication, persistent failure around234ms with old bytes/reference metadata/revision retained and no publication-temp leftovers, prompt read-only/directory failure, existing repeated-save and atomic-overwrite regressions. Worker final CTest passed254/254 with no skips; after a test-guard adjustment it rebuilt and repeated the final254/254 gate on that exact test binary.

## Parent independent verification

After the worker was authoritatively completed/idle, parent ran C:/Users/matte/Documents/Codex-tools/Native/phase15-profiles-parent-20261015/verify.py against the isolated real-OCCT output. Parent independently built both normal core and tests, ran the complete254-case CTest and inspected actual XML:0 failed/errors/skipped,15 Projection cases and all required profile/Windows lock cases present. Normal core --self-test passed with PATH restricted to System32/Windows, proving app-local DLL loading. Twelve captured product/evaluator/CMake source hashes remained unchanged.

The first parent summary validator used the old draft fixture name `ObliqueEllipseBuildsExactProfileAndPrismWithoutMutation`; the actual final source/XML name is `TiltedProjectedCircleBuildsExactProfileAndPrismWithoutMutation`. All254 tests/build/self-test already passed; only this expected-name check failed. Parent inspected the actual case and its analytic area/centroid/volume/native-source assertions, corrected the QA name, and revalidated the same recorded XML and original source hashes without changing product code or rerunning a previously passing suite. Both initial and corrected summaries are retained; no missing test was silently ignored.

Actual parent XML, build/native/runtime logs, source hashes, original failed full/save diagnosis and behavioral RED/GREEN are retained here. Raw QA logs and source BRep files remain outside Git; a BRep hash manifest records the exact raw snapshots. Committed text copies trim trailing whitespace; build-log indentation tabs are expanded to spaces. The human checkout/production build, Hermes/server/device/audio/foreground surfaces remain untouched.

## Acceptance boundary

Fresh immutable GPT-6-Sol/high review is required before local acceptance. Published9df78ef CI38747587367 completed success for the preceding evaluator stage; it does not cover these profile/save changes. New-head hosted regression/package/crash gates remain required after review and push. No merge/release or whole-phase/goal completion is claimed.
