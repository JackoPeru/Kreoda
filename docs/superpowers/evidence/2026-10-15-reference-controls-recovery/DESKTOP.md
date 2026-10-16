# Sketch frame recovery and Undo correction

Full original Phases12-16 scope remains active. Separate GPT-6-Luna/Max worker01a13c17-0c6e-7713-83b5-20678e104ce4 ended with a terminal quota error. Parent continued its partial packet under the user's explicit fallback. No server/Hermes/AI/device/microphone/camera/audio or foreground UI actions were used.

## Cause and change

Canonical session snapshots carry a sketch model separately from its native plane and support reference. Renderer rehydration previously cached that model without the plane and discarded an explicitly empty principal support reference. Rehydration now enriches both summary and full cache from the same native data, without inventing geometry or reusing stale coordinates.

The first new translated/inclined datum crash regressions recovered correctly, then found a second real defect on ordinary Undo: native Undo/Redo replies contain summaries only. Those replies replaced the full model cache. Summary-only updates now await the existing bound ordered canonical refresh, before publishing the supplied summaries. A regression first failed with refresh count0, then passed with one refresh and exact new canonical coordinates/frame/support rather than stale cached coordinates.

Three added actual OCCT crash cases exercise renderer/main/core, retain strict full before/after sketch summaries and native committed coordinates/constraints, and verify ordinary new box edit Undo/Redo preserves the supported sketch and datum UUID. They await the real editor's initial rectangle; no fabricated persistence state or weakened recovery assertions. Frame agreement with the datum uses12-decimal numeric comparison; recovery equality remains strict. The asymmetric translated frame avoids JSON signed-zero differences unrelated to geometry.

Command-schema test discovery now targets src, so the twelve source cases run once even with stale ignored compiled copies in dist. No source assertions were removed.

## Parent evidence

- Desktop287/287 across44 files; full Desktop build including TypeScript check exited0. Exact logs and hashes of the five source/test/script paths retained here.
- Schema12/12 across2 source files; lint0.
- First complete hidden native crash run:29 passed,3 new datum cases failed specifically at ordinary Undo cache equality. All original29 cases, including the former six hosted failures, passed. Production restoration succeeded; barriers OFF and SolverCrashBarrierControl passed. Raw failure/restoration log retained. This is an explicitly failed intermediate full gate, not a passing full gate.
- Corrected six-case native production-core regression (three existing solved-sketch crash cases plus three supported datum cases):6 passed,0 skipped,process0. Renderer/main/core each preserve supported native frame/UUID/geometry through recovery and ordinary Undo/Redo. Corrected full hosted CI and fresh immutable review remain required; this targeted success does not relabel the failed intermediate full run.

Raw current QA logs: C:/Users/matte/AppData/Local/Temp/kreoda-recovery-units2-20261015.log, kreoda-recovery-build3-20261015.log, kreoda-recovery-full-20261015.log and kreoda-recovery-corrected-six-20261015.log. Draft PR3 remains open; no merge/release.

Quest APK receipt predates trimming only trailing spaces in two new Unity .meta files (their GUIDs/settings are unchanged). All C# and saved-scene bytes used by the final frozen APK build match the Quest code packet. The previous162-file manifest retains the exact pre-trim hashes; this boundary does not claim a byte-identical post-trim metadata artifact.

Committed log copies normalize trailing/indent whitespace only; the raw logs at the paths above remain unchanged.
