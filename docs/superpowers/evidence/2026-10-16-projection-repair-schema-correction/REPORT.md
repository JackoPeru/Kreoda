# Corrected projection recovery and UTF-8 validation candidate

Base29fe5036950e2b973887c1fcf860c95b852da0f5 received a substantive **fix-first** review. This commit contains the corrections and independently verified evidence. Fresh corrected review is still required; no acceptance, hosted CI or full-goal completion is inferred.

## Corrections and behavioral proof

- A loaded .icad with two corrupted persistent projection bindings can repair or remove one group while the remaining blocker keeps the branch unavailable. Status/diagnostics/evaluated-edge availability are refreshed for all groups. A final valid repair rebuilds the same downstream feature; an invalid final profile fails atomically. Healthy edits retain strict behavior. Partial metadata recovery does not add ordinary geometry dirtiness that wedges an unrelated healthy edit.
- Resource limits remain hard errors. Repairing an early group cannot exhaust the2000-edge budget and silently break a later healthy group. Actual regression preserves the preceding definitions/status/revision.
- Real .icad save/open, intermediate unavailable state, unrelated healthy edit, same feature/group IDs and Undo/Redo are exercised. Joined repair failure after an initial successful partial repair taints/rolls back both groups, private bindings, graph/revision and historical shape. Two successful repairs in one transaction have one shared Undo/Redo.
- Those transaction tests exposed a real wire collision: sketch_body wrote availability status over the command's reserved status. Successful Set/Remove and broken RequestSketch inspection now retain envelope status=ok and use geometryStatus for the root availability diagnostic. Nested projection/model status remains unchanged; native geometry stays unavailable while blocked. The failed transaction/wire logs are preserved.
- Shared source schemas declare512 UTF-8 bytes for persistent edge/authored entity IDs and65536 bytes for serialized definitions. The existing generator compiles maxUtf8Bytes/maxJsonUtf8Bytes into standalone AJV validators without renderer eval. Canonical schema export carries matching metadata. Standalone source, nested result and snapshot paths enforce the bounds. Standard maxLength remains; valid Unicode is retained. Other JSON Schema engines require equivalent custom-keyword support; generated C# DTO deserialization alone is not claimed to enforce these semantic byte checks.

The parent independently reproduced an old compiled validator accepting a607-byte/307-character ID. After the corrected build, the same standalone and nested probes reject it, while a valid407-byte Unicode ID is accepted. Exact65536-byte definitions and one-byte-over rejection have protocol/canonical regressions.

## Implementation and independent gates

The same separate app task01a143c8-20da-7dd1-a0f9-8f9bc07b42d8 ran actual GPT-6-Luna/max. Corrective turn01a143f1-6334-7593-afaf-9a258be4f9a8 terminated completed, not quota. Parent extended the bounded dispatcher ownership after the actual wire failure, inspected the patch and ran its own gates after the worker stopped. Unified parent session12351 terminated exit0.

| Parent gate | Result |
|---|---|
| Real OCCT/FlatBuffers Release build |exit0; OCCT/FlatBuffers ON, stub/production crash barriers OFF |
| Full CTest |284 cases,0 failed/error/skipped;40 required profile/save/lifecycle/wire/recovery cases present |
| Core self-test |exit0, success marker, PATH restricted to Windows/System32 with app-local DLLs |
| Protocol |56 cases,0 failed/error/skipped; build/lint exit0 |
| Canonical schema |15 cases,0 failed/error/skipped; build/lint exit0 |
| Session generation check |exit0, deterministic current artifacts |
| Compiled UTF-8 probe |607-byte ID rejected standalone/nested; valid Unicode accepted |
| Managed Release solution |build exit0; SessionClient142, ModelingAgent33, HermesBridge34, ModelingBenchmark33 TRX results, all Passed;242 total |
| Source stability |56/56 source hashes unchanged through independent build/tests and packaging |

Worker also ran281 GoogleTest cases in one process, five focused recovery cases, normal core self-test,56 protocol,15 canonical and242 managed tests. Parent's284 CTest cases include those281 plus three CMake control tests; the counts are not contradictory or additive. test-discovery-comparison.json confirms all279 prior native,54 prior protocol and14 prior canonical occurrences remain, with five/two/one additions. Parameterized Vitest cases can share titles; comparison uses occurrence counts.

Raw worker failures/successes are archived under the paths in artifact-provenance.json, alongside original parent logs/XML/TRX. Committed log copies normalize whitespace and text files normalize CRLF to LF; raw/committed hashes and transformations are recorded. XML/TRX values and source-hash values were not changed.

## Remaining work

Corrected accumulated fresh review, exact-head hosted CI and the required session runtime/MCP/Desktop/controller-free Quest implementation remain open. In particular: native availability must propagate without fabricated zero measurements; session ordering/replay/freshness and bounded64MiB control transport need implementation; managed typed projection queries need semantic UTF-8 checks; compact Desktop controls/default-rectangle behavior and hands-only Quest controls/build/proof remain required. Physical/live gates remain separate.

The full original Phases12-16 objective remains active, including other advanced modeling requirements. No Hermes/server/SSH/Tailscale/AI, physical Quest/ADB, GUI/capture/microphone/camera/audio action, merge or release was performed.
