# Phase 13 software workflow and formula correction

The compiled spatial worker ran against the actual OCCT/Electron session: native Sketch → Extrude → Hole; Desktop saved that same fixture; native face/manipulator metadata drove a projected drag and exact final 30 mm value; separate cancellation preserved the revision; contextual edge selection created a fillet and shared Undo removed it. The existing Desktop command bar then continued with `100 / <extrude>.distanceMm`, with the expression and exact 100/30 diameter observed in the renderer. No synchronization or transfer step was required.

The expression parser previously evaluated variable placeholders while collecting dependency references, rejecting a legal variable denominator as zero. A new native test reproduced the error; collection now checks syntax without evaluating multiplication/division. Actual evaluation still rejects zero. Focused Expressions 6/6 and final native 177/177 passed (82.547 s). Desktop lint passed. The real hidden Electron/C# workflow passed in 2.5 s; it received two authoritative previews. Its timing of 247.8194 ms covers the software edit/continuation segment, not physical headset latency.

The initial test harness wrongly attempted file save through session invoke type 10, which is intentionally unsupported. It now asks the Desktop save path to save the live fixture before editing. A second harness failure was the English command helper on an Italian locale; the normal English test locale flag fixed it. These are harness corrections, not product permission changes.

Fresh actual gpt-6-sol/high reviewer `01a12a8d-14d3-7262-abf2-e5c2cea6ef58`: SHIP. All 812 source inputs match before/after SHA256 `50b2e3b8b6357b276c24e1a4aabce892e079494503d0cdc3e432c8008b336b09`. Read-only behavior is not enforced by the wider host permissions.

Evidence: external QA `C:/Users/matte/Documents/Codex-tools/Unity/QA/phase13-workflow-green-20261011`; TEMP native/lint/RED/GREEN logs and source freezes. Full ordinary/crash cohorts and exact hosted gate are still running. Physical Quest workflow/comfort remains unverified; Phase 13 is not complete.

After ADB trust became available again, the accepted Task 6 APK SHA256 `4a85ea0077b74800d5c9423e3567d47e59853cca5c26243b15c064e87e69945c` installed successfully via `install -r`, preserving app data, and USB reverse 9842 succeeded. Activity launch succeeded. Actual PC authentication and new mesh observations are pending; no manual visor action is requested.
