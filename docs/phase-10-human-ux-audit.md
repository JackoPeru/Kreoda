# Phase 10 human beginner UX audit

**Status: COMPLETE — ORIGINAL TASKS REPORTED COMPLETE; REVISED UX ACCEPTED.**
### Participant acceptance — 2026-10-03

The participant requested launch of the revised app, then replied **“ok è ottimo, prosegui”**. The launched ASAR matches the verified revision `0c944b7e9770ba915e3554f9ea9ad721b907bee5`; the visible Kreoda window and process were verified before the participant used it. This accepts the four revised UX flows and authorizes continuation. It is participant feedback, not an independently recorded repeat of all eight original tasks; numeric duration and wrong-click counts remain unrecorded. The earlier explicit deferral and failed usability findings below are preserved as history.

The current exact full Windows run37136496515 passed native144/144, public-native141/141, .NET21/21, workspace133/133, ordinary54/54 including four real native dialogs, crash29/29, ON/OFF controls and production-core restoration, installation/provenance, topology/persistence/current-project reopen/assembly/plugin/resource gates. All117 measurement rows and33 completed steps are retained. Combined with original eight-task completion and accepted corrections, **Phase10 COMPLETE; Ready for Phase11 YES**. Publisher entitlement remains a later distribution requirement and is not inferred from the clean-host installer test.

## Session

| Field | Reported/verified value |
| --- | --- |
| Date | 2026-10-03 (Europe/Rome) |
| Participant | Project owner, volunteered to perform the beginner audit |
| Prior CAD experience | Not quantified by participant |
| Application source | Production desktop/native source equivalent to tested 5f9fc9b; portable copy prepared at 5f84f01 |
| Executable | `C:/Users/matte/Documents/Codex-tools/human-audit-5f84f01-7660d864ef894b56a5e30eff6e15dc17/Kreoda-win32-x64/Kreoda.exe` |
| Runtime variant | Local static-MD diagnostic portable copy, distinct from hosted Squirrel payload |
| Launch | 2026-10-03T09:14:29.2387477Z; actual window title Kreoda and nonzero window handle verified |
| Windows/screen size/UI language | Not recorded during participant session |
| Observation method | Participant report in this chat; no independent screen recording or per-action timing |
| Assistance | Task outcomes given before session; no app input automation during participant session |

## Tasks

All dimensions are millimetres. Outcomes below are participant-reported, not
independent observations of each action. The participant explicitly answered:
“ho finito tutto, ci ho messo pochissimo tempo, ti ho descritto solo gli attriti che ho trovato”.

| Task | Reported outcome | Elapsed time / wrong clicks |
| --- | --- | --- |
| Create a 100 x 60 x 10 block | Completed | Not recorded per task |
| Centered through-hole, diameter 8 | Completed | Not recorded per task |
| Four vertical-corner fillets, radius 3 | Completed | Not recorded per task |
| Change width to 120 | Completed | Not recorded per task |
| Undo width change | Completed | Not recorded per task |
| Redo width change | Completed | Not recorded per task |
| Save ICAD | Completed; file path not supplied | Not recorded per task |
| Export STEP | Completed; file path not supplied | Not recorded per task |

Total duration was described as **“pochissimo tempo”**, with no numeric duration.
Wrong clicks, confusing terms and unnecessary dialog counts were not quantified.
No crash or lost work was reported; this is not an assertion that none occurred.

## Reported friction and requested corrections

1. The UI on the face occupies too much space. Keep contextual actions compact and
   move their chrome away from the selected face without losing access to actions.
2. Moving/rotating through the 3D environment feels cumbersome and unintuitive.
   Participant chose **left drag orbit, right drag pan, wheel zoom**.
3. Hole placement appears limited to the center. Participant wants a visual preview
   to choose a point manually, by a distance from an edge, or by combining at least
   two edge-distance measurements. Existing face-local numeric fields are insufficiently
   discoverable; precise input and visual feedback must agree with actual geometry.
4. Home still uses Three.js despite the requested UI reference video background.
   Use the original `riferimento UI/gemini_generated_video_2fbba15c.mp4`.

These are retained as the original failed usability observations. The centered-hole
baseline can be completed while arbitrary placement remains confusing; the two facts
are compatible. Fixing automated cases alone does not close participant acceptance.

## Historical local corrections before participant acceptance

[Exact source, logs, packaged identity and boundaries](evidence/phase10-local-human-ux-corrections-b1836d7.json) retain the current results.

Parent current verification passed **133 workspace units** (111 desktop, 16 protocol, two SDK, four units), desktop typecheck/build and **15/15 hidden Electron cases in 1.1m**. The expanded suite preserves the full centered-hole/four-fillets/edit/STEP beginner flow, actual second upstream insertion after reopen with native two-hole volume readback, manual/two-edge hole placement, navigation and responsive controls. It also verifies real Chromium missing-video error with a loadable poster and usable project controls, and reduced-motion pause/resume. All 33 built renderer/Electron files match the latest delivered ASAR byte-for-byte; the packaged hidden clone passes real file:// video playback, three mouse gestures, manual native hole placement, editable ICAD and one-current-solid STEP readback. Native/client/protocol source and the original participant app are unchanged.

First hosted correction run 7438 failed 50/54 ordinary cases and never reached the crash gate; its complete failure evidence is retained. The second-hole async center/input race is fixed by disabling X/Y until placement is ready. Old blank-center/retired Home3D expectations are replaced without reducing the 54-case ordinary cohort. New real media probes exposed stale play-promise rejection after reduced-motion pause; a minimal effect cleanup guard fixes it, with a focused previously failing regression. Luna/Max owns the two minimal production fixes; parent owns diagnosis, tests and independent verification. Previous fresh Sol SHIP applies to 7438 only; fresh GPT-6-Sol/high **SHIP**; all 533 source files and 51 artifacts unchanged across review. Exact current full hosted CI **SUCCESS**. Participant explicitly deferred retest: **“La provo più tardi”**. Phase 10 remains PARTIAL, Ready for Phase 11 NO.

The participant chose **“La provo più tardi”** for the revised app. Acceptance remains open; do not infer acceptance from automated checks.

## Historical retest requirements before acceptance

- The four reported corrections are implemented and locally verified; [exact hosted CI passed](evidence/phase10-runtime-37136496515.json).
- Let the participant repeat the affected flows in the revised app.
- Record elapsed time, wrong clicks, confusing terms, hidden state, unnecessary
  dialogs and any remaining blockers. Keep qualitative reports distinct from measured counts.
- Preserve saved/output file paths when supplied. Do not fabricate missing metrics.
- Accept only after critical reported blockers are resolved and outcomes recorded.

**Observed audit outcome: ORIGINAL TASKS COMPLETED; REVISED UX ACCEPTED BY PARTICIPANT.**
**Ready for Phase 11: YES.**
