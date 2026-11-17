# SurfaceThicken bounded acceptance — 21 October 2026

## Delivered behavior

Command 54 `CreateSurfaceThicken` produces one independent editable solid from
one connected surface body or its direct current instance. Signed `thicknessMm`
has absolute range 1e-6–100000; `toleranceMm` defaults to 1e-6, range 1e-7–1.
Existing command IDs 1–53, including planar face command 46, are preserved.

The exact OCCT `BRepOffset_MakeOffset` path uses skin mode, arc joins and
thickening. Copied source faces must survive in the raw output and every source
face must have a distinct final offset image present in that output. Closed
source skins require at least two closed boundary shells. This rejects the
observed OCCT inward-sphere collapse which otherwise reports successful valid
geometry. No shape-specific volume formula or approximate cap is in production.

Input requires a pure connected valid surface, at most 4096 faces, finite area
and bounds, no loose topology, non-manifold edges or self-interference. Result
must retain all topology in exactly one valid closed material solid, with finite
positive volume after normalization of an owned copy. Creation, numeric edits
and upstream rebuild share this evaluator; rejected changes remain atomic.
Source geometry, parameters and visibility are preserved. Independent solid
metadata, lifecycle, direct instances and physical queries use ordinary paths.

Desktop offers the seventh operation in the existing compact Surface panel,
with source selection, signed thickness, advanced tolerance, EN/IT hints and
editable properties. Hidden sources remain selectable. The ordinary command
fence and native CoreClient path are retained.

Quest classifies the new result and solid instances as solid. Runtime and shaders
were unchanged. The offline Editor utility recognizes the new solid and reuses
bounded triangle-centroid rays when a camera center ray passes through a hole.
All old selection and section-cap assertions remain enabled.

## Ownership and source preservation

Separate worker task `01a15f2d-6743-79d2-be4d-7a5df286adb7` ran GPT-6-Luna/Max,
verified from runtime metadata. During its implementation quota failure, the
parent used the user's explicit quota fallback to finish the product, fix test
fixture assumptions and implement the Desktop/contracts. Luna resumed for
focused Quest verification and the narrow Editor capture helper. No reviewer
lane, commit, push, hosted CI or release is implied.

Global baseline: 1731 files; final build inputs: 1733 files. Exactly 30 product
files changed or were added relative to the preserved dirty baseline, including
the two new native files. All 29 parent preimage entries matched their saved
hashes. Only the Editor capture helper changed after the Desktop source freeze;
Desktop's 672 packaging inputs were stable. APK's 1733 before/after source hashes
were equal. Unity temporarily serializes DevAgentSettings during its build;
final wrapper and independent source checks confirmed restoration without any
manual reset. The earlier check attempted during compilation was premature;
post-build checks passed. Existing dirty work and the human checkout were kept.

## Verified gates

| Gate | Actual result |
|---|---|
| Full native Release suite | 365/365, 57 suites, zero failures/errors/disabled; 102.451 s |
| Full Desktop suite | 448/448, 76 files, original timeouts, two workers |
| Shared command schema | 22/22 |
| Protocol | 65/65 |
| Focused Desktop | 53/53; included in full suite |
| Quest focused EditMode | 40/40: Connection 26, Section 14; zero skips/failures |
| Native core/tests build | Exit 0, real OCCT, canonical native build directory |
| Desktop build and package | Both exit 0; 672 package inputs unchanged |
| Normal Quest ARM64 build | Exit 0, Succeeded, zero errors, seven warnings; 327.705 s wrapper |

The initial native RED was an actual discovered test failing UNKNOWN_COMMAND for
54 after its setup compiled. Later failed inherited tests concerned L fixture
area, measured source orientation and comparing bbox array pointers; corrected
expectations follow the actual public fixture construction. Initial stdio proof
included the variable mesh requestId in a geometry fingerprint; the corrected
fingerprint omits only requestId/revision. Failed evidence is retained.

