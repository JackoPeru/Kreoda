# Phase13 Task1: native preview LOD identity

Bounded correction only. `BuildPreviewMesh` already tessellates level0; SetDimension/isPreview incorrectly tagged its native MeshUpdate as level1. Dispatcher now returns the actual level0. Committed parameter edits and committed mesh requests are unchanged.

## Actual verification

- Added the level0 assertion to `Topology.PreviewDoesNotCommit`, retaining candidate999×50×20 volume and unchanged committed revision/volume checks.
- Actual native RED: the binary response reported1 instead of0; exit1. Log: `C:\Users\matte\AppData\Local\Temp\kreoda-phase13-native-preview-lod-red.log`.
- Rebuilt Release core and test executable; targeted GREEN passes, exit0. Log: `C:\Users\matte\AppData\Local\Temp\kreoda-phase13-native-preview-lod-green.log`.
- Full actual OCCT native suite:157/157,0failures,0errors,61.691seconds; exit0. XML/log: `C:\Users\matte\AppData\Local\Temp\kreoda-phase13-native-tests.xml` and `kreoda-phase13-native-tests.log`.
- Current native core `--self-test`:OK. Core SHA256:`29c52c643116b08e76f9bcb01f3da37cb364a6729b9c7c46e8dbc71a396cf50b`.
- Fresh reviewer native thread:`01a1262d-e68a-7050-8dbd-8bfd82f76cfd`, actual model`gpt-6-sol`, effort`high`, verdictSHIP for this correction only. Actual sandboxdanger-full-access/profiledisabled; read-only by conduct, not enforced isolation.
- All763 nonignored source inputs unchanged before/after review, manifest SHA256:`b6af388b083e78a4e62b94793fc2283430c0176968f0709f70c4f0c602d2be97`.

## Boundary

Tasks2-7 in the Phase13 scope map are unimplemented. This does not prove spatial modeling, binary preview delivery or full Phase13 acceptance. The installed corrected foundation Quest APK and hidden production PC audit session remain unchanged; physical Phase12 UI retest and authenticated CAD workflow are still pending. Full Phases13-16 remain in scope. Exact hosted Phase12 UI source run38058087544 atfb00102 remains in progress at this recording. No merge/public release or headset capture.
