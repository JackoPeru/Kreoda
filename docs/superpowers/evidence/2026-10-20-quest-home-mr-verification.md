# Quest Home MR and automatic connection — verification, 2026-10-20

## Delivered scope

Implementation: separate Codex task `01a15953-d23e-7551-9a09-20781879cbce`, verified `gpt-6-luna` / `max`. The user explicitly requested continuing with Luna after its first quota failure; Luna resumed and made every product code change. The parent inspected diffs and performed independent verification, packaging and installation.

- Home follows the Desktop hierarchy: floating center wordmark and taglines, recent projects on the left, quick actions on the right, action dock below. Existing rounded neutral glass and the passthrough opening remain. There is no video/GIF or center backdrop.
- Duplicate PC status and task shelves are removed. Offline guidance and empty server results no longer appear as project cards or an updated project list. Source-state flags distinguish actual server projects from observed documents and offline guidance.
- Quick actions invoke actual Quest routes. Desktop project creation/import/templates have explicit contextual notices; their old action IDs remain safe. A pending thickness result cannot overwrite these notices.
- Existing LAN discovery automatically selects a unique PC or reconnects to its known stable identity. Multiple available PCs use names for selection. The normal flow requires no IP or pairing code. Per-PC credentials and identity proof remain intact.
- A connection race was corrected in `QuestConnection.cs`: initial snapshot capture now follows successful credential commit and publication of the authenticated client, before the Connected notification. Previously a frame could discard the snapshot while the client was still null.

Actual product diff versus captured preimages: `QuestHome.cs`, `QuestHomeProjectData.cs`, the Home routes/state call in `QuestControls.cs`, `QuestHomeTests.cs`, one parameterized Home test in `QuestControlsTests.cs`, and the snapshot ordering in `QuestConnection.cs`. `QuestPcCredentials.cs`, `QuestConnectionTests.cs`, global UI helpers, shaders, scene assets, packages, Desktop and native CAD sources were preserved.

## Independent evidence

External evidence directory: `C:/Users/matte/Documents/Codex-tools/Native/quest-home-mr-20261020`.

| Check | Actual result |
| --- | --- |
| Desktop discovery and device tests | 16/16 passed |
| Managed SessionDiscovery tests | 7/7 passed, 0 skipped; TRX recorded |
| Production private-interface UDP discovery | PC-Matteo discovered at its stable PC ID; 0 pair requests and no credential transmission |
| UI source preflight | Passed; its source-only limits are explicit in the log |
| Final parent Unity five-class run | 105/105 passed, 0 failed/skipped; direct Editor exit 0 |
| Unity GPU capture | 13 page files match manifest hashes; no shader/compiler/null/assert/fatal error markers |
| Visual inspection | `ui-release/home.png` inspected: central identity, separated glass panels, no overlapping visible text or fake offline project rows |
| Frozen build inputs | All 1,711 source hashes match the canonical build inputs; no source changed during the build |
| Canonical Android build | Succeeded, 0 errors, 7 warnings, pinned Unity 6000.3.25f1 |
| APK metadata | Only `arm64-v8a`; hand tracking, hand permission, passthrough and contextual passthrough loading present |

The initial combined run was 104/105: the lost-bootstrap test observed zero discovery peers after its intentionally dropped acknowledgement. It passed in isolation and subsequent Connection runs. A separate pre-fix Connection run was 25/26, reporting Connected with zero mesh views; code inspection identified the snapshot race above. After Luna's correction, the USB mesh regression passed 1/1 with the actual 264-triangle fixture, Connection passed 26/26, and the parent's final combined run passed 105/105. Earlier failed logs/XML remain preserved; the final pass does not establish that UDP delivery can never be intermittent.

Warnings include existing unused UI compatibility fields, obsolete Meta focus configuration, native compiler arguments and duplicate manifest permission declarations. No unrelated warning cleanup was applied.

## Installed device

- Quest 3 serial: `2G0YC1ZFB8043H`; package: `com.kreoda.quest`.
- Prior APK backed up twice and revalidated before installation: SHA-256 `21873d67aa57551bee90e0e65781271d4cce413ef1c7658e4d503c2cceddce73`.
- New APK: 43,690,525 bytes; SHA-256 `469a1613210c62d61fce52e4a56ed92aed6c8ffdf4c8021cfbfda4551899e555`.
- `adb install -r` succeeded. No uninstall or data clearing occurred. Private credential files were not inspected or copied.
- Normal activity launch returned `Status: ok`, `LaunchState: COLD`; PID `6642`.
- Installed base APK was pulled back and its SHA-256 exactly matched the build.
- Bounded startup logs contained no fatal marker. They contained no fresh Connected/model marker, so they do not prove a live headset connection or visible geometry.

GPU evidence is an offline Unity Editor reconstruction, without a physical XR device or passthrough image. Physical MR appearance, hand comfort, performance and live Quest-to-PC acceptance were not revalidated. No headset wake, proximity or Guardian override was used. The Desktop process remained hidden. Hermes, SSH, Tailscale, AI/STT/TTS services and the stopped MCP bridge were not contacted or restarted.

This completes this verified Quest UI increment. The broader CAD roadmap goal remains active; no hosted CI, release, or whole-project completion is claimed.
