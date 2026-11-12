# Surface sew and offset — verified and installed

20 October 2026; worktree `Kreoda-phase10-ci`, branch
`codex/phase12-quest-foundation`. External immutable evidence:
`C:/Users/matte/Documents/Codex-tools/Native/phase15-surface-sew-offset-20261020`.

## Delivered scope

Commands 51 `CreateSurfaceSew` and 52 `CreateSurfaceOffset` create independent,
associative bodies, preserving source geometry and visibility. Sewing supports
surface output and explicit solid conversion only for a genuinely closed manifold
shell; it does not invent end caps. Signed offset uses exact OCCT offset geometry,
including curved surfaces. Invalid operations fail without document mutation.

`SurfaceSew` and `SurfaceOffset` are surfaces; `SurfaceSewnSolid` is a solid.
Exact shared classifiers preserve this distinction in native code, Desktop and
Quest. Numeric properties, upstream recompute, undo/redo and save/open follow the
existing feature lifecycle. New command metadata declares one created feature.

All product implementation was performed by separate GPT-6-Luna/Max task
`01a15932-da46-7f91-b796-885bb08535bb`; exact routing is recorded in
`worker-routing.json`. Parent performed architecture, diff review, external QA,
independent checks, packaging and installation. The parent runtime was
GPT-6.1-Sol/High; it was not represented as GPT-6-Sol. No additional reviewer lane.
Original dirty work and the human checkout were preserved. Preimages and hashes
are under `worker/preimage`, `worker-gpu/preimage`,
`worker-gpu/protocol-boundary/preimage` and `worker-gpu/desktop-volume/preimage`.

## Integration corrections

- Native whole-feature reference checks exposed internal kind `shape`, while the
  canonical session contract expects `body`. Luna corrected only the public
  boundary, retaining internal kinds and stale-reference guards. Actual Electron
  multi-owner binding now resolves ordered surface owners.
- The Desktop mutation-response parser required a volume for surface features.
  Luna aligned it with the canonical optional, finite, nonnegative volume field.
  No fake volume was introduced; genuine solid volume remains available. The
  actual UI error was captured before correction and is absent afterward.
- The offline Quest checker used already-converted Unity bounds as if they still
  used native axes. Luna corrected its plane placement and added explicit new
  fixture types, visible semantic-face selection and oblique section views.
- Existence of a CPU cap mesh did not establish that its material drew the cap.
  A final solid-only Editor check renders the cap alone from both half-spaces,
  with every other renderer disabled, then restores all renderer states.

## Parent verification

| Gate | Actual result | Evidence |
|---|---|---|
| Current native executable build | Exit 0 | `parent-core-build-2.log` |
| Native complete suite | 349/349, 55 suites, zero failures/skips | `parent-native-full-2.xml`, `.log` |
| Command schemas | 20/20, two files | `parent-command-schema-final.log` |
| Protocol | 65/65, five files | `parent-protocol-final.log` |
| Desktop complete suite | 393/393, 71 files | `parent-desktop-full-1.log` |
| Desktop TypeScript and Vite build | Exit 0 | `parent-desktop-build-2.log` |
| Independent real OCCT stdio | PASS | `native-proof-4/proof.json` |
| Actual hidden Electron/native/session | PASS | `electron-properties-proof-3/proof.json` |
| Canonical Desktop package | Exit 0; 663 inputs unchanged | `parent-desktop-package.log`, `desktop-input-proof.json` |
| Installed package and existing identity | PASS, all 119 file hashes | `final-delivery-proof.json` |

The native probe authors four loft walls and two separate caps for a 10×10×20 mm
shell. Surface sewing has area 1000 mm² and no solid volume; solid sewing has area
1000 mm² and volume 2000 mm³. Signed planar and cylindrical offsets are measured,
source mesh fingerprints remain unchanged, and invalid typed values/open-shell
solid requests are atomic. Numeric edits, undo/redo, persistence, document
validation, mass and sampled thickness are exercised. Thickness is sampled,
`isGlobalMinimum=false`, not a certified global minimum.

The hidden Electron workflow verifies actual multi-owner command binding, one
feature per creation, unchanged source visibility, numeric offset edit to 3 mm,
undo/redo, invalid sewing atomicity and save/open. No surface edit error remains;
after reopening, solid Properties explicitly displays `Volume 2.0 cm³`.
`native-summary-proof-1/proof.json` independently records genuine solid volume
before save and after open. No persistence correction was necessary.

## Quest GPU proof and installed runtime

