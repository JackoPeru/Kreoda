# Phase 2 → Phase 3 handoff

Phase 2 acceptance (§61) is green: face/edge references are persistent
(UUID + TNaming/role, never array indices) and survive parameter changes
plus save/reopen; picking works per body/face/edge with stable backend ids.

## Verified Phase 2 results

- Live OCAF document: per-feature labels (UUID name + params comment),
  TNaming evolution recorded on rebuild (per-face `Generated` pairs matched
  by role; solid replaced via XCAF `SetShape`). Commits are atomic
  (store + OCAF mirror, rollback otherwise).
- `SetFeatureParameter` (type 6): box width 100→150 gives exactly 150000 in
  one revision step; `isPreview` tessellates without committing (revision +
  volume untouched).
- 8 topology regression tests: top face / cylinder cap / sphere face survive
  rebuilds (role + area checks); invalid rebuild keeps old geometry and
  revision; selection survives save/open; invented roles never resolve.
- Resolution order (§3–§4): TNaming `CurrentShape` with `IsSame` geometric
  proof first, semantic role fallback second, honest invalid otherwise.
  `via` is reported ("role" today; flips to "naming" when post-rebuild
  re-solve lands — the test pins current behavior).
- Edges: `edge.lin.box.+Z~box.+X`-style ids from curve type + adjacent face
  roles; box exposes 12; overlay + Line-threshold picking (note: three
  reports the segment's start VERTEX index, mapping uses index/2).
- UI: per-face groups + material swap highlight, edge overlay, Auto/Body/Edge
  filter, face/edge ids in one selection model (`uuid` / `uuid:role` /
  `uuid:edge…`).
- E2E phase2: create → select `box.+Z` → width 150 → same face id selected,
  volume 150000 → save → reopen identical (id, volume, face).

## Hard-won notes (do not regress)

- OCCT 8: `Build()` explicitly before `IsDone()` (lazy makers).
- One TNaming evolution kind per builder: `Modify` + `Generated` on the same
  label conflicts ("not same evolution") — rebuilds record per-face
  `Generated` pairs only.
- OCCT includes must precede `namespace kreoda` (an include inside the
  namespace injects OCCT into it and breaks `<iostream>` with /permissive-).
- `TopoDS_Shape::Location()` is a getter; copy the edge before transforming.
- Zustand selectors must return stable references (see phase-1 notes).
- Kernel must never throw across IPC: every OCAF/TNaming entry point is
  wrapped (`Standard_Failure` → error envelope), verified by hostile-entry
  tests.

## Phase 3 entry (§61: feature graph + parameters)

1. Feature DAG with dirty propagation + topological recompute (§53–§54).
2. OCAF document transactions → Undo/Redo mapping (§12).
3. Typed command registry wired to core (single definition drives UI+AI, §19).
4. Dimension editing + primitive direct manipulation (manipulator metadata).
5. `flatc` codegen from `schemas/cad_protocol.fbs` (C++ + TS together).
