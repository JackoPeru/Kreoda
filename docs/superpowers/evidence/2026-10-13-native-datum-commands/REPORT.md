# Atomic datum functions and supported sketch chain — partial Task2

Root continues explicit quota fallback; original full goal unchanged. Native functions CreateDatumFeature/UpdateDatumFeature validate proposed definitions and cycles in a prospective dataset before mutation. One OCAF command and one registry revision cover the whole dependent closure. Full model pre-images include datums/sketches/shapes/bodies/graph/registry/revision; errors restore them, including exception paths. Revision registration occurs before Commit, matching the existing atomic shape contract. Shared CheckNewId now includes datum namespace.

CreateSketchOnDatumFeature uses the existing solve/commit implementation, preserves principal/frame overloads, stores planeKind=Datum/supportRef and dependency edge. Parser requires an explicit valid frame/supportRef for Datum sketches. RebuildNodeFromStore resolves datum nodes and updates supported sketch frame before solving/mirroring and rebuilding downstream native solids. No renderer geometry authority or new dependencies.

## Actual evidence

Three behavioral RED command tests retained; then4command tests GREEN. Focused total20/20, zero skips/failures. Actual point→three-point plane→constrained10x5sketch→extrude7 yields bbox[10,20,30,17,30,35] andvolume350. Editing firstpoint x10→11 changes plane to normal[1,1,1]/sqrt3; measured native bounds match independent expected basis formulas. One revision/Undo increment; unrelated100x50x20body retains exact shape identity. Coincident-source update and cyclic/magnitude-invalid updates reject without changing registry/revision/Undo. Ordinary Undo restores original bbox.

Actual sourceBox depth20→40 propagates face-offset support z22→42, supported sketch and native extrude bbox z42..49 while volume350; one normalUndo restores supportz22. ID collisions across datum/solid/sketch namespaces reject. Build and core self-test0 pass; whole native CTest213/213 in162.32s, no failures. External focused XML/logs TEMP/kreoda-datum-commands-focused.*, fullsuite TEMP/kreoda-datum-commands-all-ctest.log.

## Remaining scope

Numeric/control/catalog/query/snapshot routes31–35 not exposed yet; SetParam/referenced-delete and persistent TNaming for indexed sources still mandatory. Recovery and client proofs continue, then all generated schema/Desktop/Quest/MCP. Upstream failure/transaction edge cases and final independent review must be verified before full acceptance. Main hostedfa78baf remains previously green; this isolated work is not in that head. No server/Hermes/SSH/device/mic/camera/audio/foregroundGUI actions.

After fullsuite, the existing native chain test was extended (test-only change): actual .icadSave/Open retains initial native bbox and datum/sketch/source IDs; postOpen sourcePoint x10→11 recomputes measured changed bbox through restored graph and existing labels. Focused20/20 rerun passed withzero skips. No production source changed after the full213gate. No repeat whole suite solely for added test assertions.
