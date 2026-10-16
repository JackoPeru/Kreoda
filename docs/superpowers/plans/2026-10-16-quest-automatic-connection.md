# Quest automatic local connection implementation handoff

Required next packet for the user steering in ../specs/2026-10-16-quest-passthrough-home-autoconnect.md. This is architecture and inspected ownership, not an implementation claim. Dispatch only after active projection session worker01a14525-18cd-7c62-98ca-173d0e064fd5 finishes and parent hands off shared relay/managed ownership.

## Inspected seams

PC main.ts owns SessionDevices storage and SessionRelay lifecycle. SessionDevices.beginPairing currently rotates one human-code token; pair() creates/persists trusted credentials and authenticate()/hello reuse them. Factor shared credential creation for automatic local pair, without making the generic relay unauthenticated or resetting device stores. A new dedicated discovery/bootstrap module can receive the devices service and relay lifecycle callbacks from main.ts; relay session/query/mutation semantics remain authoritative.

QuestConnection.cs currently reads private kreoda-device.dat, reconnects saved credentials, otherwise requires Pair(endpoint,code). It owns cancellation/generation and frame-thread posting. Integrate discovery into this single lifecycle, not a second racing connection loop. New bounded C# discovery transport/state can live in SessionClient or QuestFoundation after exact public interface is chosen from actual completed runtime code. Keep SessionClient typed query freshness and existing netstandard2.1 compatibility.

## Planned files, to finalize before dispatch

PC apps/desktop/electron/{session-discovery.ts,session-devices.ts,main.ts}, focused tests/session-discovery.test.ts plus device/lifecycle tests. session.ts only for a specifically justified public lifecycle seam. Shared schemas/generator/generated TS/C# only if the discovery protocol is placed in the existing contract; no unreviewed duplicate constants.

Managed clients/session-dotnet/src/Kreoda.SessionClient/SessionDiscovery.cs with focused tests; Quest runtime/{QuestConnection.cs,QuestDiscovery.cs} and AndroidManifest.xml networking permissions only if actual API needs them, plus focused Editor tests. Do not edit QuestControls/QuestHome concurrently with UI worker; use its completed current status/home interface after handoff.

## Required work

1. Freeze version1 UDP request/reply, private-LAN endpoint rules, nonce/PC stable identity, <=4096-byte packet and <=8192-byte auto-pair body limits; no credentials in discovery packets. Same machine/IP changes rediscovered by PC ID. Implement deterministic one/none/multiple-PC selection and expiry/retry/cancellation as pure tested logic.
2. PC starts automatic LAN service when app is ready, publishes only assigned private endpoints, stops all owned sockets/timers on exit/disable. Test mode defaults to no real LAN advertising, explicit loopback test injection. Automatic pair reuses existing persisted trust path. Revocation is not silently undone.
3. Quest starts discovery without saved input, tries matching saved PC first, otherwise unique compatible PC; performs automatic bootstrap then normal credential auth/hello/snapshot. Persist endpoint and stable PC identity with backwards-compatible saved-device migration. Offline state remains Home with readable status; network loss/restart recovers automatically.
4. Wire actual Home PC status/name and available project/session data/actions into the UI. No fake Desktop demo filenames or silent new-document data loss. If current PC recent/import/template functionality is missing, implement its real shared Home contract/actions as a bounded follow-up; do not claim parity from inert buttons.
5. Real loopback discovery/bootstrap/session proof with zero manual inputs, then hidden Electron integrated proof; test network-interface change, multiple PCs, expiry, bad versions/non-private addresses, endpoint spoofing, oversize messages, cancellation/restart and revocation. Meaningful separate managed TRX and Desktop tests/build/lint. Final source-stable Editor/normal ARM64 only after both UI and transport workers terminal.
6. Parent independently verifies actual diff/proof and fresh accumulated review per full route; exact accepted-head CI afterward. No physical/LAN/comfort acceptance until permitted. No Hermes/server probes, ADB, mic/audio or foreground UI.

## Implemented parent packet

After the selected UI Luna task terminated with an actual usage limit, the user-authorized parent fallback implemented the PC/managed/Quest network packet directly. Exact product ownership: Desktop electron/{session-discovery.ts,session-devices.ts,main.ts}, tests/{session-discovery.test.ts,session-devices.test.ts}, e2e/quest-automatic-connection.spec.ts; SessionClient/SessionDiscovery.cs and its focused tests; McpProbe/Program.cs for real automatic client proof; Quest runtime/{QuestConnection.cs,QuestControls.cs}, existing Editor tests/{QuestConnectionTests.cs,QuestHomeTests.cs,QuestSceneTests.cs}; QuestUi.shader for the fresh review's required stereo correction. No native/session-wire schema changes or Android permission additions were needed.

Actual checks and remaining limitations are in ../evidence/2026-10-16-quest-automatic-connection/PARENT-VERIFICATION.md. Full Home project/task data/actions and multi-interface LAN proof remain follow-ups. This packet does not finish the overall request or full Phases12–16.

Fresh review required correction of legacy identity migration. Additional exact test ownership: existing QuestWireFixture.mjs for loopback UDP/HTTP/two-PC identity proof and the actual QuestConnection reconnect tests. Native /identify verifies existing device trust without sending a credential to an unverified discovered address. Corrected product/proof is in ../evidence/2026-10-16-quest-automatic-connection/trust-correction/VERIFICATION.md; no unrelated Desktop projection worker files belong to this packet.
