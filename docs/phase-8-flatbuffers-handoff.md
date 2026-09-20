# Phase 8 (FlatBuffers mesh migration) → handoff

Mesh payloads cross the wire as FlatBuffers `MeshUpdate` tables — §8
("mesh data must not be JSON") is closed. Commands, errors and summaries
stay typed JSON (versioned + zod-validated per §63.10); framing is untouched
(`[u32 len][payload]` is byte-oriented already). `MeshUpdate` gained
`volume_mm3`/`bbox_mm`/`revision` via schema evolution, regenerated both
sides with the same flatc.

## What landed

- `schemas/cad_protocol.fbs`: `MeshUpdate.volume_mm3/bbox_mm/revision`;
  regenerated C++ + TS (`pnpm codegen`).
- `native/.../protocol/mesh_fb.{h,cpp}` (new): `BuildMeshUpdateFb`
  (zero-copy-ish byte vectors, counts in elements, faces/edges ranges).
- `dispatcher.{h,cpp}`: `handle_command`/`make_response` return bytes; JSON
  responses byte-identical; `kRequestMesh` + preview return finished
  `MeshUpdate` (revision-keyed cache now stores encoded FB); `mesh_body` and
  the C++ base64 include are deleted (base64.h header itself stays for now —
  remove when nothing includes it).
- `main.cpp`: byte framing in the loop; self-test verifies the mesh via the
  generated C++ bindings (12 tris, `box-1:box.+Z`).
- `@kreoda/protocol`: `decodeMeshUpdateFb` (count cross-checks, triplet
  checks, safe revision) + `isJsonResponse` sniff (`{` = JSON legacy/error).
- `coreClient`: `requestMesh` + preview path sniff (errors stay JSON).
- Tests: `tests/rpc_text.h` (`rpcText`/`rpcBytes`/`meshRoot` verified-decode);
  converted undo/topology/sketch/solids/persistence/meshcache suites to FB
  assertions (volumes via `volume_mm3`, triangles via `indices_count`);
  protocol `codegen.test.ts` gains MeshUpdate round-trip + corrupt-frame
  honesty; main self-test covers the wire.

## Verified

- `pnpm -r lint/test/build` green (protocol 12, desktop 39);
  ctest 73/73; Playwright 17/17 (every mesh pull now decodes FB).

## Hard-won notes (do not regress)

- Decoded FB views borrow the response bytes: helpers must OWN the vector
  for the whole parse (dangling temporaries read freed memory — looked like
  "0 triangles" in UndoRedo). `meshRoot(bytes)` contract documents this.
- B-Rep mass at precision 17 is rarely an exact integer string — parse and
  `EXPECT_NEAR`, never substring-match volumes (also fixed in main self-test
  doctrine long ago; same rule for FB `volume_mm3`).
- Face ORDER is tessellator-defined: assert role presence by scan, never by
  index (`Get(1)` is `box.+X` here, `box.+Z` elsewhere).
- A stale `kreoda-core.exe` once masked a missing branch by round-tripping
  a misnamed zip — always check exe timestamp + link exit code after native
  edits (same lesson as the STL slice).
- One full-suite E2E flake (phase5, 39 s loaded run) cleared on clean re-run;
  standalone green. Stagger workers if flakes recur.
- Remaining Phase 8: signed updater (certs/infra), license notices (done),
  large-model (done), recovery (done), exchanges (done), topology tests
  (done), final bug-hunt.
