# Exact b5d1736 hosted Windows CI success

Run38707325681/job116329852819 completed success at immutable b5d1736740f9793c3a8ecbd9d179205de4fbfe63. Parent independently read final run/job status and downloaded the actual complete job log. This supersedes the earlier pending hosted-gate statements for that commit.

## Verified actual gates

- Native self-test and233/233 CTest cases passed.
- Independent managed suites: SessionClient141,ModelingAgent33,HermesBridge34,ModelingBenchmark33;241 unique cases,zero failed/skipped. The pipeline executes them again in full regression; counts are not doubled.
- Desktop287 across44 files,protocol51,command-schema12 unique source cases across2 files. Source-only discovery remains effective in a clean hosted checkout.
- Ordinary actual native Electron E2E67/67; complete crash E2E32/32.
- Full crash gate reported passed=true,production_core_restored=true; restored SolverCrashBarrierControl passed.
- Workspace build/lint/generated session-contract checks, hidden renderer-crash harness, Windows packaging smoke, GPU diagnostic build, actual Squirrel install and installed native core self-test, and native runtime provenance steps all passed.

Actual run metadata, compact log excerpts and unique-count summary are retained here. Raw full log remains at C:/Users/matte/AppData/Local/Temp/kreoda-ci-b5d1736-full.log, SHA25664ed717ce0b5190186193f878bd29cf6bf39d22554ef6ebac157d2ee357274ce. Excerpts remove terminal colour escapes and whitespace only; the original log is unchanged. Parent watch16466 terminated with exit0 and must not be treated as live or restarted. The duplicate run38707331978 was skipped and is not an acceptance gate.

## Boundary

This verifies the published b5d1736 source, including the reviewed Quest/desktop correction packet. Later local documentation commits and the currently dirty native projection evaluator are outside this hosted run. Projection task01a13ec1 remains active; its first10/10 focused run is intermediate evidence, with full native regression, actual main runtime self-test, parent verification and fresh immutable review still required before acceptance.

Draft PR3 remains open, no merge/release. Physical Quest hand/voice/comfort/performance, live Hermes fixtures, remaining Advanced CAD and Phase16 intent capabilities remain unverified or incomplete. Hermes/server/device restrictions remain in force. The full original Phases12-16 goal stays active.
