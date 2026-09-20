# Phase 8 (bug-hunt hardening) → handoff — PHASE 8 COMPLETE

The Phase 8 bug-hunt (C1–C15, M5–M17 + minors) is fixed and verified. Every
item below was either fixed, or consciously scoped with the reason noted.
Full verification is green in a single clean pass (see bottom).

## CRITICAL fixes

- **C1 FB/JSON sniff collision** — a FlatBuffers uoffset low byte may be
  `0x7B`. Decoding is now verify-first (`tryDecodeMeshUpdateFb` with loop
  caps + count/triplet checks), JSON only on verification failure, honest
  corruption error last (`decodeMeshFrame`). New routing tests (FB / JSON
  error / garbage). `main.cpp` self-test uses a real `Verifier`.
- **C2 `escape()`** — full JSON string escaping (`\" \\ \b\f\n\r\t`,
  `\u00XX` controls); OCCT `what()`/paths can no longer break envelopes.
- **C3 `find_raw` confusion** — envelope gate at dispatcher entry:
  `documentId` charset/length, paths reject quotes/controls. Full strict-DOM
  parsing is the documented follow-up (nested ids are frontend-generated,
  so the realistic vector was paths).
- **C4 sync split-brain** — summaries commit first, meshes best-effort with
  collected errors; the viewport tolerates absent meshes. `replaceAllMeshes`
  no longer rebuilds features from mesh keys (that would drop failed bodies
  from the tree after committing their summaries).
- **C5 revision guards** — `setFeatures`/`upsertMesh`/`replaceAllMeshes`/
  `setSketches` drop older revisions; `epoch` (bumped by `resetDocument`)
  drops pre-reset lineages. **Plus the follow-on real bug this exposed:**
  core revisions reset on document replace, so post-reopen commits were
  dropped — fixed by `resetDocument` on every open/restore path (phase5
  caught it: blind hole vanished while old state passed assertions
  vacuously).
- **C6 mesh-cache cross-doc** — key is now `documentId|feature|lod|revision`
  and the cache clears on Create/Open. Cache stores `CoreMesh` (not encoded
  bytes) because the FB table echoes the per-request `requestId` (C15).
- **C7 glTF hierarchy** — DFS from scene roots with accumulated world
  transforms (matrix + normalized TRS), depth cap 64, honest index errors.
- **C8 sew tolerance** — from bbox diag (`max(1e-7, 1e-9·diag)`), same
  tolerance for degenerate tests (was exact-zero).
- **C9 DoS bounds** — 5M-triangle sew cap, 512MB file cap, honest
  `MESH_TOO_LARGE`-style errors.
- **C10 abort rollback** — `CommitImportedSolids` removes ShapeStore entries
  + graph nodes + rebuilds the DocumentStore registry on abort (all four
  registries airtight).
- **C11 OCAF RAII** — `OcafTxn` guard in the shared importer (abort on any
  throw); no more wedged half-open commands.
- **C12 stdout framing** — default-messenger printers detached GLOBALLY at
  sidecar startup (LogCore already goes to stderr); `ScopedMute` stays as
  defense in depth (now null-safe, restore-clears-first).
- **C13 unverified manifest** — `check-updates` handler verifies signature
  before announcing; renderer banner is post-verify only.
- **C14 streaming download** — stream-to-partial + incremental sha256 +
  rename-on-match; strict filename allowlist; explicit redirect refusal.
- **C15 FIFO correlation** — `request_id` added to `MeshUpdate` (schema
  regen both sides); sidecar correlates by id (JSON parse or FB field),
  duplicate in-flight ids rejected; FIFO array deleted. Self-test asserts
  the echo; E2E pipelined hydration proves it end to end.

## MAJOR fixes

- **M5** quaternion normalized (zero-length rejected). **M6** partial
  exports fail loud with body ids (STL/OBJ fail-loud by construction).
- **M7** mint ids: fresh stream per id, cross-store (solids+sketches) check.
- **M8** mute restore clears first, null-safe. **M9** pool limit clamped.
- **M10** autosave re-reads revision post-await; per-op unique temp dirs
  (pid+counter) with cleanup on every path (open success leaked before).
- **M11** engine gate: `commandAvailability` + both `execute*` refuse while
  down ("geometry engine not running"); unit setups simulate connection +
  dedicated gate test.
- **M12** bundles redacted by default (counts/types/versions, home-dir
  scrubbed) + explicit full-model checkbox (ref-mirrored, no stale closure).
- **M13** opt-out purges the queue via store subscription (no import cycle).
- **M14** decoder reset on corrupt frames (TS bridge + C++ loop).
- **M16** OBJ mm convention commented + handoff-noted.
- **M17** 3MF unknown unit fails loud.
- **GLB write** implemented (minor→done): `.glb` saves, open filter already
  had it; ctest uses the real writer now.

## Deliberately deferred (documented, not dropped)

- Full strict-DOM envelope parsing (C3 follow-up); per-op journal
  (snapshots cover correctness); silent auto-install (no signed install
  pipeline — verified bits revealed instead); mesh LRU / single-action
  hydration (works, tested); `__intentcad_test` in prod (the E2E seam);
  AbortSignal hydration cancel; `mesh_body`/C++ base64 header removal
  (done: mesh_body deleted); nested-glTF stress files beyond the suite.

## Verified (single clean pass)

- `pnpm -r lint/test/build` green (protocol 14, desktop 44).
- ctest 73/73 + `intentcad-core --self-test OK`.
- Playwright 17/17 (23.8 s). The phase5 regression from the first C5 cut
  is fixed by the epoch design and green.
