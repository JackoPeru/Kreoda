# Hermes, CAD MCP and Quest voice

Hermes retains its planning, memory, tool loop and policy. Kreoda exposes the PC's authoritative CAD document through the official MCP C# SDK and existing authenticated SessionClient. Voice uses the actual Hermes `/v1/runs`, transcription and speech endpoints; it does not call the underlying LLM directly.

## Interfaces

- Streamable HTTP `/mcp`: project context, committed model description, canonical read-only queries, bounded request begin, command, measured commit and cancellation.
- Resource `kreoda://project` and tool `kreoda_project_context` describe the project even when CAD is disconnected.
- Creation counts and parameter constraints come from the PC registry. Stable ID JSON Schema comes from the canonical session contract, including opaque runtime-validator fields.
- A request owns one transaction and one Undo group. Checks are captured before mutation. Actual B-Rep validation and all numeric checks must pass before commit. Idle requests expire. Lost commit acknowledgement reuses the original operation ID; unresolved outcomes are explicitly uncertain.
- Voice requests carry the Quest session/document/revision and `voiceRequestId`. Pass that ID as `originRequestId` to the CAD begin tool. Unfinished voice-owned CAD requests roll back when the voice HTTP turn ends or is cancelled; late origins and unrelated requests cannot reuse ownership.

## Private deployment

The bridge binds an explicitly supplied loopback address. A private SSH reverse forward exposes its MCP endpoint on the Hermes server's loopback interface. The companion Desktop must run the current registry and session service. Do not expose an unauthenticated MCP listener on the public network.

Environment configuration:

| Name | Purpose |
|---|---|
| `KREODA_HERMES_BRIDGE_URL` | Explicit loopback HTTP listener |
| `KREODA_CAD_DEVICE_FILE` | Absolute private device credential file outside the repository |
| `KREODA_CAD_SESSION_URL` | CAD WebSocket address for initial pairing |
| `KREODA_CAD_PAIR` | One-use bootstrap pairing value, held privately |
| `KREODA_HERMES_CONFIG` | Private JSON containing gateway URL/key, stable session key and saved conversation ID |
| `KREODA_VOICE_TOKEN` | Separate device token for the voice endpoints |

Later starts use the saved CAD device credential. The Hermes key stays on the PC; it is not included in the scene, repository, APK, MCP context or tool output. Conversation IDs are written atomically to the private configuration.

Quest receives `kreoda.voice-url` and `kreoda.voice-token` through the `com.kreoda.quest.AdbProvisioning` activity alias protected by Android DUMP permission and stores them in its app directory. Android declares `RECORD_AUDIO`; the operator can grant it via ADB. Recording starts only after the user presses Parla; Invia submits the complete recording. Stop, focus/tracking loss and component shutdown clear recording, network work, queued callbacks and owned playback. Reply audio is played sequentially on the headset. HTTP and WAV sizes/durations are bounded.

## Verification boundaries

Tests cover real MCP HTTP discovery/resource access, canonical socket routing and transaction ownership, goal checks, expiry, acknowledgement recovery, waveform validation, voice HTTP authorization, conversation continuity and cancellation. The actual OCCT/Electron/MCP proof measures a 100×50×20 mm solid and restores the empty document with one Desktop Undo. Synthetic server TTS→STT verifies resident voice services without capturing a person or playing sound on the PC.

These checks do not attest physical microphone quality, headset comfort or the complete physical Phase13 workflow. Live Hermes discovery, persistent project awareness, conversation/voice integration and the updated installed APK must be recorded separately. If submission acknowledgement is lost during cancellation before a run ID is known, do not claim that the unknown server run was stopped. No new mutating turn is issued to guess its result.

MCP SDK transport reference: [official C# SDK](https://github.com/modelcontextprotocol/csharp-sdk/blob/main/docs/concepts/transports/transports.md).

Both voice and CAD pairing reject provisioning extras delivered through the public launcher. ADB shell holds DUMP on the tested Quest. The bridge bounds 16 observable CAD command attempts across corrections; the native Hermes model route separately bounds its own tool loop.

## Unconfirmed rollback recovery

Rollback failure is reported as `uncertain` with original request/transaction/session/document/base revision and owner client identity. Disconnect fallback is not proof of rollback. New CAD/voice work is fenced; Describe reports the recovery record. The production bridge saves the record beside its private CAD device file as `.rollback-uncertain.json` and loads the fence on restart. Expiry failures are recorded without an unobserved background exception. Reconcile the recorded transaction through the Desktop/session status and authorized recovery path before removing that record; force rollback is not exposed to Hermes. If private persistence fails, the response explicitly says recoveryPersisted=false and still includes the identity.
