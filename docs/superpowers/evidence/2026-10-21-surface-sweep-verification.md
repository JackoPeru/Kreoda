# Surface sweep — verified and installed

21 October 2026; worktree `Kreoda-phase10-ci`, branch
`codex/phase12-quest-foundation`. External evidence:
`C:/Users/matte/Documents/Codex-tools/Native/phase15-surface-sweep-20261020`.

## Delivered increment and routing

Command 53 `CreateSurfaceSweep` creates one independent associative surface body
from ordered profile/path sketch dependencies. Open and closed profiles and paths
use copied exact OCCT pipe-shell geometry, corrected Frenet framing and right
corner transitions. No implicit caps, solidification or approximate fallback.
`SurfaceSweep` remains a surface even for a geometrically closed torus.

Tolerance is editable; both source sketches drive rebuild. Invalid inputs and
failed geometry leave document/history unchanged. Source geometry is preserved.
Native/shared TypeScript/Quest classifiers, localized Desktop types/properties
and fenced ordered two-sketch session bindings are integrated.

Product code was implemented only by separate GPT-6-Luna/Max task
`01a15a83-dbff-7a50-85da-f9a85244b484`. Runtime metadata for its turns confirms that
exact model/effort. Its first turn stopped on quota; a later actual usage check
allowed resuming the same task. No root product-code fallback. Parent owned design,
review, independent QA, build and installation. No additional reviewer lane.

`scope-proof.json` verifies the original worker preimages and shows 27 product files changed
within explicit ownership, plus two parent documentation changes. Original dirty
work and the human checkout were preserved. C++/schema verification guarded 169
inputs; Desktop packaging guarded 665 inputs. The final Android build guarded all
1719 enumerated source files with no changes during build.

This increment exposes creation through the authenticated native/session command
path, with normal Desktop Properties and rendering. A manual surface-creation UI
remains required in the full goal; no generic renderer creation form/executor was
invented or falsely claimed. The current Home MR, hands controls and automatic
pairing implementation are carried forward from their separate verified packet.

## Independent parent checks

| Gate | Actual result | Evidence |
|---|---|---|
| Core executable and test target build | Exit 0 | `parent-native-build.log` |
| Full native suite | 359/359, 56 suites, zero failures/errors/skips | `parent-native-full.xml`, `native-test-proof.json` |
| Command schemas | 21/21, two files | `parent-command-schema-full.log` |
| Protocol | 65/65, five files | `parent-protocol-full.log` |
| Full Desktop suite | 400/400, 72 files | `parent-desktop-full.log` |
| Desktop TypeScript/Vite build | Exit 0 | `parent-desktop-build.log` |
| Actual OCCT stdio workflow | PASS, four analytic fixtures | `native-proof-final/proof.json` |
| Actual hidden Electron/native/session/Properties | PASS | `electron-properties-final/proof.json` |
| Quest Connection/Section/MeshView EditMode tests | 43/43, zero skips/failures, direct exit 0 | `parent-quest-focused/tests.xml`, `exit.json` |
| Desktop package | Exit 0; 665 inputs unchanged | `parent-desktop-package.log`, `desktop-input-proof.json` |
| Canonical ARM64 build | Succeeded, zero errors, five warnings, direct exit 0 | `arm64/result.json`, `build-report.json` |
| Installed artifact/identity/data checks | PASS | `final-delivery-proof.json` |

The actual native probe checks a rectangle of area 200 mm², an uncapped radius-2,
length-20 cylinder of area 80π mm², a radius-20/radius-2 quarter torus of area
40π² mm² and a closed torus surface of area 160π² mm². Bounds, zero solids, omitted
summary volume, zero mesh compatibility volume, rejected physical solid queries,
source sketch fingerprints and one new native body per operation are asserted.
Tolerance edits, updates to both sketches, undo/redo, atomic invalid requests,
save/open, document validation and global volume excluding surfaces are exercised.

Native tests additionally cover multiple profiles, a valid right-angle miter,
reordered/construction entities, non-axis-aligned frames, edge/product/profile
budgets, stale sources, self-intersection/collapse and direct surface instances.

The hidden Electron test uses actual session creation and reads the real
Properties DOM. It verifies ordered/reversed bindings, stale-revision refusal,
one feature per creation, tolerance input/edit/undo/redo and persistence. After
reopen, Properties explicitly reads `PROPERTIES · SURFACE SWEEP` and `Tolerance
(mm)`, retains the edited value and has no fake volume or parser error. The hidden
workspace PNG is supplementary; it is not manual toolbar-creation acceptance.

## Quest GPU checks

All fixtures use actual current OCCT mesh payloads and matching SHA256 provenance.
Worker ran all four final captures. Parent independently captured rectangle and
cylinder, then repeated the two curved cases after the Editor-only picker fix.
All direct exits are 0 on Direct3D12, with valid front/back semantic selection,
image changes after selection, two-sided surface materials, no section cap,
preserved native mesh/collider/upload identity, restored material state and zero
shader errors.

