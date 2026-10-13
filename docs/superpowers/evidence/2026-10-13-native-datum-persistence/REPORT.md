# Datum persistence — partial Task2

Root quota fallback continues the full original goal; this is a required layer, not complete15.1 or whole-goal acceptance. Mainfa78baf hosted CI38459951316 now success: native193/193, managed238/238, ordinaryE2E64/64, crashE2E29/29 and packaging. Later isolated constructors/persistence are not in that hosted head.

## Changes

Resolver accepts explicit incoming datum/shape records without consulting live stores. Actual RED showed same-ID incoming point/OCCT face incorrectly resolving against live data; two context tests now pass. Native definition records store version1/featureId/kind/definition, retaining source IDs rather than cached resolved geometry. Parser stages all definitions, validates IDs/duplicates/missing references/cycles against a temporary FeatureGraph, then resolves in dependency order against incoming geometry, adopting output only on success.

OCAF Datums root at1004 uses the shared unique metadata-root resolver, preventing first/last duplicate-root selection. Complete records stage before Resync cache replacement and file Load/reset. Legacy files without datums remain valid. Document creation clears DatumStore; resync rebuilds it and registry as NonBody; ordinary OCAF Undo/Redo restores definitions. Datums participate in dispatcher failed-document snapshots, .icad open adoption and graph reconstruction. Label maps rebuild after Load so first post-open edit replaces the original label. Low-level OCAF removal supports datum labels and ordinary Undo. No new public datum creation commands exposed yet.

## Actual evidence

Behavioral REDs retained: prospective context2fail, JSONdefinition chain1fail, OCAFmirror2fail, .icad-open loss1fail, datum removal1fail. GREEN focused16/16, zero skips/failures. Actual OCAF save/open derives parent/child point values and sources; ordinary Undo/Redo preserves them; child removal and Undo work. Invalid incoming missing-source definition fails before replacing healthy datum/registry/revision/Undo. Actual .icad dispatcher Save/Open retains datum and graph ID; editing same reopened point to99 replaces its original label, then Undo restores10. NativeBRep constructors/source proofs from prior packet remain passing.

Whole linked build --parallel2 passed, CTest209/209 in91.54s, core self-test0. External logs TEMP/kreoda-datum-persistence-{all-build,all-ctest,focused}.log; XML included. No new dependencies, remote/server/Hermes/device/mic/camera/audio/foregroundGUI activity. Independent review remains unavailable after quota.

## Remaining mandatory work

Complete atomic Create/UpdateDatum commands and downstream recompute, cycle/referenced-delete/SetParam guards, datum-supported sketch→native feature chain, stable TNaming for currently rejected indexed roles. Then31–35 protocol/canonical schemas/generated contracts and Desktop/Quest/MCP, full save/open/recovery/Undo/client proof. Existing public DeleteFeature and snapshots still need complete datum exposure; low-level label removal alone does not complete that route. Full original roadmap and physical/live gates remain open.
