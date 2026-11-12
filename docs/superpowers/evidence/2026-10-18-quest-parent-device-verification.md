# Quest UI and automatic LAN — parent verification, 2026-10-18

## Scope and provenance

Current dirty worktree `Kreoda-phase10-ci`, base `7b196638a84e4caaeea05a707d94038011e4ba33`.
Concurrent Phase 12–16 work was preserved. Luna and fresh reviewer lanes exhausted quota;
the parent continued under the user's explicit fallback. No new independent review verdict.
Hermes, SSH, Tailscale, image generation, STT and TTS services were not invoked.

## Corrections verified in the parent

- Actual Unity construction exposed two corrupted action-routing comparisons. Restored the
  accented physical-properties action and the minus-five scale action without changing callbacks.
- Fixed the factor-of-two error in workflow vertical positions; bounded all 108 action slots
  to their measured content. Adjusted reference-form sections to separate live labels and targets.
- Removed duplicate readout decoration, retained canonical state text, enlarged tiny button
  typography and kept readable Italian page titles separate from internal page identities.
- Pointer decoration tolerates Android stripping its unused collider; the original device-only
  null reference was reproduced in the first installed build, then corrected.
- Fixed the actual Android transport failure in the linker configuration: anonymous JSON
  payload getters had been stripped, so discovery transmitted `{}`. Preserve the SessionClient
  and QuestFoundation assemblies, including bootstrap, identity-proof and voice payload types.
  The temporary unicast/native-network experiments were removed; normal LAN discovery works.
- An unreachable legacy setup can enroll the unique discovered PC with a fresh credential and
  installation identity. A reachable legacy PC retains its existing trust path. Active identity
  is replaced only after authentication and a valid snapshot.
- Desktop supports `--start-hidden` with the normal LAN service. Updated the existing UX
  shortcut while retaining its original profile. Backups and copies remain outside the repo.

## Evidence

Private QA directory: `C:/Users/matte/Documents/Codex-tools/Native/quest-current-parent-20261018`.

- Desktop build passed; Vitest **353/353**. Packaged hidden Electron + actual OCCT 8.0.1-native
  + managed discovery/bootstrap/identity proof/auth/snapshot/reconnect passed with zero manual inputs.
- Desktop installed at the existing firewall-authorized path; **119 files hash verified**;
  original program and UX profile backed up. No foreground window was opened.
- Final SessionClient **161/161** (`session-product-final.trx`). Temporary fallback tests were
  removed with the unused experimental implementation. Original discovery API is unchanged.
- Unity suite `editor-green.xml`: **159/159** before the device/network corrections.
- Unity suite `editor-discovery-final.xml`: **159/160**; remaining new legacy test expected one
  HTTP attempt. Corrected its contract to permit retries while requiring one fresh credential,
  one installation identity and a successfully committed PC identity. Focused rerun
  `legacy-offline-final.xml`: **1/1**. All other 159 tests passed against the same product sources.
- Latest UI/controls/saved-scene subset **48/48** (`ui-current-final.xml`), including the automatic
  pairing notice, hand-input routing and the repaired layout.
- Thirteen real offscreen Unity captures and hash manifest, no blank images or collider-overlap
  errors. These are reconstructed UI views, not passthrough or in-headset screenshots.
- Physical Quest 3 initially reproduced zero accepted discovery responses despite a successful
  direct UDP reply. A PC packet listener then observed length-two payloads with zero JSON keys,
  confirming `{}` rather than a Wi-Fi filtering problem. Logs confirmed passthrough initialization.

## Hardware follow-up

- Final APK: `apk-linker-final/KreodaQuest.apk`, SHA-256
  `1b4937d04b4d545648b3d5acb18f9fa80c104ca02c42f96670c092db691aab52`.
  Canonical managed staging + IL2CPP ARM64 + Gradle: direct exit **0**, **0 errors / 2 warnings**,
  source changes during build **none**. `adb install -r` returned **Success**.
- Actual Quest 3 `2G0YC1ZFB8043H`: first boot discovered one PC, retried the obsolete legacy
  endpoint, enrolled automatically, received a valid empty-document snapshot, then emitted
  `KREODA_CONNECTED` at **19:02:01.605 Europe/Rome**. No code, IP or approval input.
- Force-stop + cold relaunch reused persisted identity: `peers=1 known=True legacy=False`,
  followed by `KREODA_CONNECTED` at **19:02:44.521**. No null-reference or fatal exception.
- Actual TCP session **192.168.1.7:52416 ↔ 192.168.1.11:53480**, exactly **one** stored device,
  Desktop main-window handle **0**. Evidence: `device-lan-connected.json`,
  `device-reconnect-proof.json`, scoped application logs. No ADB reverse tunnel was used.
- Temporarily kept the headset awake using the documented
  [Meta development command](https://developers.meta.com/vr/documentation/unity/meta-xr-operator/quest/),
  then restored physical proximity control with `automation_disable` (broadcast result **0**).

In-headset comfort and real hand tracking still require observation while the headset is worn;
ADB launch, render captures and automated input-routing tests do not establish those properties.
