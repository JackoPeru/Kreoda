# Projection public wire: parent verified candidate

Base:6483a1040a82424f51933bba95944732bc0c7941. This candidate adds public native commands36 SetSketchProjection,37 RemoveSketchProjection and38 RequestSketchProjection, canonical zero-allocation metadata, strict public definitions and regenerated TS/C#/FlatBuffers contracts. The commit containing this report is the immutable review candidate. It is not a final acceptance or hosted/runtime claim.

## Implementation and parent audit

Separate app worker01a143c8-20da-7dd1-a0f9-8f9bc07b42d8 ran actual GPT-6-Luna/max. Final turn01a143ce-d975-7ee1-92e5-45d935f0cfe4 completed successfully; no worker commits/pushes. Parent inspected actual diffs and behavioral logs, then independently rebuilt/retested the frozen55-source-file candidate. No source hash changed.

- Query is read-only and returns source/group identity, native curve type/trim, world-mm sketch frame and bounded display samples (two points per line,129 per other finite trimmed curve,2000 edges per sketch). Samples are presentation approximations; native B-Rep remains the profile authority. No persistent output-member IDs or private OCAF labels are exposed.
- Parent identified cached-ok groups whose support/source closure can be unavailable. The new boundary uses common GetGeometryAvailability before sampling, retains inspection metadata and returns no stale display edges. Actual broken .icad lineage is also queried in the persistence fixture.
- Parent corrected removal fixture semantics: removing the last group with a dependent solid must fail atomically. Successful removal occurs only after normal dependent deletion. Native type and world placement are checked without forcing an ellipse label or bitwise closed endpoints.
- The initial wire volume fixture failed on an unscaled1e-6mm3 assumption. The final test uses the existing declared1e-6mm CAD placement tolerance and perimeter-derived area/volume bound. Original failure logs are preserved; product evaluator/profile geometry was not changed to satisfy this wire fixture.
- Native expectedRevision has no existing envelope semantics. It is rejected BAD_PARAMS rather than accepted and ignored. Ordinary relay baseRevision ownership remains for the required next runtime packet.
- Generated managed enum converters are exercised using the actual SDK converter settings. Default serializer failure is retained separately. JSON schema references are expanded only for canonical/schema parity proof.

## Independent parent results

| Gate | Result |
|---|---|
| Real OCCT8.0.1 core/tests Release build | exit0; OCCT ON, stub OFF, production crash barriers OFF; FlatBuffers ON observed in cache |
| Full native CTest |279 unique cases,0 failed/error/skipped;35 required profile/save/lifecycle/wire cases present |
| Core self-test |exit0 and success marker with PATH restricted to Windows/System32; app-local DLLs |
| Protocol |54 cases,0 failed/error/skipped; build/lint exit0 |
| Canonical command schema |14 cases,0 failed/error/skipped; build/lint exit0 |
| Generated session contract check |exit0 |
| Managed SessionClient Release |142 TRX results, all Passed; new projection DTO round-trip present |
| Entire managed solution Release build |exit0,0 warnings/errors, including agent, bridge and probes; their separate test suites were not rerun in this packet |
| Source stability |55/55 hashes unchanged before/after independent gates and evidence packaging |

Worker separately obtained the same279/142/54/14 counts, normal core self-test and byte-identical FlatBuffers regeneration. These repeat runs are not additional unique cases. Parent's unified verification session25296 terminated exit0. See parent/summary.json, XML/TRX and logs. artifact-provenance.json records exact raw archives/hashes and actual committed blob hashes. Log copies have whitespace-only normalization; Git also normalized CRLF to LF for eight XML/TRX/JSON artifacts, recorded explicitly in the manifest. XML/TRX values and source hash values were not changed. The original raw byte streams remain archived at the recorded paths.

## Open requirements

Fresh accumulated immutable review remains required. The earlier native lifecycle review ended on quota without a verdict; that is not SHIP. The next fresh review covers materially new code plus that unaccepted accumulated native base. This candidate has no exact-head hosted CI proof.

Session relay adoption, ordered read/replay/freshness, explicit unavailable-volume propagation,64MiB bounded control envelope, managed/MCP actual sidecar proof, compact Desktop projection controls/default-rectangle fix, hands-only Quest display/repair, Editor/ARM64 and physical/live acceptance remain required. Current managed control ceiling4MiB does not establish transport compatibility with all permitted metadata/display sizes. The next runtime plan records that concrete conflict.

The full original Phases12-16 objective remains active, including the other open advanced sketch/modeling requirements. No Hermes/server/SSH/Tailscale/AI, physical Quest/ADB, microphone/camera/audio or foreground GUI action was performed. No merge/release is implied.
