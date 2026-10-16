# Native Hermes benchmark

The seven requirements in `docs/superpowers/benchmarks/phase14-requirements.json` are frozen before live attempts. The runner verifies SHA256 after normalizing only Git checkout CRLF to LF; every content change remains rejected. Each submitted voice turn records a new attempt; an occupied-document preflight refusal writes no report. The runner refuses to overwrite a report and refuses any occupied or uncommitted CAD document. Prepare a separate empty Desktop/session profile. Never use the user's working document.

```powershell
dotnet build clients/session-dotnet/Kreoda.Session.sln -c Release '-p:Platform=Any CPU'
$env:KREODA_BENCHMARK_MCP_URL = 'http://127.0.0.1:9843/mcp'
$env:KREODA_BENCHMARK_VOICE_CONFIG = '<private voice configuration path>'
$env:KREODA_BENCHMARK_HERMES_CONFIG = '<private Hermes configuration path>'
dotnet clients/session-dotnet/tools/Kreoda.ModelingAgent.Benchmark/bin/Release/net8.0/Kreoda.ModelingAgent.Benchmark.dll docs/superpowers/benchmarks/phase14-requirements.json centered-hole-plate '<new attempt report path>'
```

Voice configuration uses `endpoint` and `token`; Hermes configuration uses `gatewayUrl`, `apiKey` and `sessionKey`. Existing private PC configurations can be reused. Credentials stay in private files, never command arguments or reports. The runner calls the actual Quest voice proxy and Hermes Agent; it does not plan or execute CAD commands itself. The bridge retains shared origin, transaction, correction, feature/action and 180 second limits.

The evaluator checks native document validation, committed state, one body without instances, exactly one actual B-Rep solid, dimensions, total displayed volume, unique reversed cylindrical walls at every hole center/radius, through depth, cavity/window planes, open-box top area and shaft terminal cones. `getBoundingBox.solidCount` counts OCCT solids in the same complete displayed shape that supplies the bounds and volume; it includes displayed instances and excludes old body history. Missing, fractional, zero or multiple solid counts reject geometry. Other missing, non-finite or failed measurements also reject geometry.

Native run events are SSE, not JSON. The runner records tool names, errors, durations, command previews, observable CAD command attempts and correction counts; it excludes reasoning events. The server's public SSE does not expose full command arguments, so `fullCommandArgumentsRecorded` remains false. A truncated replay cannot claim complete event evidence. Failed voice turns now retain a validated native run ID when the proxy can deliver that known identity, allowing the same event reader to inspect the failure. Lost submission acknowledgement, caller-aborted HTTP without a delivered identity and uncertain rollback remain unproven; no run ID is fabricated and complete failed-turn evidence remains pending. Local fake-Hermes integration tests verify the wire path and error retention without counting as live fixtures.

`geometryPassed` is deliberately separate from `accepted`. Exit0 is reserved for accepted fixtures; exit2 means geometry passed but acceptance is incomplete; exit1 means the live turn or geometry failed. Every report currently keeps `accepted=false`: full acceptance also requires an actual edit preserving feature identity, one shared Undo restoring the empty document, complete command arguments and Desktop/Quest revision/mesh observation. A native single-solid predicate is now implemented and checked through actual MCP, but no seven-fixture live acceptance is inferred from that primitive proof. Synthetic unit fixtures and the unavailable-backend native boundary test never count toward the live minimum of six accepted fixtures out of seven. Failed and interrupted attempts must be retained.

The automated native boundary test configures no Hermes backend, records HTTP404 as an unsuccessful attempt, then proves an occupied actual OCCT document is refused without revision/model changes. It requires no external server, headset input, camera, microphone capture or PC audio playback.

Do not start live benchmark requests while the user's Hermes server is busy with other work. No model reload, gateway restart or remote configuration mutation is needed for these local checks.
