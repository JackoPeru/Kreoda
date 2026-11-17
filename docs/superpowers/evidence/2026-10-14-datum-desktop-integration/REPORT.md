# Desktop datum integration — local evidence

Status: local Desktop/MCP integration verified; independent review pending. Not accepted as Phase 15.1 or the full goal.

## Implementation

- Native datum records hydrate the Desktop store and tree separately from solid bodies and meshes.
- Reference guides display native resolved planes, axes and points and select their real UUIDs. Plane borders are selectable; interiors preserve body-face picking.
- Compact reference geometry controls expose all ten native construction variants, sources, editing, status and supported sketch creation.
- Full sketch frames and support UUIDs survive client decoding, ordered model updates, creation, editor refresh and document reopening.
- Source dimension responses propagate updated datum frames to the renderer.
- Local MCP descriptions retain datum context; getDatum uses the existing read-only query route.
- Opt-in KREODA_BACKGROUND_TEST=1 hides Electron in the BrowserWindow constructor, disables background throttling and checks initial window visibility in the test harness.

## Parent verification

- Actual integrated Release OCCT native build: 226/226 CTest cases, zero failures/disabled; retained native-main-full.xml and raw log. This verifies the current main-worktree native sources, rather than relying only on the isolated native checkout.
- Desktop full unit suite: initial 261 passed/4 failed with one unhandled error caused by the obsolete CadViewport mock missing syncDatums. Updated that mock without changing section assertions. Confirmed 265/265 across 42 files, no unhandled errors.
- Protocol: 51/51; generated session contract check verified five artifacts and 43 DTO schemas against source fc27989e6b39fd8d12cafa770f72ab89f26e7bb0f9d14b635f687b3ebbdfe6ce.
- Desktop TypeScript: tsc --noEmit exit 0.
- Managed Release build and actual independent test runner: SessionClient 141, ModelingAgent 33, HermesBridge 34, ModelingBenchmark 33; total 241, zero failed/skipped. Runner validated each TRX; raw counters retained. The existing runner removes its temporary TRX directory after validation.
- Parent independently reran actual hidden Electron/native E2E: 1/1 in 29.1 seconds. UI creates offset plane and supported 100x50 sketch, extrudes 7 mm; actual native B-Rep query verifies 35000 mm3 and z24..31. Offset edit to30 retains UUIDs and moves the solid to z30..37; ordinary Undo restores z24..31, and actual .icad reopening restores the saved z30..37 chain. Initial BrowserWindow invisibility is checked. No screenshots.

Separate implementation lane: Codex task 01a139b4-f12b-78a2-b93f-961d3caa8da3, GPT-6-Luna/Max, verified runtime. Parent architecture, source inspection, gates and evidence remain in the original chat. Primary chat runtime is GPT-6.1-Sol/High, not the requested exact GPT-6-Sol; this limitation was disclosed.

## Remaining gates

Independent review is pending for this packet. Actual MCP-to-native datum mutation proof, current-head hosted CI, Quest datum/frame/pinch integration and normal ARM64 evidence remain open. This packet does not demonstrate a live Hermes Agent, STT/TTS turn or physical headset acceptance.

No Hermes/server/SSH/AI calls, remote service changes, microphone/camera capture, PC audio, device installation or foreground GUI were used in parent verification. The user's image generation restriction remains active. Primary dirty user checkout remains untouched. No merge or release.
