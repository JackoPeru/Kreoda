# Quest minimal Home — 19 October 2026

## Request and delivery

Retain the Desktop Home structure over the real room, remove the animated
background, simplify the Quest UI and connect to the PC automatically on LAN.

The existing passthrough startup and automatic discovery/enrollment/reconnect
remain in place. One compatible PC is selected automatically; ambiguous PCs
are selected by name without an address or pairing code. Normal Home has no
manual pairing inputs. The earlier physical LAN proof is recorded separately
in `2026-10-18-quest-parent-device-verification.md`.

This follow-up corrects the remaining visual clutter:

- `QuestHome.cs`: KREODA wordmark; neutral headings; removes nested glass wells,
  recessed sockets, ambient rails, duplicate backing surfaces and decorative
  dock rings. Retains the Desktop arrangement, actual projects/session state,
  routed actions and the open central view of the room.
- `QuestUi.cs`: neutral translucent surfaces and restrained blue accents;
  one rounded card instead of stacked bezels; removes launcher accent rails.
- `QuestUi.shader`: removes artificial reflections, spectral bands and bevels.
  Keeps rounded alpha coverage, a faint hairline, transparency and stereo
  instancing. No scene background, video or camera texture is introduced.
- `QuestHomeTests.cs`: updates the expected visible wordmark to KREODA.

Actual available Home actions retain honest labels. New project creation,
import and templates are not invented as local Quest operations; existing PC
catalog/open and diagnostic routes retain their established behavior.

Concurrent work was preserved in `Kreoda-phase10-ci`. Luna/reviewer quota was
already exhausted; the parent continued under the user's authorized fallback.
No new independent review, commit, push or hosted CI result is claimed.

## Verification

Private QA directories:

- `C:/Users/matte/Documents/Codex-tools/Native/phase15-quest-zebra-20261019`
- `C:/Users/matte/Documents/Codex-tools/Native/quest-minimal-home-20261019`

Results:

- Unity Editor focused suite: **91 passed, 0 failed, 0 skipped**, direct exit 0.
  `minimal-home.xml` covers Home, controls, environment and connection tests,
  including controller-free pinch routes, tracking/source handoff, automatic
  enrollment, per-PC isolation and saved trust. The final shader refinement was
  subsequently GPU rendered and built for Android.
- Final `ui-minimal-flat` capture: **13 actual Unity UI renders**, all manifest
  hashes match. No shader/C# error, null reference or assertion error in the
  capture log. Home, PC picker and section captures were visually inspected.
  These are offscreen Editor views, not physical passthrough photographs.
- Source-only preflight passes: 111 actions, 37 semantic rectangles, zero
  out-of-bounds rectangles or nonmodal zone intersections. This static gate
  supplements the executed Unity geometry/input tests.
- Scoped `git diff --check`: exit 0.
- Canonical `scripts/build-quest-client.mjs`: **Succeeded**, direct exit 0,
  **0 errors / 2 warnings**, no source changes during the guarded build;
  APK contains only `arm64-v8a` native libraries.

## Physical installation

Quest 3 `2G0YC1ZFB8043H`, package `com.kreoda.quest`:

- Previous installed APK backed up as `before-update.apk`:
  `1b82e30c0c38fa04b267e47c55806bfbafb0a76bedbcc7bf723c61ac9537e19c`.
- `adb install -r` returned **Success**, preserving app data.
- Normal activity launch returned **Status: ok**, **LaunchState: COLD**.
- Pulled the installed `base.apk` back from the device and verified its hash
  equals the new build:
  `12fd23a1c6115a707fe9d7a6a7999ba77e11302dce6b84f45f57d399e58f3a48`.
  APK size: **43,669,501 bytes**.

No wake/proximity override, Guardian setting change or foreground PC window
was used in this follow-up. The system focus query returned no resumed
activity. No new in-headset comfort, live hand-tracking, passthrough visibility
or fresh physical LAN connection is claimed from installation and Editor tests.
The earlier room-localization gate is documented in the zebra report.
No Hermes, SSH, Tailscale, AI, STT or TTS service was contacted.
