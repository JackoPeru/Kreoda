# Quest Home and passthrough UI Implementation Plan

> For agentic workers: use executing-plans inline in the selected Luna worker. No nested tasks/subagents. Parent owns architecture, independent verification and review.

**Goal:** Build the requested clean spatial Home over passthrough, preserve controller-free workspace interactions.
**Architecture:** QuestHome builds the Desktop Home hierarchy as lightweight Unity world-space UI; QuestControls remains the actual hand pointer/pinch/panel owner. Shared minimal QuestUi styling avoids rewriting CAD features. Automatic network transport is a subsequent separate packet; existing SessionClient interfaces are read-only in this task.
**Tech Stack:** Existing Unity6/Meta OpenXR/OVRHand/C#; current material/font pipeline.
**Spec:** ../specs/2026-10-16-quest-passthrough-home-autoconnect.md

## Global constraints

Only hidden local tests/builds. No Hermes/server/SSH/Tailscale/AI, physical Quest/ADB, microphone/camera/audio or foreground windows. Human dirty checkout forbidden. Another worker owns relay/protocol/managed/MCP; preserve its changes. No commits/pushes/nested delegation. UI work must not claim automatic connection implemented before the network packet. No code/endpoint input in normal Home flow.

## Exact ownership

- clients/quest-unity/Assets/Kreoda/Runtime/{QuestControls.cs,QuestEnvironment.cs,QuestHome.cs,QuestUi.cs} and new .meta.
- clients/quest-unity/Assets/Kreoda/Materials/{Panel.mat,Buttons.mat,Ray.mat,QuestUi.shader} and necessary new .meta. Inspect actual material filenames; request exact amendment before another asset.
- clients/quest-unity/Assets/Kreoda/Editor/QuestBuild.cs and minimal QuestHomeRender.cs +.meta for offscreen QA.
- clients/quest-unity/Assets/Kreoda/Scenes/KreodaQuest.unity saved wiring, preserve all non-UI scene content.
- clients/quest-unity/Assets/Kreoda/Tests/Editor/{QuestControlsTests.cs,QuestHomeTests.cs,QuestEnvironmentTests.cs,QuestSceneTests.cs} plus new .meta.
- docs/superpowers/evidence/2026-10-16-quest-home-ui/.

QuestConnection.cs, SessionClient, schema, Desktop and CAD runtime are read-only. If a concrete small seam is required, request parent amendment with exact signature/file before editing. No runtime network discovery in this UI packet. Home status uses existing Connection state and a small UI-facing adapter if needed, without inventing fake PCs/recents.

## Review focus

- Existing stored VR preference must not hide passthrough on next normal launch.
- Loss/recovery of hand tracking must not produce accidental clicks or leave a panel grabbed.
- Dense existing pages must remain accessible through contextual sheets, not disappear in the redesign.
- UI materials must genuinely blend over the room, and text must remain readable over varied backgrounds.
- New actions must not silently destroy an unsaved PC model or present demo recent projects as actual files.

## Task 1: Home, styling and progressive disclosure

- [ ] Read actual Desktop Home components and current QuestControls pointer/panel/page flow; enumerate real actions and currently unavailable Home data.
- [ ] Add meaningful failing Editor tests for default Home, visible labels/actions, contextual workspace/page reachability and text/button bounds.
- [ ] Implement minimal QuestHome/QuestUi and integrate with QuestControls. Home always appears first; normal connection UI is status only, advanced manual diagnostics hidden. Use same actual hand ray/pinch click and header drag; no parallel input system.
- [ ] Preserve all existing selection, datum, section, two-hand, numeric keyboard and voice routes. AI action opens voice page; no recording/playback during tests.
- [ ] Use real empty/loading states for unavailable recents/tasks and explicitly report remaining PC Home data/action integration; do not mark whole requested feature complete from a UI shell.
- [ ] Run Editor UI tests and existing relevant hand/control regressions; zero failures/skips, real nonzero discovery. Measure both short and long labels against actual generated bounds.

## Task 2: Passthrough startup and saved scene

- [ ] Add failing preference migration test, then force normal startup preference to MR while retaining honest fallback diagnostics.
- [ ] Update Prepare wiring and the actual saved scene/assets in place. A normal saved-scene build must contain Home and styling without calling Prepare at build time.
- [ ] Generate offscreen Home/workspace PNGs with an explicit neutral stand-in background, inspect them for overlap/spacing/contrast. Label renders as UI proof, not physical passthrough proof. No screen capture or foreground Unity editor.
- [ ] Record authored Unity source hashes before/after Editor checks. Another worker mutates managed sources, so defer integrated ARM64/source-wide immutable proof until parent authorizes it after that worker is terminal. A UI-only Editor pass cannot prove integrated APK.
- [ ] Return actual changed files, commands, counts, render paths and gaps. No native/runtime/server/device acceptance claim. Parent verifies before acceptance and queues automatic discovery + real Home data/actions.

## Inspected test ownership amendment

QuestSceneTests.cs is explicitly included for saved Home component/material wiring. Preserve all prior scene/input/shader/ARM64 assertions; ordinary saved-scene startup is verified without Prepare.
