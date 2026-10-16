# Native datum review corrections

Status: parent implemented and locally verified; fresh corrected review ship (see REVIEW.md), limited to c71b532. No Phase15.1 or full-goal acceptance.

The separate GPT-6-Sol/High review of fa78baf..5b01f752 returned fix-first (see ../2026-10-14-datum-desktop-integration/REVIEW.md). The verified Luna/Max implementer then failed with a usage-limit error before changing source. Per the user's explicit quota fallback, the parent continued implementation; no replacement Luna task was spawned.

## Corrections

- All ten native definition variants and nested point/plane/axis sources reject unknown keys before geometry commit, matching canonical strict schemas. Persisted selectionEntry remains allowed only on face/edge refs with canonical length/format; persistent topology IDs retain the512-character bound.
- Prospective datum staging validates that each Datum sketch refers to an incoming DatumPlane, and refuses supportRef on principal sketches. It never resolves that support from unrelated live state.
- OCAF staging no longer skips validation when Datums metadata is empty or absent. Incoming saved supported frames must match their resolved incoming plane (origin1e-7 mm, basis1e-9). This frame comparison is in persistence staging, not the ordinary UpdateDatum pre-rebuild path; legitimate dependent recompute remains valid.

## Evidence

- Behavioral RED: three new tests failed before implementation. Unknown keys were accepted and mutated registry/revision/Undo; malformed incoming .icad replaced the healthy live document and cleared its Undo/Redo. Raw review-red.log retained.
- Root/nested key tests cover all ten valid constructors with extra keys; native mutation tests assert unchanged healthy body volume, registry, revision and Undo on rejection. Existing public protocol test now rejects a decorated noncanonical principal definition before creating a valid one.
- Actual .icad fixtures cover absent support, entirely absent named Datums root, wrong-kind support, stale saved frame and inconsistent principal/support pair. Each invalid open preserves a healthy body and a same-UUID live plane, registry, revision and both Undo/Redo depths. These are real OCCT/OCAF/ZIP opens, not mocked metadata tests.
- Release native build succeeded. Focused datum/persistence suite46/46; final complete CTest229/229, zero failures/disabled,90.07 seconds. Final full suite includes the absent-root fixture added after the first focused run. XML and raw logs retained.
- Parent actual hidden Desktop/native E2E rerun after kernel correction:1/1 in30.0 seconds; plane/sketch/extrude, measured35000 mm3, offset30, geometry Undo24 and actual .icad reopen30 remain valid.
- Desktop265/265, managed241/241, protocol51/51, generated contract and TypeScript gates remain from the preceding unchanged client packet; they were not redundantly rerun for this native-only correction.

No Hermes/server/SSH/AI/device/microphone/camera/PC audio/foreground GUI calls. Primary user checkout unchanged. No push, merge or release. Quest datum integration, actual MCP-native datum mutation, new-head CI, live Hermes and physical headset gates remain open.
