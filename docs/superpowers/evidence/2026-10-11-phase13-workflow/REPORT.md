# Phase 13 software workflow and formula correction

The compiled spatial worker ran against the actual OCCT/Electron session: native Sketch → Extrude → Hole; Desktop saved that same fixture; native face/manipulator metadata drove a projected drag and exact final 30 mm value; separate cancellation preserved the revision; contextual edge selection created a fillet and shared Undo removed it. The existing Desktop command bar then continued with `100 / <extrude>.distanceMm`, with the expression and exact 100/30 diameter observed in the renderer. No synchronization or transfer step was required.

The expression parser previously evaluated variable placeholders while collecting dependency references, rejecting a legal variable denominator as zero. A new native test reproduced the error; collection now checks syntax without evaluating multiplication/division. Actual evaluation still rejects zero. Focused Expressions 6/6 and final native 177/177 passed (82.547 s). Desktop lint passed. The real hidden Electron/C# workflow passed in 2.5 s; it received two authoritative previews. Its timing of 247.8194 ms covers the software edit/continuation segment, not physical headset latency.

The initial test harness wrongly attempted file save through session invoke type 10, which is intentionally unsupported. It now asks the Desktop save path to save the live fixture before editing. A second harness failure was the English command helper on an Italian locale; the normal English test locale flag fixed it. These are harness corrections, not product permission changes.

Fresh actual gpt-6-sol/high reviewer `01a12a8d-14d3-7262-abf2-e5c2cea6ef58`: SHIP. All 812 source inputs match before/after SHA256 `50b2e3b8b6357b276c24e1a4aabce892e079494503d0cdc3e432c8008b336b09`. Read-only behavior is not enforced by the wider host permissions.

Evidence: external QA `C:/Users/matte/Documents/Codex-tools/Unity/QA/phase13-workflow-green-20261011`; TEMP native/lint/RED/GREEN logs and source freezes. Full ordinary/crash cohorts and exact hosted gate are still running. Physical Quest workflow/comfort remains unverified; Phase 13 is not complete.

After ADB trust became available again, the accepted Task 6 APK SHA256 `4a85ea0077b74800d5c9423e3567d47e59853cca5c26243b15c064e87e69945c` installed successfully via `install -r`, preserving app data, and USB reverse 9842 succeeded. Activity launch succeeded. Actual PC authentication and new mesh observations are pending; no manual visor action is requested.

## Later final software gates

- Ordinary hidden Desktop cohort:56 passed/2 skipped,6.3 minutes, actual production OCCT SHA256`b0143454cb402f6791c156f42d520751b991fb1b6899e0a1287e1c4f5bd71248`. The two skipped cases are native file-picker and installed-desktop gates requiring their own explicit harness; no claim they passed. High triangle tests include1,000,000 real native triangles.
- Separate controlled crash core:29/29 passed,2.7 minutes, barrier control1/1. Production build stays barriersOFF; crash-enabled binary is not packaged. Fresh crash build initially lacked the JSON dependency location, corrected by reusing the existing verified dependency directory; no package installation or production toggle. Both cohorts restore compiled main bytes exactly.
- Accepted Task6 normalAPK installed and actual new Unity process logged KREODA_CONNECTED and KREODA_MODEL objects1/triangles12. A temporary stationary guardianpause was restored0 and proximitysimulation released; no physical comfort/contact claim.
- New hidden PC package uses runtime source27d8bba, normal/hidden archives and production core verified; reference homevideo matches SHA2cd0f274. Initial in-process validation used cached old ASAR header offsets after archive replacement; a fresh process verified the real bytes. Existing auditmodel/profile retained; primary/acceptedUXportable untouched.

## Accumulated internal review and updated hardware proof

Fresh actualgpt-6-sol/high reviewer01a12a9e-29e5-7843-a37d-b7f94df5715f reviewed the committed runtime rangefb00102..27d8bba:SHIP for internalsoftware. All820 observed inputs are byte-identical before/after, manifestSHAd08984f56f90942026e2eddba54b47e31feb1f16a1c9dd4daa6cfe05e8d5bfcb. UncommittedPhase14 library/tests/plan were explicitly out of scope. Hostdanger-full-access/disabled does not enforce readonlyisolation. Exacthosted27d8bba fullregression remainsrunning; physicalroadmap13.18 acceptance remainsopen.

ActualnewQuest30388 rejoined updatedhiddenPC42896 using savedcredentials, client1/device1. Desktopwidth100→120→100 revisions3→4→5 produced freshUnityKREODA_MODEL uploads13:00:46.287 and13:00:47.966. Earlier off-face attempt produced no uploadmarkers; it is retained separately and is not proof of rendering. After resuming the app, bothfreshmarkers appeared. NativeDesktopparameters restored100/50/20. Temporarystationaryguardianpause restored0/proximitysimulationreleased. Artifact:externalPCrootquest-incremental-resumed-evidence.json. This attests transport/upload afterrealDesktopedits, not physical spatial gestures or visuallymeasuredwidth.
