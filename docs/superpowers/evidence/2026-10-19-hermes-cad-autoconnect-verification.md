# Automatic CAD connection for Hermes MCP — 19 October 2026

## Delivered scope

The existing Quest Home request is present in the installed client: Desktop-like
navigation and project/action islands, neutral translucent rounded surfaces,
open central passthrough, no video/GIF/background scene, automatic LAN discovery
and enrollment. One PC connects automatically; multiple PCs are selected by name.
Controller-free input routes remain present. This packet also finishes the
previously reproduced local MCP connector lifecycle defects.

The full Phases 12–16 goal remains active. General surface operations, minimum
thickness, broader assembly/direct editing, full benchmark/live voice acceptance
and physical Quest comfort/hand acceptance are not completed by this packet.

## Changes

- Desktop `/identify` supports opt-in proof version 2. Its HMAC binds actual PC,
  device, nonce, host, session port and bootstrap port. Old clients retain v1.
  This authenticates endpoint metadata with saved trust; it does not provide TLS
  or hardware attestation.
- SessionDiscovery requires v2 before a new client sends an existing credential
  to a rediscovered endpoint. Automatic enrollment accepts the explicit agent name.
- PrivateCadConnection uses the existing discovery/bootstrap protocol. Known PC
  identity is pinned; unrelated/unproven peers never receive its credential.
  Legacy configurations migrate only after proof, retaining their explicit old
  endpoint fallback when discovery is quiet. Configuration reads are bounded.
- New MCP enrollment uses its own credential, installation ID and logical client.
  Durable pending state precedes bootstrap, so lost acknowledgements/restarts
  reuse the same identity. Rejection cannot silently mint a replacement. Endpoint
  changes commit atomically only after authenticate/hello and a valid snapshot;
  cancellation/failed activation preserves the previous active file.
- Program accepts optional `KREODA_CAD_PC_ID` for deterministic selection.
- CadBridge discards disconnected cached clients only outside request/voice
  ownership. Active rollback uncertainty retains its existing durable fence;
  requests are not replayed into another document. Voice must end before reconnect.
- Quest wire fixtures now answer opt-in v2 correctly; the managed plugins and
  final ARM64 client were rebuilt together. No Home redesign or new dependency.

## Executed verification

QA: `C:/Users/matte/Documents/Codex-tools/Native/phase14-mcp-autoconnect-20261019`.

- Original connector RED: 8/8 failures from the fixed URL/no automatic enrollment.
  First green attempt exposed incorrect fixture envelope access; fixed fixture
  uses actual `params`. Cancellation test asserts the SDK's `CANCELLED` contract.
- Full HermesBridge: **66/66**, zero failures/skips, direct exit 0. Twelve connector
  cases cover relocation, unrelated/false identity, real WebSocket auth rejection,
  bad snapshot, fresh enrollment, lost ack, legacy migration/quiet fallback,
  absent pinned PC, cancellation and durable pending identity after failed activation.
- Full SessionClient: **171/171**, zero failures/skips, direct exit 0. Includes
  endpoint-bound proof and refusal of legacy proof for another advertised port.
- Desktop discovery/devices: **16/16**, direct exit 0; includes v1 compatibility.
- Hidden real Electron + OCCT + managed/MCP E2E: **2/2**, direct exit 0. The agent
  automatically enrolls, exposes seven actual MCP tools and project resource,
  queries native schema/model, then reopens the same PC profile on a different
  port and session with identical device/installation/logical identity/credential.
  The second document has zero old features, rather than a cached prior model.
  A separate automatic Quest SDK path also connects and reconnects without input.
- Fresh existing UI verification before managed update: Home, HomeHud,
  environment and connection tests **44/44**. Installed prior APK was pulled and
  hash checked; 165 Quest assets/plugins matched its source manifest exactly.
- After staging the new managed SDK, Quest connection tests **25/25**, zero
  failures/skips, direct exit 0. No physical gesture acceptance is inferred.
- Desktop TypeScript/Vite build and Forge package succeeded. Final source guard:
  **1683 files, changes []**. A guard sampled during the concurrent Unity build
  observed four transient Meta-generated/settings files; after Unity exited,
  they were automatically restored and the guard passed. No manual restoration
  or source change was needed, and no Desktop input changed.
- Canonical ARM64 build: direct exit 0, **Succeeded, 0 errors / 2 warnings**,
  source changes **[]**, only `arm64-v8a`. Final 914 product source files match
  the APK build manifest. Scoped whitespace check passes.

## Current local installation

Desktop remains at the established firewall-authorized path:
`C:/Users/matte/Documents/Codex-tools/kreoda-phase12-pc-20261010/kreoda-win32-x64`.
Original program and original UX profile were backed up in QA. No Desktop
process was running when copied. All **119 installed files** match the package;
the device profile was identical before/after copy. Hidden startup PID **28608**,
window handle **0**, actual OCCT sidecar ready, LAN session `192.168.1.7:51893`.

- asar: `2d92d80e8c1cbda992cb527d0dc71b17d7e93789cd171ff2818882b4bc9a5b46`
- native: `e30b896982a05bb295316b82e090833a9921271b2258ef04edb1d25274a2252f`

Quest 3 `2G0YC1ZFB8043H`, `com.kreoda.quest`: `adb install -r` **Success**;
normal launch **ok/COLD**. Pulled installed base APK matches the guarded build:
`ef578fcde8a6633bc5c13abb753d9aa2edc34c2a0b4195b1ad6e1c25d3808e5a`,
**43,690,633 bytes**. Previous APK backed up. No proximity override or Guardian
change. Current-PID bounded log has no fatal marker and no fresh connected marker;
the previously observed off-face room-localization gate is not resolved or bypassed.
Installation/Editor rendering do not prove physical passthrough/comfort/hand use.

Local bridge published to
`C:/Users/matte/Documents/Codex-tools/kreoda-hermes-integration-20261019/bridge`,
PID **7196**, loopback `http://127.0.0.1:9843/mcp`. Actual MCP preflight returns
**ready, tools 7**. Automatic enrollment against the running normal PC succeeded
using new `cad-device-34669a1f-68fa-4153-b0c1-916a24a15a2f.json` in that directory.
The store now has two devices; original Quest record is unchanged, and the new
`Hermes Kreoda MCP` credential differs from both Quest and legacy agent credentials.
Legacy 11 October configuration remains in place, last written 11 October.

Voice configuration is loaded from existing private files. No voice endpoint,
Hermes/SSH/Tailscale/inference/STT/TTS service was called, and no remote process
was restarted. This is local MCP readiness; external Hermes availability and
complete voice roundtrip remain separate gates. The bridge is currently running;
no reboot/login persistence claim is made.

## Routing and preservation

Created separate GPT-6-Luna/Max task `01a153ce-79ad-75d3-a672-dcc9874a195c` as
requested. It failed with the actual usage-limit error; parent continued under
the user's explicit fallback. No fresh independent review, commit, push or
latest hosted CI result. All unrelated concurrent dirty work is preserved.
