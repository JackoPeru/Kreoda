# Surface foundation — verification and installation

20 October 2026; worktree `Kreoda-phase10-ci`. External QA:
`C:/Users/matte/Documents/Codex-tools/Native/phase15-surface-foundation-20261019`.

## Scope

Real uncapped SurfaceExtrude, SurfaceRevolve and SurfaceLoft bodies, commands
48–50. Closed loft profiles and full revolutions remain surfaces. Sketch
dependencies, numeric edits, recompute, undo/redo and OCAF/ICAD persistence remain
canonical. Surface summaries omit enclosed volume; their mesh compatibility slot
is zero. Explicit volume/mass/thickness queries reject surfaces. Global physical
queries count actual solids.

Desktop exposes localized types and extrusion/revolution properties. Quest renders
and selects surfaces from either side, including face highlights. Section contours
have no filled surface caps. Analysis/preview toggles preserve material state,
native geometry, semantic indices, colliders and upload identity. Ordinary solid
picking remains unchanged; semantic surface picking checks current lineage,
visibility and world bounds, respecting nearer UI/solid blockers.

MR Home, automatic LAN discovery and all 113 original Quest actions remain.
The six remaining general surface operations are still required in the full goal.

## Routing and corrections

Task `01a15601-8780-7892-ab67-d4ca841baa0f` used GPT-6-Luna/Max, confirmed in
`worker-routing.json`. Its correction turn failed on quota, “try again at 3:55 AM”.
The parent completed the user's authorized fallback and independently verified it.
No fresh independent review, commit, push or hosted CI result is claimed.

Original OCAF/PropertiesPanel bytes were recovered and SHA256-checked. Three worker
files outside its initial list were reviewed and retained: two Desktop body tests
updated for derived geometry kind, and Selection.shader's two-line `_Cull`
property/state addition (default remains Back). Their exact original bytes also
match the initial manifest. Unrelated dirty work was preserved.

Parent corrections with evidence:

- A native wire probe found fake mesh volume 1047.197551 mm³ on an uncapped cylinder.
  Tessellation now sums only actual solids. Curved surfaces, closed lofts and
  direct surface instances have durable regression checks.
- A new OCAF test first failed four checks: altered solid/surface instances survived
  Load and Resync. All three candidate gates now compare instance/prototype kind,
  including projection source staging. Valid solid/surface instances remain; nested
  instances stay unsupported. Stored extrusion parameters are checked before indexing.
- Initial native full run: 337/338. The projection test used const JSON indexing on
  an absent optional field. Its assertion now uses the schema's empty-array default;
  production projection behavior did not change.
- Quest ordinary picking originally used only Physics.Raycast. Its semantic surface
  path now handles back faces and nearer blockers without changing collider geometry.
- A focused RED test found the back-face selection highlight was culled. The owned
  selection material now reuses two-sided material handling and is disposed with
  the view. Shared solid materials remain unchanged.
- GPU utility repairs handle an untitled temporary batch scene safely and compare
  Color32 pixels in the same numeric range. Final renders prove selection, clipping
  and restoration; failed initial utility captures are retained in QA.

## Verification

- Native Release core/tests build passed. `parent-native-full-2.xml`: **340/340**,
  54 suites, zero failures/disabled, 108.095 seconds.
- `native-proof-3` and `native-proof-4`: actual OCCT 8.0.1 stdio/FlatBuffers runs.
  Areas 200, 628.3185307 and 1256.6370614 mm²; all three have zero solids and zero
  mesh volume, explicit physical-query errors, unchanged read-only revision and
  successful ICAD reopen. Mixed-document solid volume 6000 mm³, mass 0.006 kg at
  1000 kg/m³. Probe 4 additionally checks surface thickness rejection.
- Desktop production build passed. Full suite **382/382**, 69 files; command schema
  **19/19**, protocol **65/65**, generated session check: five artifacts.
- `electron-proof-3`: real hidden Electron/native/session/GPU workflow passed.
  Three creations allocate one feature each; invalid creation preserves revision.
  Real UI edit changes area 200→300 mm²; undo/redo and reopen pass. Front/back filled
  pixels 32766/41470, camera anchors and mesh identity retained, zero shader errors.
- `quest-focused-final`: **69/69**, zero failures/skips (controls, mesh lifecycle,
  section/analysis/selection). `quest-connection-1`: **26/26**, including canonical
  surface classification and per-PC identity tests.
- SourceOnly preflight: 113 actions, 37 panels, zero bounds violations/nonmodal
  intersections. This static check is distinct from executed Unity tests.
- `quest-plane-gpu-final` and `quest-cylinder-gpu-final`: actual Direct3D12 renders
  of exact native-provenance payloads. Front/back pixels 151796/151796 and
  150152/150152; section pixels 75896/75076. Selection changes both front/back
  images. Cylinder contour is closed (252 indices), with no cap. Restored pixels
  match baseline; mesh/collider/upload identity retained; zero shader errors.
- Scoped whitespace check passed. Before writing this report, all **1704** source
  files matched frozen package inputs and the guarded Quest build manifest. No
  source changed during the ARM64 build.

Editor renders do not prove physical MR visibility, comfort, hand tracking,
frame rate or a fresh headset LAN connection.

## Installation

Desktop retains the existing installation and user-data paths. All 119 files match
the produced package; only Kreoda.exe, app.asar and the core changed. Original files
are backed up in QA `desktop-before-update`. Native SHA256:
`ed46a3ee19f2167a16c28c282f61cf28009f15cd3cfb4d77315107583276a4ce`.
ASAR SHA256: `b7d0c0b0d8eb938f0ee64a75dbd1d576a183a82ec1b2e208e9a1f8543a3dbe62`.
PID 29536 started hidden, window handle zero, native ready logged. Trusted-device
JSON remained semantically and case-sensitively identical.

Canonical Quest ARM64 build succeeded: direct exit 0, zero errors, five warnings,
only arm64-v8a libraries. APK 43,689,929 bytes, SHA256
`21873d67aa57551bee90e0e65781271d4cce413ef1c7658e4d503c2cceddce73`.
Quest 3 `2G0YC1ZFB8043H`: old APK backed up (SHA f22f6535…), install-r Success,
normal launch Status ok / COLD. Device sha256sum matches the built APK exactly.
Initial bounded PID-25637 log has no selected fatal/null-reference marker and no
fresh connected/model marker. No wake/proximity/Guardian override was used.

## Runtime limitation and remaining full goal

The old local MCP listener was already absent. Automatic approval review rejected
both the configured voice-bridge start and a CAD-only local bridge start, returning
only “blocked by policy”, without a specific reason. No other execution mechanism
was used to retry that action. The bridge remains stopped; live MCP/voice availability
is not claimed. Existing private configuration remains in place. No SSH, Tailscale,
Hermes inference, STT/TTS request or remote restart occurred.

The full goal stays active. Remaining: general surface sweep, offset, trim, extend,
sew/stitch and thicken; remaining assembly relations and general direct face editing;
bridge runtime restoration, live Hermes/voice benchmarks and physical Quest
acceptance. This report does not complete Phases 12–16.
