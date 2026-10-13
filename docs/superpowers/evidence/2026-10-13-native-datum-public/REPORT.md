# Native datum control commands and model rollback — partial Task2

Root continues the human-authorized quota fallback. Existing Luna and review lanes ended with usage limits; no retry or substitute review verdict. Full Phases12–16 goal remains active. This packet is not acceptance of all Phase15 reference geometry.

## Changes

Native command IDs31–35 create planes/axes/points, update a definition, and request an authoritative datum DTO. Existing IDs0–30 remain unchanged. FlatBuffers schema and handwritten control enums agree; C++/TypeScript/C# bindings were regenerated with the repository script and flatc25.12.19, after checking deletion targets stayed inside this worktree. Definitions use type discriminators.

Read-only getDatum and RequestSnapshot include resolved native geometry, source IDs and definitions. Sketch summaries now include supportRef and full native frame; public CreateSketch can use a datum plane. Numeric SetParam supports offsetMm, angleDeg, point xMm/yMm/zMm and embedded first/second/third/through coordinates. Unsupported previews/formulas/batch values and malformed or out-of-range input return errors without mutation. Delete refuses datum and sketch dependents, permits unreferenced datum removal, and Undo restores it. Joined datum edits use one revision and Undo at commit; rollback restores definitions.

## Reproduced defects and corrections

Initial public-command tests failed UNKNOWN_COMMAND. Routes now pass through the existing native atomic datum operations.

Actual sourceBody→faceOffsetPlane→sketch→extrude→boolean common test reproduced failed upstream edit dropping the source solid from registry. Shared primitive recompute rollback now restores exact ordered shapes, datums, sketches, bodies, expressions, graph, registry and revision after OCAF map resync. A subsequent valid edit succeeds; healthy graph nodes remain clean.

A separate native test isolated persistence's root identity defect: XCAF AddShape deduplicated identical TShapes when boolean common returned its input, and new feature metadata overwrote the original label. Each new feature now allocates NewShape and sets its geometry on that unique label. Resync and actual XBF save/open preserve both feature IDs, dependencies and measured350mm3 solids, including identical geometry.

## Verification

27 focused native tests passed, zero failures/skips; XML included. Source-upstream-failure and alias-persistence tests retained their actual RED evidence in local logs. Full native Release build and self-test passed. Generated C# package builds net8.0 and netstandard2.1 with zero warnings/errors. Full CTest result is recorded in summary.json after completion.

## Remaining requirements

Stable TNaming for indexed face/edge datum sources, broader chain recovery and transaction-failure proofs, canonical command metadata, typed session/client/Desktop/Quest/MCP integration, current-head hosted CI and independent final review remain open. Datum previews and formulas are explicitly unsupported in this partial native packet. No live Hermes, SSH, server/AI probe, remote change, device install/capture, microphone/camera, PC audio or foreground UI action occurred. The primary dirty human checkout was preserved. No merge or release.
