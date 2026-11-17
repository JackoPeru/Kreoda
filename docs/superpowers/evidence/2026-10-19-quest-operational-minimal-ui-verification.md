# Quest operational UI cleanup — 19 October 2026

## Delivered scope

The requested MR Home, real-room background and automatic LAN discovery remain
in place. A unique compatible PC connects automatically; multiple PCs are chosen
by name. Normal Home requires neither an IP address nor a pairing code. Manual
fields remain confined to advanced diagnostics. Startup prefers passthrough;
the Home has no video/GIF background. Earlier Home delivery is documented in
`2026-10-19-quest-minimal-home-verification.md`.

This packet simplifies all twelve operational pages:

- Neutral translucent rounded panels, one heading per panel and one page summary.
- Removes repeated fact shelves, footer summaries, diagrams and decorative layers.
- Retains original action labels and one useful live detail where space permits.
- Keeps the full analysis result, voice transcript/reply and reference inspection.
- Prevents results appearing again on navigation buttons and identical button/detail
  labels such as Fit. Removes the legacy reference title that overlapped the summary.
- Preserves 113 action identities, 37 semantic panels, callbacks, collider placement,
  per-PC trust, modal references, keyboard drafts, stale-result fences and hand input.

Product changes are limited to `QuestControls.cs`, `QuestUi.cs`,
`QuestControlsTests.cs` and `scripts/verify-quest-phase12-ui.ps1`.
Home, shaders, scene, connection, native CAD, Desktop and MCP product sources
were unchanged by this packet. The entire dirty worktree baseline was preserved.

## Execution and corrections

Separate task `01a154fa-9275-7ef3-8112-3c8dced88690` implemented the initial cleanup.
Its runtime metadata confirms `gpt-6-luna`, effort `max`. The parent inspected the
actual baseline-relative diff and performed verification. The correction turn failed
with `You've hit your usage limit ... try again at 10:13 PM` (timezone unspecified).
The parent completed corrections under the user's explicit quota fallback.

The initial worker SourceOnly branch returned before the older geometry checks.
The parent removed that bypass, retained action identity/callback checks, modal and
stale-scene guards, panel bounds/intersections, authored hitbox validation wiring,
legacy slot checks and physical placement checks. Only checks demanding the removed
decorations/fact shelves were revised. Both script modes now share the complete
static preflight; SourceOnly returns immediately before Unity execution.

The initial new test also counted visible headings while its page was inactive.
The parent activates each tested page and checks only visible modal panels.
No callback, hitbox or stale-state test was disabled to accept the visual change.

## Parent verification

QA: `C:/Users/matte/Documents/Codex-tools/Native/quest-operational-minimal-20261019`.
All commands ran against `C:/Users/matte/Desktop/Saas/Kreoda-phase10-ci`.

- Worker RED: the original PC summary had eight visible surfaces instead of two.
- Initial parent focused Unity run: **98/99 passed**, one new test failure caused by
  the inactive-page test setup above. The other suites passed: connection 25,
  environment 2, Home 16, Home HUD 1 and thickness formatter 7.
- Final `node <QA>/run-unity.mjs controls-release Kreoda.QuestRuntime.Tests.QuestControlsTests`:
  **49/49 passed**, zero failed/skipped, direct exit 0. Includes original controller-free
  hand/pinch, drag, tracking/focus loss, numeric input and modal reference checks;
  adds visible-layer, result/voice duplication and reference-title checks.
- `pwsh -NoProfile -File scripts/verify-quest-phase12-ui.ps1 -SourceOnly`: exit 0;
  113 actions, 105 construction call sites, 37 panel rectangles, zero bounds violations
  and zero nonmodal panel intersections. This is static evidence; the actual authored
  Unity geometry validators also execute in the controls tests.
- `node <QA>/capture-release.mjs`: exit 0; **13 actual Unity GPU renders**, all manifest
  hashes match, no shader/C# error, null reference or assertion error. All page types
  were inspected; final result, voice, references and workspace were inspected again
  after the parent corrections. `ui-release` is the final artifact set.
  These are offline Editor scene reconstructions, not headset photographs or a live
  PC/voice session. The thickness result uses the previous real-native fixture and
  actual Quest formatter, preserving its sampled/non-global limitation.
- Scoped `git diff --check`: exit 0.
- `node scripts/build-quest-client.mjs --unity <Unity6000.3.25f1> --sdk <AndroidSDK> --output <QA>/arm64`:
  direct exit 0, **Succeeded**, zero errors, five warnings. Three warnings are unused
  null compatibility fields for removed visual readouts; the other two are existing
  build warnings. No source changed during the guarded build.
- APK has only `arm64-v8a` native libraries. Final comparison of **923 product files**
  against the guarded build source manifest has zero changes.

## Installed artifact

Quest 3 `2G0YC1ZFB8043H`, package `com.kreoda.quest`:

- Previous installed APK backed up as `quest-before-update.apk`, SHA256
  `8ef4682a69954e35088b92002298945a8688be4d86215145657532955956dcdd`.
- `adb install -r` returned **Success**, preserving app data.
- One normal activity launch returned **Status: ok / COLD**.
- Installed `base.apk` pulled back and matched the guarded artifact exactly:
  `f22f6535d780498a4673ac8d178ebb6d37c5292d8552d917fc1333f6255ef004`;
  **43,681,545 bytes**.
- Bounded current-process log: PID 25159, no selected fatal/null-reference marker;
  no fresh `KREODA_CONNECTED` marker. Launch/hash checks do not establish physical
  usability or a current LAN connection.

Desktop PID 29692 and local MCP bridge PID 35604 remained running with window
handles zero. No foreground PC window, headset wake/proximity/Guardian override,
SSH, Tailscale, Hermes inference, STT/TTS request or remote restart was used.

## Remaining acceptance and full goal

Fresh in-headset passthrough visibility, comfort, hand tracking, performance and LAN
acceptance remain open; the earlier off-face room-localization gate was not overridden.
This packet does not complete Phases 12–16. General surface bodies/operations,
remaining assembly relations, general direct editing and the live Hermes/voice
benchmark remain in the active full goal. No commit, push, hosted CI or release claim.