Actual canonical stdio native proof created 15 solids across seven analytic
shapes, both signs and a translated surface instance. It covered 16 malformed,
collapse and duplicate requests, atomic rejected edits, thickness/tolerance edits,
upstream sketch rebuilds including instances, Undo/Redo, physical totals and
`.icad` reopen. Final measurements and creation-time mesh provenance are separate.

Hidden Electron GUI proof used ordinary form creation for cylinder ±1, sphere ±1
and torus +1, validated native volumes, hidden-source preservation, an atomic
sphere collapse with retained fields, one property commit using cm input,
Undo/Redo and save/open. Both 1600×1000 and 800×600 captures were inspected;
compact panel remained readable without horizontal overflow. No JS/shader errors.

## GPU section evidence

Pinned Unity 6000.3.25f1, hidden D3D12, actual command-54 native mesh frames.
The first cylinder capture correctly failed the center-ray assumption; Luna
extended the existing Sweep fallback only to SurfaceThicken and recaptured both.
Sphere and cylinder captures exited 0. Parent inspected both ring images and
independently counted pixels with System.Drawing:

| Fixture | Section | Cap pixels clipped side | Retained side | Center 9×9 |
|---|---|---:|---:|---|
| Sphere +1 | X=0 | 55195 | 0 | Background |
| Cylinder +1 | Z=10 mm | 20447 | 0 | Background |

Both isolated the cap renderer with the main body disabled, preserved semantic
face identity/collider, restored renderer/culling state, matched mesh and native
hash provenance, and recorded no shader errors. These are Editor GPU results,
not headset FPS/comfort or physical hand acceptance.

## Installed artifacts

PC target remains the same executable under the root `.artifacts/Codex-tools`.
The old runtime was absent, so no user session was stopped. Full 119-file package
and original UX profile were backed up. Exactly three installed files changed:
Kreoda.exe, resources/app.asar and resources/kreoda-core.exe. All 119 final hashes
matched the package. The normal original-profile process 37340 was launched
with --start-hidden; its main window handle was zero. Authenticated read-only
identity proof v2 confirmed PC UUID 34669a1f-68fa-4153-b0c1-916a24a15a2f and
command54 catalog, empty document and no transaction. Saved device JSON bytes
were unchanged after authentication; no enrollment was performed.

- Native SHA256: `21d9a9c55135d2fa00667ea3484b2824fb139ea33caf01bd84ba154335bc3335`
- ASAR SHA256: `cd363200d45944298170abeece8c68f56d99e258d3dd74661a1d9e83f8628792`
- APK SHA256: `4013d5558c3417dc79a94e7ea47287f6d642ddc795329bc240bb9b1f2f559206`

Quest serial 2G0YC1ZFB8043H: previous APK backed up and its live hash rechecked;
`adb install -r` returned Success. Normal UnityPlayerGameActivity launch returned
Status: ok; actual installed base.apk was pulled and its hash matched the build.
PID27330 remained alive at the bounded recheck; no fatal startup marker observed.
APK contains arm64-v8a only and passthrough/hand-tracking features. No app-data
wipe, credential read, uninstall, wake/Guardian/proximity override occurred.
The PC snapshot after installation showed Desktop and test clients only;
new physical Quest connection/hand/comfort/performance acceptance is not claimed.

## Evidence and remaining goal

Full artifacts, preimages, logs, source manifests, direct native and GUI proof,
GPU captures and install readback are below:
`C:/Users/matte/Desktop/Saas/Kreoda/.artifacts/Codex-tools/Native/phase15-surface-thicken-20261021`.

Full original Phases12–16 goal stays **active**. Surface trim/extend, remaining
advanced sketch constraints, assembly/direct-edit requirements, other original
Phase16 rows, live Hermes/voice when allowed and physical Quest acceptance remain
subject to their complete original requirements. The dated 13 October audit is
historical where later accepted packets supersede it. New GPT-6-Luna/Max task
`01a16023-5e8a-70a3-941a-8417043dcbd7` is researching trim/extend in an isolated
root research folder; product edits are not yet authorized for that tranche.
Hermes/SSH/Tailscale/AI/STT/TTS were untouched. TCP9843 bridge remains stopped
after the prior automatic approval denials; no retry or bypass occurred.
