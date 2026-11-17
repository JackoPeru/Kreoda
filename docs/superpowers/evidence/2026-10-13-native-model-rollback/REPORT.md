# Full model rollback and joined datum chain — partial Task2

Root follows the user-authorized terminal-quota fallback. Original Phases12–16 goal unchanged. No live Hermes/server/SSH, remote changes, device/audio/capture or foreground UI.

## Actual failures and corrections

Source sketch width10→20 changes native extrude +X face and its dependent datum/support sketch x10→20, then boolean common fails. RED test proved old UpdateSketchFeature left datum and supported sketch at20 and downstream graph dirty. Shared ModelSnapshot now preserves exact ordered shapes/sketches/datums/bodies/expressions/graph/registry/revision for datum, primitive and sketch mutations. Failed update restores x10 and all clean graph nodes; valid width11 retry moves support x11 in one revision/Undo. Source constraints and native measured geometry are used, not renderer data.

Joined public datum→sketch→extrude commands had provisional revisions2 and final3 instead of one. RED test also found empty transaction increasing revision. DocumentStore registers provisional feature identity without incrementing while OCAF joins; successful changed CommitTransaction increments once, empty commits preserve revision and Undo. Full chain Undo removes every datum/sketch/solid; Redo restores IDs, graph and later parameter editability. Actual downstream failure taints a transaction, removes an earlier joined point and restores baseline plane/solid/registry/revision/Undo.

Datum Plane(YZ,offset10) supports native rectangle10×5 revolution360 around localX. Independently expected cylinder bbox[5,0,-5,15,10,5], volume250*pi mm3. Offset20 moves bbox x15..25. Undo and actual .icad save/open retain offset10 and support UUID/frame; post-open offset30 moves bbox x25..35 with same volume.

## Gates

Focused35/35 (Datum and Session11), zero failures/skips. Full linked native Release CTest224/224 in74.61s; self-test0. Included XML, raw CTest and actual RED logs. Native primary shared atomic paths were rebuilt and full suite exercised.

## Outstanding

Persistent indexed topology sources, client/recovery and canonical schemas/commands, Desktop/Quest/MCP exposure, exact integrated-head CI and fresh independent review remain. No acceptance/merge/release verdict. Task3 must integrate with current Main and preserve canonical command creation metadata and agent budget validation; this packet does not change that client catalog.
