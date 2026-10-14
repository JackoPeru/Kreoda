# Actual local MCP datum proof

Status: parent verified; independent immutable review pending. Not full Phase15.1 or full-goal acceptance.

## Actual boundary and failure

Official MCP SDK HTTP client -> local HermesBridge -> actual SessionClient/SessionRelay -> native OCCT8.0.1 -> Desktop renderer. No live Hermes Agent, server/SSH/AI request or headset was contacted.

Parent independently reproduced native RED in an isolated hidden stdio process: valid DatumPlane and supported sketch created successfully, but validateDocument returned false because referenceCheck looked up the support as a solid. validateReferences on the real datum UUID returned NOT_FOUND. Retained red/green JSON shows the same native request sequence before and after correction.

## Implementation

- Native datum UUID validation returns datumPlane/datumAxis/datumPoint with actual UUID owner and no body ownership.
- Native definitions, status and resolved records are validated by existing datum parsing/resolution. Specific reference/feature checks validate only the requested datum and its source-datum dependency closure; full-document validation remains global. Unrelated broken datums do not invalidate a healthy selected target.
- Supported sketch validation requires a healthy DatumPlane. Missing/wrong-kind/broken/corrupt sources reject without query mutation of revision/Undo.
- McpProbe gains opt-in datum scenario; default Box output remains compatible. It discovers actual creation metadata31–35, creates plane24 ->100x50 supported sketch ->extrude7 through canonical tools/aliases, validates35000 mm3 and commits one shared revision. Describe/getDatum expose actual definition/frame/status.
- Hidden E2E observes real Desktop identities/frame/geometry, one ordinary Undo clears all three records and Redo restores IDs/frame. Tests use isolated profiles, ephemeral local credentials/ports, hidden child processes, redacted errors and verified temp-directory cleanup. No screenshots.

## Parent verification

- Actual isolated native RED reproduced; same actual native GREEN returned valid document and datumPlane reference without ownerBody.
- Full linked native CTest233/233, zero failures/disabled,85.55 seconds; raw log and XML retained. Includes four new SessionGeometry tests plus all prior native gates.
- Parent independently ran existing Box MCP and new datum MCP hidden E2E:2/2 in28.0 seconds. SDK/native proof JSON retained, including35000 mm3, solidCount1, bbox[0,0,24,100,50,31], initial revision0/final1, actual UUIDs, oneUndoRestoredEmptyDocument and redoRestoredOriginalIdsAndFrame.
- Parent Release build of actual MCP probe: exit0, zero warnings/errors.
- Worker lane exactGPT-6-Luna/Max (01a13a96-10a2-74c3-918b-280c382e8f41) delivered scoped source/tests; parent inspected diff and repeated kernel/MCP gates. No production bridge validation was bypassed.

## Remaining work

Canonical datum selection kinds/context-command support binding, Desktop shared reference target highlights and Quest full-frame/reference/pinch controls remain open; their sequence is recorded in docs/superpowers/plans/2026-10-14-phase15-quest-datum-integration.md. Normal ARM64/new-head CI/live Hermes/physical voice and all other original Phases12–16 requirements remain open. No push, merge or release.
