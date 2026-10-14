# Native datum persistent selections — partial Phase15.1

Root continues the user-authorized terminal-quota fallback. Full Phases12–16 goal unchanged. No Hermes/server/SSH/AI request, remote mutation, device install/capture, microphone/camera/audio or foreground GUI.

## Implementation

Create/Update preflight validates actual planar faces/straight edges, uniqueness and source DAG before opening a command. Within the same OCAF command, datum source refs capture a TNaming selector and selectionEntry. Labels record datum UUID, owner UUID, topology kind and canonical native role. Reads validate document root, label ownership and native entity membership before using geometry. Prospective ParseDatumDefinitions accepts its explicit selection resolver; incoming OCAF staging uses the incoming document's naming context, never live state. Pure explicit datasets without naming context reject bound refs.

OCCT8.0.1 TNaming_Selector.cxx type-migration branch stored a whole context compound for these picks. The local primary source and retained failing tests identify this behavior. Preserve the selector naming recipe while using TNaming_Builder.Select to anchor the exact explicit selected native entity. Read the stored selected value with TNaming_Tool.GetShape. Single-entity compound wrappers are accepted; multiple entities are errors. No first-face or post-edit ordinal guess.

Existing unique semantic roles remain the documented fallback when a source rebuild replaces its native entity. Rebuild refreshes that semantic selector in the same command, keeping its stable entry and preventing an obsolete captured entity from becoming current again. Indexed sources require actual native entity membership: retained topology survives reordering; lost/replaced topology produces explicit repair failure and preserves last good model.

## Actual verification

Rotated imported box supplies indexed planar face and straight edge. Both datum definitions retain nonempty naming entries. Undo/Redo restores them. Insert different geometry before the original shape: face ordinal changes, but datum remains on original native entity. Actual .icad save/open replaces an unrelated live document and preserves frame/definition/source refs; supported sketch/extrusion350mm3 remains editable. Offset2→3 shifts actual solid bounds by the selected normal with unchanged volume.

Forged entry, other owner and wrong topology kind fail without revision/Undo mutation. Replacing owner geometry with a distinct native copy produces explicit repair failure; restoring the source permits a valid edit. Explicit prospective sources without a resolver fail instead of borrowing live state. Native Box depth20→40 updates plane z22→42 and refreshes selector to exact current +Z face; prior downstream rollback and transaction gates remain passing.

Focused33/33, zero failures/skips; full linked Release CTest226/226 in73.53s; self-test0. Included XML, full CTest, original behavioral RED and source hashes.

## Remaining scope

This packet is not complete client integration or general topology-history reconstruction. Indexed native replacement requires explicit repair when identity is lost; arbitrary maker histories and advanced imported direct edits remain future full-goal work. Canonical/session schemas, Desktop/Quest/MCP, client/process crash recovery, fresh independent review and exact integrated-head CI remain open. No acceptance/merge/release claim.
