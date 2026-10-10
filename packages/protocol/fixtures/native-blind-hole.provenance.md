# Native blind-hole MeshUpdate fixture

`native-blind-hole.meshfb` is a 12,168-byte FlatBuffers frame captured from the
actual core used in the hosted Packet 2 reproduction. SHA-256:
`55439bd83ce5ab6ba050576e3e7912da0cde0c433cc5eb0ea4ebc00a0e4f142a`.

The core executable was
`C:\Users\matte\Documents\Codex-tools\kreoda-phase11-geometry-complete-afcf09131b204c79a2f1488eca44b895\kreoda-core.exe`,
SHA-256 `80d7120494a298ab4ce74a5f6790bf94a8d4dab920b5bb79bafc259eb06ee99c`.
The direct framed-stdio sequence reproduced the phase 5 flow: create a
100×50×10 mm box; create a through hole; Undo; Redo; save and reopen the
project; create a blind 8 mm hole at (20,20) mm with depth 5 mm on the original
box; request the blind-hole mesh at LOD 1.

The frame contains 264 triangles and 68 edge vertices. It intentionally
retains these native ranges verbatim:

- `hole-blind:box.+Z`: triangles `[4,71)` and `[203,264)`.
- `hole-blind:edge.cir.box.+Z~wall.0`: edge vertices `[18,39)` and `[47,68)`.

The Desktop FlatBuffers decoder rejected the frame because its semantic ID
uniqueness guards treated repeated IDs as corrupt; `tryDecodeMeshUpdateFb`
swallowed that validation exception and the caller reported the generic
“neither FlatBuffers nor JSON” error. Geometry vectors and spans are finite,
in-bounds and non-overlapping.

The native `validateReferences` query for both repeated IDs returns
`valid:false`, with `AMBIGUOUS_REFERENCE` and “reference resolves to multiple
entities” for each. The decoder therefore preserves every distinct span while
selection/action validation continues to reject ambiguous semantic references.
