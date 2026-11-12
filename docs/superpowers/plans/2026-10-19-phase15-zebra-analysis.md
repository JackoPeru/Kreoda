# Phase 15 zebra analysis

Scope: implement real reflection-band surface inspection in the existing Desktop renderer.
The full Phases 12–16 objective remains unchanged. Parent execution follows the user's
explicit fallback after verified Luna quota exhaustion. Preserve concurrent changes.

The view reflects a fixed striped environment using interpolated native normals and the
actual view direction. Density and environment orientation are local presentation settings.
Retain native mesh identity, topology, selection, clipping, revision, Undo and saved geometry.
Reset presentation on document replacement. Use existing Three.js shader hooks; no dependency.
Expose compact accessible controls in the existing Properties drawer. Document the visual
tessellation limit; this is not a numeric continuity or curvature certification.

- [x] Observe RED for missing renderer behavior; implement material/uniform integration.
- [x] Verify state validation/reset, picking/selection, new meshes and clipping coexistence.
- [x] Hidden Electron/native model: actual GPU stripes, density/orientation changes, reversible
  baseline image, no shader failures or document mutation; inspect a real capture.
- [x] Build, focused regression, package/install if verified; record evidence and boundaries.

Quest zebra presentation remains a separate implementation step. Existing Quest MR Home,
automatic connection and normal sleep/proximity behavior are preserved in this packet.

Real GPU inspection exposed an existing native tessellation defect: the last triangle's
normal overwrote each shared vertex, including zero vectors at sphere poles. Added two
failing analytic-normal tests, then used OCCT's surface/UV normal computation, transformed
into world space and oriented per face. Sphere seams/poles, reversed faces, placement and
sharp cylinder caps pass. No topology or buffer-layout change. Broaden native regression
because this shared correction affects every client receiving meshes, including Quest.

Evidence: `../evidence/2026-10-19-phase15-zebra-verification.md`.
