# Phase 15 curvature visualization — 19 October 2026

## Delivered behavior

Native OCCT samples maximum absolute principal curvature at the same UV nodes
as each CAD face mesh. Units are inverse millimetres. Planes are zero; cylinder
walls and spheres use their analytic inverse radius. General surfaces use
`BRepLProp_SLProps`. Singular, undefined or nonrepresentable samples are -1,
not an invented flat value. Face boundaries keep distinct vertices. Geometry,
indices, persistent IDs, feature history and CAD dimensions are unchanged.

The optional packed-float `curvature_max_abs_per_mm` field is appended to
MeshUpdate without changing existing field offsets. Only the affected C++, TS
and C# bindings were copied from private flatc output; concurrent generated
files were not deleted. Both readers validate count, finiteness and the
nonnegative/-1 domain before allocating the analysis array. Legacy frames
remain valid and explicitly lack curvature data.

Desktop Properties exposes the heatmap, numeric physical maximum, automatic
scale and blue-to-red legend with corresponding radius. Quest reuses the
Section screen: one additional Curvatura selector, contextual maximum/automatic
scale controls and a physical legend. No additional panel. The same hand/pinch
button route is used. There are now 112 actions and the same 37 semantic panels.

Both clients preserve native mesh identity, semantic picking, section clipping,
preview distinction and shared materials. Curvature and zebra are mutually
exclusive. Document replacement clears presentation. Unknown samples display
neutral gray; a legacy-only document cannot pretend that curvature is available.
An already enabled analysis remains switchable off if its new mesh lacks data.

This is sampled surface visualization with float32 values and interpolation;
it does not certify global minima, continuity or minimum wall thickness.
No new query, CAD mutation command, dependency or remote inference was added.

## Verification

Private QA: `C:/Users/matte/Documents/Codex-tools/Native/phase15-curvature-20261019`.

- Native initial RED: 2/2 tests failed because no samples were produced. The
  analytic cases then passed while the new wire test failed on the missing
  field. Final mesh/normal/cache subset: **7/7**.
- Full native regression: **319/319**, 53 suites, 79.826 s, zero failed/errors/
  disabled. Subsequently added the general-surface ellipsoid check; all four
  curvature tests pass, including it. Its rational surface samples agree with
  the analytic ellipsoid shape operator to 2e-5. The ellipsoid spans curvature
  below .04 and above .35, so this checks variable curvature as well as the
  constant primitive paths. Sphere placement/scaling/reversal and sharp
  cylinder cap/wall separation are covered.
- TS protocol RED: eight failures exposed lost valid samples and accepted
  malformed fields. Final protocol **65/65**, build and typecheck exit 0.
- Managed RED: seven of eight cases failed because valid samples were ignored
  and malformed samples accepted; legacy payload passed. Final mesh subset
  **29/29**, full SessionClient **169/169**, no skips/failures, actual TRX files.
- Desktop viewport RED: missing setCurvature; state RED: missing setter.
  Final viewport/zebra/section subset **22/22**, state/zebra/app **14/14**;
  full Desktop **363/363**, 66 files. TypeScript/Vite/Electron build exit 0.
- Actual hidden Electron + native OCCT + GPU: curvature and zebra **2/2**,
  23.6 s; final guarded-build curvature rerun **1/1**, 11.2 s. Radius-60 sphere
  volume 904778.6842338605 mm³, automatic scale .01666666753590107 mm⁻¹,
  48,400 red crop pixels, real control changes, exact bitmap restoration,
  unchanged mesh identity/revision/snapshot and zero captured shader errors.
  Full `curvature-controls.png` and sphere crop were inspected.
- Quest runtime RED: two missing real curvature actions. Runtime/mesh subset
  **16/16**; full Editor **190/190**, zero failed/skipped. Final controls/section
  **60/60** after allowing active legacy-data mode to be disabled. Saved scene
  gate **1/1**, without calling Prepare. Known SceneTests changes to the saved
  scene/materials were restored from exact pretest backups.
- Actual Unity GPU **Direct3D12**, native 11,936 triangles: 313,455 changed
  pixels, 313,455 scale-change pixels, 98,399 section-change pixels, 301,532
  red pixels, maximum .01666666753590107, exact restored baseline, preserved
  native mesh/upload identity, shader errors []. Actual sphere and UI images
  inspected. All 13 UI manifest hashes match. These are Editor captures.
- Source-only structural/geometry gate: 112 actions, 104 literal action call
  sites, 37 rectangles, zero out-of-bounds/nonmodal overlaps. This supplements
  the executed Unity click-target and input tests. Scoped whitespace checks pass.

Native fixture SHA-256:
`b8c8deb80524a570fd8bde36dcc596f3b4ed4d723629d940312612b3b13c146c`.

## Builds and installation

No source edits occurred during guarded builds. Desktop package guard:
**1,678 inputs, changed []**. Normal Quest ARM64 build: direct exit 0,
**Succeeded, 0 errors / 2 warnings**, source changes [], only arm64-v8a.

Desktop installed at the existing firewall-authorized path:
`C:/Users/matte/Documents/Codex-tools/kreoda-phase12-pc-20261010/kreoda-win32-x64`.

- Verified old owned main process was hidden and had no new native activity
  since 11:20. Stopped only its process tree; backed up program and original
  UX profile before replacement. All **119** installed package files hash match.
- Restarted with original profile and --start-hidden. Main PID **26428**, window
  handle **0**, actual native sidecar ready. LAN listeners **192.168.1.7:53808/
  53809**. Stored device JSON remained byte-for-byte identical to the backup.
- Native executable SHA-256:
  `e30b896982a05bb295316b82e090833a9921271b2258ef04edb1d25274a2252f`.
- Installed app.asar SHA-256:
  `66bb1b3c4eb6f20049789626ec1f9ca61287442afebe95e2fde54c202a5a1862`.

Quest 3 **2G0YC1ZFB8043H**, com.kreoda.quest:

- Previous APK backed up; `adb install -r` returned **Success** and normal
  launch returned **Status: ok / COLD**. Pulled installed base.apk back and
  verified exact equality to the guarded build: **43,690,877 bytes**.
- New APK SHA-256:
  `31373b3e12e274852bc4d168887c5b2e96859179007bdbfd33a0a3f3c296ae00`.
- Previous APK SHA-256:
  `12fd23a1c6115a707fe9d7a6a7999ba77e11302dce6b84f45f57d399e58f3a48`.
- Process **5645** exists. Current bounded log inspection found no fresh
  KREODA_CONNECTED marker; installation/launch is not fresh physical LAN or
  in-headset acceptance. No wake/proximity override or Guardian change used.

## Scope boundaries

Parent continued under the user's explicit fallback after verified Luna/reviewer
quota exhaustion. No fresh independent review. No commit/push/new hosted CI or
release claim. Concurrent dirty work preserved. No foreground PC window and no
Hermes, SSH, Tailscale, image-generation, STT or TTS call.

In-headset visibility, hand tracking, comfort, performance and a fresh physical
connection remain open. Minimum thickness, general surface modeling, remaining
assembly/direct-edit work and full live-agent/Phase16 acceptance also remain
open. The original full Phases 12–16 goal stays active.
