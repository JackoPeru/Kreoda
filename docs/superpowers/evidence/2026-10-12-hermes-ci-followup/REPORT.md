# Hermes CI follow-up: hidden renderer and frozen checkout bytes

Goal remains full Phases12–16. Hermes is busy with the user's image work; no live agent turn, remote mutation, restart, model reload or Quest action was performed.

## Hidden session tests

Hosted3ed8b77 run38228255640 failed two late `home-new-project.click()` actionability checks after hiding Electron. Actual native work and185managed tests passed;57other ordinary E2E passed. Separate GPT6Luna/max task01a12f79-3769-74c1-bb95-a42c172b0324 inspected traces and local renderer throttling. Exact hosted timeout did not reproduce locally; root cause on that runner remains inferred from frame-based stability and throttling, not fully proven. Worker added one shared helper disabling background throttling before hiding WebContents. Original native parameter/expression/Undo assertions, test timeouts and retry policy are unchanged.

Parent reran all three affected native E2E sequentially:3passed in20.1s. ExternalQA `phase14-ci-hidden-parent-20261012`. Temporary compiled bundle changed only `show:false` at construction, with no offscreen or background-throttling override; the source helper performs the correction. Compiled bundle restored exactSHAed967338bd7a29481f9f1daa87475eb826edb15cd2c669978926ad615dc454f1. No visible local application window. Desktop lint and diff-check pass. Exact corrected hosted head still required.

## Requirement hash

Hosted5b711eb run38231072324 failed7new benchmark fixture tests: Windows Git checkout uses CRLF, SHA53792fb904369e9594350be313289269c0c45749ffcf71fb609f74bca898f946, while original LF source isSHA78f72a3026a93c7ccf2102f29ab943b71c8c19b12e89007681cafd31a93af24a. Geometry/content are identical. Parent reproduced7failures by changing only the ignored test-output fixture to those CRLF bytes, then restored it in finally. The LF-only probe had passed; it was not a failing reproduction.

Root applied the already-authorized fallback for the benchmark implementation after its original Luna terminal quota. Shared `FrozenRequirements.Verify` normalizes only actual CRLF to LF, strictly decodes UTF8 and enforces the original hash. Added LF/CRLF coverage and an actual volume-content mutation rejection. Frozen source bytes and geometric predicates remain unchanged. The identical CRLF test-output fixture now passes29/29, restored afterward. Full runner under environmentPlatform=x64:125SessionClient+33ModelingAgent+27HermesBridge+29Benchmark=214pass,0failed/skipped. Local logs TEMP/kreoda-requirements-crlf-{red,green}.log and kreoda-ci-parent214.log.

## Boundary

This is a test/CI tooling packet. Live seven-fixture acceptance, complete command arguments and failed-turn command trail, native one-solid predicate, editability/sharedUndo, Desktop/Quest observation, physical hands/voice and Phases15–16 remain incomplete. A next bounded native-solid-count implementation plan is prepared separately; no code for it is included. Fresh source-frozen Sol6/high review pending. No merge or public release.

Fresh actualSol6/high reviewer01a12f86-a4e1-76b2-8879-09c5e7a235fb returned ship for bounded CI correction. All869source input hashes unchanged before/after (freeze2b87ee3fba40b84a02c09fc3542d661fe8316caeda67cfae25b64919146e1f1b). Broader danger-full-access/disabled observed; behavioral read-only, no enforced isolation claim. Hosted corrected head remains pending. Metadata-only review annotations followed source verification.
