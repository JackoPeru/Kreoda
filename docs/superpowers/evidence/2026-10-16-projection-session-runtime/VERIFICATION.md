# Projection session runtime verification

Date: 2026-10-16

## Verification

- Session contract generator: node scripts/generate-session-contract.mjs --check — 5 generated artifacts verified against 52 DTO schemas.
- Protocol: 57/57 tests passed; TypeScript build and lint passed.
- Desktop: 295/295 tests passed; production build and lint passed.
- Managed suites: SessionClient 153/153, ModelingAgent 34/34, HermesBridge 35/35, ModelingAgent.Benchmark 33/33. All four TRX files report zero failures and zero skipped tests.
- .NET solution: Release build passed with zero warnings and errors.
- Hidden Desktop + official MCP + native OCCT E2E: 1/1 passed. The test verified hidden-window startup at launch and produced no screenshots.

## Native scenario evidence

The file native/mcp-proof.json records the real native/MCP scenario, operation metadata, revision and volume changes, persisted UTF-16LE archive mutation, repair, stale measurement rejection, GEOMETRY_UNAVAILABLE mesh rejection, healthy branch preservation, and Undo restoring the broken state. The adjacent healthy.icad and broken-binding.icad files are the exact archives retained from that run.

The source circle edit changed measured volume from 785.3981633974482 mm3 to 1130.9733552923256 mm3 while preserving feature/group identity. The unrelated healthy branch remained measurable at 1000 mm3. The persisted broken binding retained its IDs, reported the missing entity diagnostic, omitted stale geometry, and could be repaired through MCP; Undo restored the unavailable state.

## TRX files

- trx/session-client.trx
- trx/modeling-agent.trx
- trx/hermes-bridge.trx
- trx/modeling-agent-benchmark.trx

## Scope limits

Hosted CI, physical Quest/ADB acceptance, and live server acceptance were not run. No commit, push, server access, or physical device operation was performed.
