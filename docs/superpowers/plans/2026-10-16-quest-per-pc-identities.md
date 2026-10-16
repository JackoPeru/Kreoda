# Quest per-PC identities and transactional switching

## Reason

Fresh review of bde8c54 found that explicit switching to PC B reused A's secret and replaced the active saved record before B finished session authentication/snapshot. Correct both with separate per-PC pending/trusted records. Review also interpreted revocation as a permanent physical-device ban; the user explicitly accepts initial security limitations and requires zero-code automatic enrollment. Updated passthrough/autoconnect spec makes the private-LAN enrollment policy explicit: revoked current credentials/installation IDs stay rejected, but a deliberate reset/new installation can enroll as a new principal. No PC consent/code or hardware-ban claim is added.

## Ownership and architecture

Selected Luna owns QuestConnection.cs, minimal new QuestPcCredentials.cs if needed plus .meta; existing QuestConnectionTests.cs and QuestWireFixture.mjs, minimal new focused credential-store Editor tests/.meta, evidence/2026-10-16-quest-per-pc-identities/. Existing version1/2 active credential file remains readable. Prefer a bounded separate private binary cache of per-PC credentials/pending identities, using atomic replacement, rather than rewriting the session protocol or introducing a database. No PC/electron/shared-schema/native/managed product edits. Another Luna owns Desktop projection files; preserve them. Parent owns policy/spec and independent gates/review.

## Required behavior

1. Per stable PC ID, create and persist a fresh random secret and installation ID before that PC's bootstrap. Never reuse another PC's secret/installation identity. B retries use the same pending identity after a lost acknowledgement/restart.
2. Keep A as the active saved record until B completes existing authenticate/hello and a valid snapshot. Authentication/transport/snapshot rejection, timeout, cancellation, generation change, storage error or app restart must leave A's record intact. No late B completion can replace a newer selected PC.
3. Cache successful A/B records so switch-back reuses A's original identity. Verify existing trust before using a discovered address. Preserve legacy migration and original-address fallback when only foreign discovery peers respond; never send credentials to unverified discovered peers.
4. Existing direct/manual Pair and provisioning compatibility remain in advanced diagnostics. Normal startup is automatic; no new codes/prompts or credential/UI logs. Forget/reset behavior must match the explicit enrollment policy, remove intended local secrets and preserve other PC/configuration records.
5. Cache/file versions, UTF8/string/count/size bounds, malformed/cache recovery, duplicate PC identities and atomic replacement failures are validated. A corrupt optional cache must not destroy a valid active legacy record. No unbounded lists or plaintext files outside the existing private Android app directory.

## Verification

Actual Editor wire flow with two distinct PC services: create/retain A, select B via actual SelectPc, verify B sees neither A credential nor installation identity, and B becomes active only after valid snapshot. Wrong/malicious B auth/snapshot must leave A saved; switch back reconnects A with original identity. Exercise cancelled/late B and pending bootstrap replay without duplicate identities; retain all13 existing connection cases and no-controller UI compatibility. Pure file corruption/bounds/atomic tests complement actual sockets rather than replacing them. Source-stable normal ARM64 after selected worker terminal. No GUI, device/ADB, server/Hermes/SSH/Tailscale, mic/audio/camera, commits/pushes, nested tasks/subagents. Full Phases12–16 remains open.
