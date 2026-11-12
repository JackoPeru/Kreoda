# Manual surface creation UI — verified delivery

## Implementation and scope

Separate task `01a15df8-531d-71e3-b5f8-01cc2bb365c8`, **Superfici — creazione dalla UI Desktop**.
All observed worker turn contexts were `gpt-6-luna` / `max`. Product implementation
was exclusively Luna's. Parent specified, reviewed, wrote external QA, verified,
packaged and installed. Worker idle after freeze V2; no fresh reviewer or root
implementation fallback. Worktree `Kreoda-phase10-ci`, branch
`codex/phase12-quest-foundation`; human checkout untouched, no commit/push.

Fourteen owned product/test files: six new files and eight narrow modifications.
Original preimages verified against the parent baseline; no change outside the
ownership list and parent design/plan. The explicit extension to `model/sync.ts`
adds an optional guard for the surface path; legacy callers retain their defaults.
Final presentation revision changes only the panel and EN/IT strings.

More → Surface tools opens a compact nonmodal panel for Extrude, Revolve, Loft,
Sew, Offset and Sweep. Pickers show readable labels and duplicate ordinals; ordered
lists have reorder/remove controls. Units, custom axis/origin, source health,
visibility preservation and lifecycle guards use existing native/renderer APIs.
Native acknowledgment plus refresh failure disables further creation until a
read-only retry. Hidden requests retain their lock and release it on settlement;
late responses cannot overwrite a replaced/disconnected view.

## Independent parent evidence

QA directory:
`C:/Users/matte/Documents/Codex-tools/Native/phase15-surface-ui-20261021`.

- Final full Desktop suite: **442/442**, 76 files, exit 0, 15.23 s.
  `parent-desktop-full-v2.log`.
- Worker final focused suite: **52/52**; typecheck exit 0. Parent final
  `pnpm --filter @kreoda/desktop build` exit 0.
- `scope-proof.json`: 1,728 source files, all original preimages intact, no
  out-of-scope changes. `final-freeze-proof.json`: parent and worker V2 hashes
  identical; exactly the three approved presentation changes from first freeze.
- Real hidden Electron GUI/native proof: `electron-v2-final/proof.json`, exit 0.
  Setup created only nine sketches and one datum. All ten surface/solid creations
  used the normal form controls and central executor; no surface creation hook,
  session command or CoreClient injection substituted for the UI.

| GUI operation / fixture | Verified native result |
|---|---|
| Extrude a 10 mm line by `0.5 cm` | SurfaceExtrude, area 50 mm² |
| Revolve rail at radius 5, length 20, world X | SurfaceRevolve, area 200π mm² |
| Revolve radial line, origin X=`0.1 cm`, direction `[0,0,0.5]`, π/2 rad | Normalized world Z, angle 90°, area 70π mm² |
| Reordered square sections at Z=0 and Z=20 | SurfaceLoft, area 800 mm², explicit dependency order |
| Two cap surfaces authored by Extrude | Each area 100 mm² |
| Sew the walls/caps, makeSolid=true | SurfaceSewnSolid, volume 2,000 mm³, area 1,000 mm² |
| Offset a hidden cylinder by +2 / −2 mm | Radii 7 / 3 mm, exact areas 280π / 120π mm² |
| Sweep circle R=2 along 20 mm path | SurfaceSweep, area 80π mm² |

Each success allocated one feature; native types, parameters, dependencies, B-Rep
area/volume and real rendered meshes were inspected. Surface volume remains absent.
An open-shell solid request failed without mutation and preserved the form. Sketch
sources and hidden cylinder visibility were preserved. Undo/redo, validation and
save/open passed, including remeasurement after reopening. Viewport orbit worked
outside the panel. JavaScript/shader error list was empty.

Parent inspected both final PNGs. At 1600×1000 outer window, content was 1584×935:
panel 320×474, fully visible labels/hint/footer. At 800×600 outer window, content
was 784×535: panel 320×359, scrollable body and visible Create/Close footer. No
horizontal document overflow. These are actual hidden Electron captures, not a
mockup. First QA attempt used the wrong body-vs-feature visibility selector; the
external harness alone was corrected and both subsequent full GUI runs passed.

## Installed Desktop

Canonical package exit 0; all **671** source/build/native package inputs unchanged
during packaging. Same target and original UX profile/shortcut retained:
`C:/Users/matte/Documents/Codex-tools/kreoda-phase12-pc-20261010/kreoda-win32-x64`.

Fresh authenticated read-only idle gate verified empty document, no transaction
and no live Quest client before stopping the exact owned hidden process 8908.
Profile and changed program files were backed up under the QA directory.
Only `Kreoda.exe` and `resources/app.asar` changed; **119/119** installed files
match the package. New process **27256**, `--start-hidden`, window handle 0;
native sidecar ready and read-only authenticated discovery/session succeeded.

- Native executable SHA256 unchanged:
  `642489abd0354158c7943fe5cda52aec1145bd76471a7f608bed730c4def9d13`.
- Installed ASAR SHA256:
  `86fd31b3f1c6e9f62cb951051add6ef57c58838b433468a72c4b534c1f4eadf7`.
- PC identity `34669a1f-68fa-4153-b0c1-916a24a15a2f` preserved; all saved device
  records deep-equal and byte-identical. No enrollment or credential/config write.
- `final-delivery-proof.json` PASS: source/input/package hashes, identity/trust,
  GUI/native proof and final full test evidence.

## Verification boundary and remaining goal

Desktop-only increment. Native/Quest sources, shared registry and trust/voice/
discovery code unchanged. No native or Quest rebuild, fresh physical acceptance,
live Quest connection, hosted CI or release claim. Previous Quest APK remains
unchanged; passthrough/hands are not reaccepted by this Desktop test.

All parent build/test/GUI handles terminated; installed hidden Desktop and its
sidecar intentionally remain running. No foreground app/browser or headset action.
No Hermes/SSH/Tailscale/AI/STT/TTS calls: image work protected. MCP TCP9843 stays
stopped after the earlier approval-review denials; no retry/bypass. UDP discovery
is a separate existing service.

Full goal remains **active**: general surface trim/extend/thicken, remaining
assembly mates/direct face editing, permitted live Hermes/MCP/voice checks and
physical Quest acceptance. This report completes only the manual surface UI tranche.