Worker final captures cover five new fixture outputs plus legacy open extrusion
and full revolution. Parent independently captured signed offset, sewn surface
and sewn solid using the current executable and its actual mesh payload hashes.
Direct3D12 captures exit 0 with no shader errors, preserved mesh/collider/upload
identity, working face selection and restored preview/analysis material state.

- Offset cylinder: section pixels 161280 → 80640.
- Sewn surface: oblique pixels 108960 → 79200, Cull 0, no filled cap, zero volume.
- Sewn solid: oblique pixels 108960 → 79200, Cull 2, four cap triangles, matching
  cap collider, closed contour, genuine volume 2000 mm³.
- Parent final cap-only capture: **57600 pixels from the clipped negative
  half-space; 0 from the retained half-space**, cap Cull 2, all renderer states
  restored. The visible-side PNG was visually inspected. Evidence:
  `parent-gpu-solid-cap-visible/gpu-proof.json`, `exit.json` and the two cap PNGs.

Final Editor utility SHA256:
`c30187fae43a67f372c8460fcf6c017ddf3c4e11bfa3aeb10cb99ce4d39ba825`.
This last correction changes only the Editor proof utility. The installed Quest
APK from the separately verified Home MR increment remains applicable:
`469a1613210c62d61fce52e4a56ed92aed6c8ffdf4c8021cfbfda4551899e555`.
All 225 Android/runtime/schema/build inputs and eight staged managed libraries
match that build; no redundant Android rebuild or reinstall was performed here.
See `quest-installed-runtime-proof.json` and `final-delivery-proof.json`.

These are offline Unity Editor GPU checks, not new physical headset acceptance.
The previous Home MR packet retains its own 105/105 focused test and installed
APK evidence. Passthrough, hands, comfort, FPS and live network behavior were not
newly accepted by a person during this surface increment.

## Desktop installation

Target remains `C:/Users/matte/Documents/Codex-tools/kreoda-phase12-pc-20261010/kreoda-win32-x64`.
The original UX profile and shortcut remain in use. A fresh authenticated,
read-only discovery/session gate confirmed revision 0, no geometry, no active
transaction and no live Quest client before stopping the exact owned hidden app.
The program files and original profile were backed up before updating.

All 119 installed package files match the package manifest; only `Kreoda.exe`,
`resources/app.asar` and `resources/kreoda-core.exe` changed. New Desktop PID
36784 started with `--start-hidden`, window handle 0, native ready. Production LAN
discovery advertises the existing PC, session port 65036 at verification time.
The read-only installed catalog now includes both new commands.

- Native executable SHA256:
  `c9fac06bba3a7e142cda6c5a2db1677a2ccb7451b9268a979b9b475521680eac`.
- ASAR SHA256:
  `99b140c1aed76aa28a182c0c3a4966e29310e551d37b79d5d06ddc4ce66008bc`.
- Existing PC identity `34669a1f-68fa-4153-b0c1-916a24a15a2f` was proved with the
  bound endpoint HMAC before sending its stored credential. No enrollment.
- Every saved device record is deeply equal, case-sensitive, and the trust-store
  byte hash also remains identical. No credential/configuration values were
  printed. No cross-PC credential transfer.

## Preserved unsuccessful evidence

Earlier native probes used an old executable; the final executable was rebuilt
separately from the test target and re-probed. Earlier Electron runs preserve the
canonical-kind failure and real surface-volume parser error. One later harness
run toggled an already-open Properties drawer closed; its external locator logic
was corrected before the final run. Initial identical retained-side section
images were insufficient cap-draw evidence and were supplemented by the cap-only
proof. One worker negative-offset capture lacked a usable log and was replaced
by a fresh successful capture. All earlier directories remain intact.

## Remaining full goal

This sew/offset increment is delivered through the native/session command path,
with Desktop Properties and rendering. The Desktop renderer has no generic
registered-command form/executor for these surface creation commands; a manual
surface-creation UI remains an explicit full-goal task. Catalog binding and the
hidden session workflow do not establish toolbar creation acceptance.
Phases 12–16 remain active. General surface sweep, trim, extend and thicken;
remaining assembly mates and direct face
editing; live Hermes/voice benchmark and physical Quest acceptance are still
required. Hermes image work was not contacted or disturbed. No SSH, Tailscale,
inference, STT or TTS calls. The local MCP bridge remains stopped after automatic
approval review denials; it was not retried through another mechanism. No
foreground app, headset wake/Guardian override, commit, push, hosted CI or release.