| Parent capture | Triangles | Front/back pixels | Section pixels |
|---|---:|---:|---:|
| `parent-gpu-rectangle` | 2 | 115200 / 115200 | 57600 |
| `parent-gpu-cylinder` | 126 | 46080 / 46080 | 23040 |
| `parent-gpu-quarter-final` | 2016 | 59974 / 59974 | 22302 |
| `parent-gpu-torus-final` | 7938 | 60573 / 60573 | 30283 |

The final torus section PNG was visually inspected. A surface ring remains open
at the displayed cut. These are offline Unity Editor GPU proofs, not new physical
headset, hand tracking, comfort or live LAN acceptance.

Final Editor proof utility SHA256:
`ffb3918f78d2e0dd09831d52061eab87a70457f611f8784bf60bfe03ee815eac`.
After client verification, this was the only source file changed before the final
frozen build; it contains only the new sweep camera-ray fallback. Runtime C#,
native and Desktop sources remained unchanged.

## Installed PC and Quest

Desktop target remains
`C:/Users/matte/Documents/Codex-tools/kreoda-phase12-pc-20261010/kreoda-win32-x64`.
The old installed app was authoritatively absent after the overnight interruption;
no in-memory user document was stopped. Program changes and the complete original
UX profile were backed up. All 119 installed files match the package manifest;
only `Kreoda.exe`, `resources/app.asar` and `resources/kreoda-core.exe` changed.

Desktop PID 8908 started with `--start-hidden`, original profile and window handle
0. Authenticated read-only discovery proved the same PC identity before sending
its saved credential. The installed catalog includes Sew, Offset and Sweep; the
document is empty and no transaction is active. Every saved device record remains
deeply equal, case-sensitive, and the trust-store byte hash also matches. No new
enrollment, credential/config write or cross-PC secret transfer. Existing firewall
rules were inspected without modification; no UAC prompt.

- Native executable SHA256:
  `642489abd0354158c7943fe5cda52aec1145bd76471a7f608bed730c4def9d13`.
- Desktop ASAR SHA256:
  `46dd3648773cb05055ac4dfe15d84503ca041d9237eaf6a7eb9b23fb85a40511`.

The canonical Quest build used the pinned Editor
`6000.3.25f1_e1dba0a9aba4`, succeeded in 133.648 wrapper seconds, and retained
passthrough and hand-tracking manifest features/permission. The APK contains only
`arm64-v8a`, is 43,691,353 bytes, and has SHA256
`fef463ff444249d694ffe22eab1a28dc9d141853e0ad2a09703596009ec5b5b5`.
Five build warnings were inspected: legacy unused compatibility fields and
existing Meta/Editor build warnings; no compilation errors.

Quest `2G0YC1ZFB8043H`, package `com.kreoda.quest`, was updated with `adb install -r`
and started normally in `UnityPlayerGameActivity`. The actual prior APK was backed
up and rechecked immediately before install; it matches the previous `469a1613…`
artifact. The new installed base APK was pulled back and exactly matches the
build hash. No app-data clear, uninstall, private Quest credential read, forced
wake, proximity/Guardian override or visor action. PID 6390 remained alive in the
bounded startup check, with no fatal marker. No live Quest client appeared in the
PC session at verification time; live headset connectivity/display remains
unproven here and is not inferred from APK hashes or Editor tests.

## Unsuccessful evidence and resolved gaps

- The first worker turn stopped on quota before implementation; baseline copies
  were retained and work resumed only after the actual limit reset.
- Initial test/header declaration problems and the incorrect OCCT include were
  corrected by Luna. Kernel exceptions from wire/tangent work now become atomic
  errors, not uncaught native exceptions.
- The first right-corner fixture used inside-profile width equal to leg length,
  producing a collapsed/disconnected shell, and its area expectation ignored
  miter trimming. Geometry diagnostics justified using 20 mm legs with expected
  area 475 mm²; validation was preserved and collapse remains a negative case.
- Early workspace tests used stale package `dist` output. Rebuilding the two
  affected packages resolved it; final parent full suites use current output.
- Worker initially reported the pinned Unity Editor missing after checking the
  wrong installation inventory. Parent verified the exact supplied path/version
  and ran the actual Editor tests, captures and build. No software install needed.
- The first curved GPU proof shot a center ray through empty space. Luna changed
  only the sweep Editor proof: center first, then projected real triangle
  centroids, bounded to 4096 centroid samples and 64 semantic rays. Old feature
  selection assertions and actual selection-image-change requirements remain.
- An early parent native harness assumed a native top-level bodies array; it was
  corrected to assert actual feature `bodyId`/`bodyTip` metadata. The first Electron
  launch used the outer non-repository working directory and could not find the
  sidecar; using the actual worktree resolved it. Both failed evidence directories
  remain intact. Stronger positive Properties assertions supplement the earlier
  negative-only absence checks after reopen.

## Remaining full goal

This surface-sweep increment is delivered. The complete Phases 12–16 goal remains
active: manual surface-creation UI, general trim/extend/thicken, remaining assembly
mates and direct face editing, live Hermes/MCP/voice benchmark and physical Quest
acceptance are still required. Hermes image work was not contacted or disturbed;
no SSH, Tailscale, inference, STT or TTS calls. The local MCP bridge remains stopped
after automatic approval review denials; it was not retried through another
mechanism. No commit, push, hosted CI or release claim.
