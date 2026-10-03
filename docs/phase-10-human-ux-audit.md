# Phase 10 human beginner UX audit

**Status: RUN — PARTICIPANT REPORT RECEIVED; CORRECTIONS LOCALLY VERIFIED; RETEST REQUIRED.**
The participant reports completing all eight tasks. Acceptance remains open while
the revised flows are retested by the participant. Reported friction has been corrected and locally verified. No quantitative time
or click count was supplied; no values are invented.

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

## Local corrections verified

[Exact source, logs, packaged identity and boundaries](evidence/phase10-local-human-ux-corrections-b1836d7.json) retain 131 passing workspace units, desktop typecheck/build, and one 11/11 hidden Electron run (37.5 seconds). The actual portable clone played the original video inside its file:// ASAR, with no Home canvas. Real left-orbit/right-pan/wheel gestures preserved selection. A manual SVG click produced a native center of X20/Y19.99999 mm; two real straight-edge dimensions produced decentered holes on XY and vertical faces, with native coordinate readback, Undo/Redo and ICAD reopen. Existing pull/drawer/responsive flows passed. The packaged clone also passed editable save/open and STEP readback as one current solid. The original participant app archive remains unchanged.

Fresh GPT-6-Sol review found and Luna corrected a right-pan/quick-left-click suppression defect. The focused regression and all 131 workspace units passed; the exact revised build again passed all 11 hidden GUI cases and the packaged navigation/manual-hole probe. A second fresh review identified and Luna corrected the visible preview Y-sign label while preserving native coordinate behavior; positive/negative label-input regressions and the exact revised hidden/package runs passed. A third fresh review identified and Luna corrected framing direction changes for off-origin bodies; Home/F angular-continuity and distance regressions passed, followed by the exact revised hidden/package runs. Final fresh GPT-6-Sol/high review: **SHIP**. All 531 source files and 38 artifacts matched the review freeze. Current hosted CI and participant retest remain pending.

The face toolbar is docked and secondary actions remain available in More. Home uses the original MP4; the duplicate central wordmark is removed while retaining an accessible heading. Preview geometry is tessellated and precise edge quotes support straight CAD edges; curved edges remain visible for manual placement. The separate revised portable is prepared with an isolated-profile shortcut, without launching a visible window. Current hosted verification and participant retest remain pending.

## Retest and acceptance

- The four reported corrections are implemented and locally verified; complete hosted verification for this exact patch.
- Let the participant repeat the affected flows in the revised app.
- Record elapsed time, wrong clicks, confusing terms, hidden state, unnecessary
  dialogs and any remaining blockers. Keep qualitative reports distinct from measured counts.
- Preserve saved/output file paths when supplied. Do not fabricate missing metrics.
- Accept only after critical reported blockers are resolved and outcomes recorded.

**Observed audit outcome: PARTICIPANT COMPLETED TASKS; LOCAL CORRECTIONS VERIFIED; PARTICIPANT RETEST PENDING.**
**Ready for Phase 11: NO.**
