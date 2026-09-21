# Slice 7 — Session protocol decision: B (JSON control + FlatBuffers data)

## Decision

**B — JSON control plane + FlatBuffers data plane.** No wire migration.

## Reason

The JSON control plane already works end to end (relay + C# client; 8 relay
tests, 69 desktop / 16 protocol / 21 dotnet green); a full-FlatBuffers rewrite buys nothing the
product needs (control frames are sub-KB, schema evolution is additive JSON).

## Migration risk

A (WS+FlatBuffers everywhere): HIGH — regenerate + migrate relay, both test
clients, C#/TS/C++ bindings, version/compat tests; every slice stays red
until the flag day lands. B: LOW — document what ships, pin it with
conformance tests, keep `.fbs` for what is already binary.

## Planes (what travels how, both directions)

| Plane | Path | Encoding | Version | Schema source |
|---|---|---|---|---|
| Desktop IPC commands (Electron main ↔ sidecar stdio) | framed `[u32 len][payload]` | JSON envelopes | `protocolVersion = 1` | `packages/protocol` zod + native dispatcher |
| Desktop IPC mesh responses (sidecar → main) | framed bytes | FlatBuffers `MeshUpdate` (verify-first; errors stay JSON) | 1 | `schemas/cad_protocol.fbs` |
| Session control (WS relay ↔ TS/C# clients) | WS JSON text frames | JSON `{requestId, method, params}` / `{requestId, ok, …}` | 1 | `schemas/session-control-v1.json` |
| Session mesh/query payloads | via control frames or sidecar-direct | JSON summaries; binary tessellation stays sidecar-direct until Quest needs it | 1 | `.fbs` for binary, `session-queries.ts` for summaries |

Single sources of truth: `schemas/session-control-v1.json` (control),
`schemas/cad_protocol.fbs` (binary data). TS (`packages/protocol/
session-control.ts`) and C# (`SessionControl.cs`) mirrors are pinned to the
JSON by conformance tests on both sides.

## Control-plane enumeration

All 40 methods, required/optional params, reply shapes, error codes and
server events (`delta`, `selection`, `core-restarted`) live in
`schemas/session-control-v1.json`. Queries reply `{result}`; `snapshot` /
`invoke` / txn control keep their flat 11b payloads (frozen); errors are
always `{requestId, ok:false, errorCode, error}` — the C# `Route` reads
`errorCode`/`error` and both are preserved verbatim.

## Drift fixed

- `getCommandSchema`: the relay rejected it as unknown (`NOT_IMPLEMENTED`
  "unknown session method") while `runSessionQuery` had a dedicated
  `NOT_IMPLEMENTED` case — dead code via the relay, and `getCapabilities`
  never advertised it. Added to `QUERY_METHODS` so both layers agree it
  exists-but-unimplemented with the honest agent-slice message.
- C# had no txn helpers (raw `CallAsync` only): added typed
  `TxnBegin/Commit/Rollback/ForceRollback/StatusAsync` + `InvokeRequest` /
  `TxnRequest` DTOs. Open-ended query params stay on generic `CallAsync`.

## Follow-ups (not this slice)

- Typed DTOs for the 32 query methods (C# + zod) if Quest traffic warrants it.
- Per-command JSON schemas (`getCommandSchema`, agent slice).
- Binary mesh over WS only when the Quest slice needs it (Phase 12).
