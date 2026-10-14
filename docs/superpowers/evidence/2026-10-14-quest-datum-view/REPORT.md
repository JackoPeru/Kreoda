# Quest native datum view and target adapter

Status: parent implementation and local managed/Editor verification complete; fresh immutable review pending. This packet is not full Quest/Phase15.1 acceptance. Construction/edit controls, normal ARM64, current-head CI and physical/live acceptance remain open.

## Implementation and provenance

Separate GPT-6-Luna/Max task01a13ad9-3e99-7ba1-8e3c-ca39fdbf1282 supplied the initial QuestDatumView, observation reconcile/publication adapter and tests. The task failed with a terminal usage-limit error before delivery. Under the human's explicit quota fallback, root completed the existing work without retrying/replacing that worker. Root runtime remains the previously disclosed GPT-6.1-Sol/high; it is not claimed as GPT-6-Sol.

- Native plane borders, axis lines and point glyphs keep actual datum UUID/kind/status and complete resolved frames. Existing CAD conversion is reused; malformed basis/non-unit axis/unrepresentable display coordinates fail explicitly. Separate reference colliders do not fill plane interiors or create body meshes. Owned colliders are disabled before deferred destruction.
- QuestConnection carries datums with the same captured model/observation as meshes and rejects stale observations. Current targets require the accepted model object, connection generation, session/document/revision and exact applied view. Datum-only updates do not request meshes; removal/document replacement clear guides. Offline guides cannot publish or supply voice context.
- Existing hand/index-pinch selection recognizes datum colliders after UI/cap handling; body selection and datum selection clear one another. Shared-target publication and voice use real current datum IDs. Existing confidence/release/focus/two-hand/panel routes remain intact.
- QuestCommands loads the PC context for the selected datum, preserves the PC-bound supportRef and confirms through the existing canonical command path. Selection/revision changes invalidate or refresh context; axes/points do not gain fabricated sketch supports. No new manual provisioning.
- Supported sketch display validates the complete native basis before drawing and retains the native origin/x/y under a moved, rotated, scaled and reflected display transform.

## Parent verification

- Current managed Release netstandard2.1 staging: Protocol, SessionClient and QuestFoundation each built with zero warnings/errors; eight runtime DLLs plus manifest. Managed source did not change in this packet.
- Full hidden Unity6 EditMode suite:67/67 passed, zero failed/skipped/inconclusive, process exit0. XML and run summary retained here. All158 captured authored Quest files, including new .cs/.meta files, matched their pre-run hashes after restoring Unity's scene and two section-material mutations.
- Real local WebSocket fixture plus actual Unity SessionClient verifies datum publication with actual UUID/document/baseRevision, PC context/schema loading, exactly one canonical CreateSketch carrying the returned supportRef, no datum mesh request, reconnect and retained offline geometry. This is transport/client evidence against synthetic server responses, not live Hermes/native CAD execution. Existing separate native MCP/Desktop proofs cover the actual kernel chain.
- Controller-free rising-edge pinch selection feeds the datum voice ID; revision changes/offline identity are rejected. Datum snapshot/removal/document replacement and same-revision reconnect-generation rejection have runnable tests. Plane/axis/point, malformed/overflow cases and transformed native sketch frame are covered.
- Actual RED checks exposed missing datum selection, same-revision reconnect freshness and missing sketch-basis validation; each was corrected and rerun. An Editor-only Destroy error was corrected at owned view disposal. A new test audit file hit Windows EBUSY during concurrent read/write; fixture auditing now uses the existing WebSocket transport. No production retry or validation bypass was added for that fixture error.
- Node syntax check and git diff --check passed. Raw launcher/editor logs and RED runs remain outside the repository under C:/Users/matte/Documents/Codex-tools/Unity/QA/phase15-datum-view-worker-20261014; parent preflight/staging and the first failed integrated run are in phase15-datum-view-parent-editor-20261014-a1.

## Boundaries

No Hermes/server/SSH/AI calls, remote changes, device install/capture, microphone/camera, PC audio or foreground GUI. Primary dirty user checkout preserved. No push/merge/release; hosted CI remains the olderfa78 baseline. Full original Phases12–16 goal remains active, including all other Advanced CAD and Intent work.

## Fresh review and reconnect correction

Fresh GPT-6-Sol/high reviewer01a13be8-8b67-76a1-9c29-dcb1e0742bce returned fix-first for immutablee2c618f..b2bbfb6. A same-session/document/revision reconnect reused the datum view but could retain old PC-bound command parameters. Parent confirmed a RED test: the old command selection still returned current after a new accepted connection generation.

Correction captures the command's actual SessionClient, connection generation and model lineage/revision. Confirmation and delayed schema callbacks reject retired context; execution keeps the captured client rather than reacquiring another client with old parameters. Accepted datum observations now notify on connection-generation changes, causing a context reload even if geometry/revision did not change. Datum currency follows the active client/run and accepted observation rather than the separately queued UI Connected flag; this avoids discarding the selection when observation and status callbacks arrive in different frames.

The actual WebSocket test now keeps the form through reconnect. It rejects confirmation while reconnecting, returns changed PC binding XY→XZ on the second connection, requires a new listCommands before command, and checks the second command uses XZ. The original datum-only observation test also rejects old command context after a same-revision new generation. Parent repeated the full hidden Editor suite:67/67, zero failed/skipped/inconclusive, process0, all158 authored hashes restored. Corrected XML, summary and current source hashes are in reconnect-correction/. Node syntax and git diff --check pass. The previous fix-first verdict is not acceptance of this correction; a new immutable review is pending.
