# Hermes CAD connection lifecycle

Continue the original Phases 12–16 goal and the user's autonomous setup request.
Do not contact or restart busy Hermes, SSH, image, STT or TTS services. Local
loopback fixtures, the owned PC session service and hidden builds are allowed.
The separate requested GPT-6-Luna/Max task hit the usage limit on 19 October;
the parent uses the user's explicitly authorized fallback. No fresh review is claimed.

## Observed gaps

- PrivateCadConnection reads one fixed WebSocket URL. The actual saved legacy
  configuration points to loopback:9842; the active Desktop listens on dynamic
  LAN ports. Its old device ID is absent from the active profile. Never copy
  that old secret into a new PC profile.
- CadBridge caches a SessionClient indefinitely. A closed transport can leave
  Describe returning an obsolete model or further calls using a dead socket.
- Existing identity proofs cover PC/device/nonce but not the advertised host
  and ports. Relocation must authenticate the endpoint before reusing a secret.

## Design

1. Extend existing discovery identity proof with opt-in version 2, binding the
   server's actual host, session port and bootstrap port. Keep version 1 replies
   for older clients. New SDK verification requires version 2; it never sends a
   reusable credential in discovery or identification requests.
2. PrivateCadConnection records optional PC/bootstrap/installation identity.
   A known PC is pinned; recovery never selects another PC or invents a new
   credential after rejection/revocation. Legacy addresses retain their explicit
   configured fallback; discovered endpoints receive old credentials only after
   successful proof. Persist a relocated address only after authenticate/hello
   and a valid snapshot.
3. With no active configuration, enroll the unique or explicitly pinned local
   PC using a fresh agent credential and installation identity. Persist pending
   enrollment before bootstrap for lost-ack retries. Agent naming is explicit;
   do not reuse a Quest identity. The legacy production file remains backed up;
   deploy a separate fresh configuration for the verified active PC/profile.
4. Expose local transport readiness from SessionClient. CadBridge may discard
   stale cached clients and reconnect only outside request/voice ownership.
   Active requests must attempt rollback and preserve existing uncertain-state
   recovery fencing. No mutation or voice request is replayed after reconnect.

All waits and payloads remain bounded and cancelable. Preserve original files
and identities on failed authentication, snapshot, cancellation or persistence.
No addresses/codes are required from the headset or user.

## Verification gates

- [x] RED/GREEN endpoint-bound proof, old-client compatibility and false-port
      rejection using loopback HTTP/UDP fixtures.
- [x] RED/GREEN private connector: moved port, pinned PC absent, unrelated PC,
      legacy fallback, first enrollment, lost acknowledgement, cancellation,
      authentication/snapshot failure and durable commit order.
- [x] RED/GREEN cached-client replacement outside ownership; active/uncertain
      requests and voice scope cannot reconnect/replay silently.
- [x] Full affected TS/managed tests and hidden real Electron/native/MCP proof.
- [x] Guarded builds; update owned local service/client targets and prepare a
      fresh agent identity against the verified current PC without inference.
      Preserve existing configuration backups; do not disturb remote Hermes.

Live Hermes, voice and full benchmark acceptance remain separate open gates.
This packet cannot complete the full goal.
