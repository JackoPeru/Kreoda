# Sampled minimum thickness — 19 October 2026

## Delivery and limits

Roadmap 15.6 now has an explicit, non-mutating thickness query and Desktop/Quest
access. It measures exact B-Rep surface-normal chords at sampled trimmed UVs,
stopping at the first material exit of the same solid. Separate solids and air
gaps are not added together. General closed curved/imported/transformed geometry
is supported within the bounded capacity; surfaces, invalid/open geometry and
malformed budgets fail explicitly.

The result is the smallest **observed normal thickness**, not a certified global
minimum. `isGlobalMinimum` is always false. Unknown measurements are null rather
than zero; requested/attempted/valid/missed samples, sampled/total faces and
sampling time-budget exhaustion are reported. Default 512 samples; API 32–4096,
Desktop 512/2048. Capacity is 128 solids/4096 solid boundary faces; the sampling
loop stops after two seconds, excluding OCCT preparation and an individual
kernel call. This is not a hard real-time deadline or a manufacturing pass.

Native code uses exact face derivatives, trimmed-domain classification, line
intersections and inside/outside classification. API references inspected include
the local OCCT 8.0.1 `IntCurvesFace_ShapeIntersector.hxx` and the official
[solid classifier](https://occt3d.com/dev/doc/refman/html/class_b_rep_class3d___solid_classifier.html)
and [face intersector](https://occt3d.com/dev/doc/refman/html/class_int_curves_face___intersector.html)
references. The measurement definition and sampling limits above describe our
implementation, not a guarantee from those APIs.

## Client behavior

- Desktop: explicit selected body/feature calculation, sample resolution,
  measured mm, coverage and world-space witness coordinates A/B. Invalid,
  contradictory or unrelated responses fail; selection/document/revision changes
  discard prior and pending results.
- Quest: one `Spessore minimo` action in the existing PC inspection zone. The
  existing operation-result page displays a readable three-line result and
  coverage. It requires a current visible target; changed document/selection,
  disconnected/replaced client and leaving the result page fence pending output.
  No controller requirement or new screen/panel was introduced. There are now
  **113 action targets / 37 panels**, including the unchanged Home and MR startup.
- The canonical read-only contract and agent permission list expose
  `measureMinimumThickness`; no new geometry command or mesh field is introduced.

## Tests and real application proof

QA: `C:/Users/matte/Documents/Codex-tools/Native/phase15-thickness-20261019`.

- Native RED: 5 failures because the query did not exist. Final full native
  **326/326**, direct exit 0. Covers known box thickness and unchanged shape,
  revision/registry; cylindrical/spherical cavities; transformed world witnesses;
  disconnected solids; invalid/open geometry and invalid budgets. An additional
  generic rational ellipsoid case verifies both witness points against its
  analytic quadric and the exact normal-chord length.
- Protocol generation/check/build pass; protocol **65/65**.
- Desktop client/panel RED then **13/13**; session routing subset **89/89**.
  Complete Desktop **377/377 across 68 files**. Initial parallel suite had one
  App readiness timeout while its DOM still said `Loading workspace…`; isolated
  App **9/9** confirmed the lazy import wait. The first section-lifecycle test
  now allows five seconds for actual workspace readiness; final suite ran with
  four workers. No product behavior was changed for this harness correction.
- Managed SDK **171/171**. Final affected suites after the runtime catalog fix:
  ModelingAgent **83/83**, HermesBridge **66/66**, benchmark tests **33/33**.
  Separate TRX files in QA confirm zero failures/skips. Benchmark tests are
  local tests, not the full live seven-prompt benchmark acceptance.
- Quest formatter RED **7/7**, then formatter/controls/mass subset **57/57**.
  First controls run caught an authored top-row boundary violation; corrected
  the actual rectangles, retaining two columns and comfortable gaps. Full Editor
  **197/197**, direct exit 0, zero failures/skips. Restored only changed known
  scene/material files from pre-test backups; the other backed-up files matched.
- Source-only layout: 113 actions, 105 source call sites, 37 semantic rectangles,
  zero out-of-bounds rectangles or nonmodal intersections. This supplements the
  executed Unity authored-layout/input tests, not physical hand acceptance.
- Hidden real Electron/OCCT E2E **1/1**: remote session query and actual Desktop
  panel measure 10 mm for a 20×30×10 box. Query does not change revision/bodies.
  Editing produces 4 mm; Undo returns 10 mm; redo/save/open returns 4 mm. Actual
  Desktop bitmap inspected, with witness coordinates and sampled-result label.
- **13 actual Unity GPU UI renders**, all manifest hashes match, no shader/C#,
  null-reference or assertion error. A native result from that E2E is passed
  through the actual Quest formatter for the result-page render. These are
  offline Editor views over a neutral background, not headset photographs or
  a live Quest connection. Capture framing was corrected to include visible
  shared navigation/frame siblings, preventing cropped review evidence.

## Runtime catalog defect found and fixed

The initial installed MCP test failed at `kreoda_begin_request` before opening
a transaction: `Invalid PC command definition`. Actual catalog inspection found
34 definitions; `DefineAssemblyConstraint` legitimately has a root object
`anyOf`, whereas the agent reader required literal root `type: object`.

Two positive object-union tests reproduced the failure. The reader now accepts
bounded object-only `anyOf`/`oneOf`, preserves the raw schema, and leaves complete
parameter validation on the PC. Empty/scalar/array/malformed unions remain
rejected. Seven new regression cases pass; all 32 modeling commands in the real
catalog are now accepted. Undo/Redo remain intentionally excluded.

Published the corrected bridge separately, then repeated the installed proof:
**`measured-and-rolled-back`**, thickness **10 mm**, actual volume **6000 mm³**,
128 valid samples, six faces, no commit and zero remaining features/bodies.
An independent official MCP-client query then read actual native volume **0**,
so restoration is established beyond a cached model description.

## Build and installation

Desktop/ARM64 builds succeeded. Shared package source guard **1694 files,
changes []**; APK guard **changes []**, **0 errors / 2 warnings**, only ARM64.
The later catalog correction changes only two ModelingAgent source/test files,
which are not Desktop or Quest inputs. Final 923-product-file comparison records
those two changes explicitly and confirms **zero Desktop/Quest input changes**.
The corrected bridge was independently rebuilt, tested, published and exercised.

Desktop, same firewall-authorized installation path and original UX profile:

- `C:/Users/matte/Documents/Codex-tools/kreoda-phase12-pc-20261010/kreoda-win32-x64`
- Program and profile backed up; all **119 installed files** match the package.
- Hidden main PID **29692**, window **0**, native ready, LAN `192.168.1.7:59426`.
- asar `cc2fba404ee9e6de98e9b8a4d3f0a8502ec9b697cef2e123a30cf61be04f4792`
- core `a0a605f1a0b3550c1ab324aacd372c51ca84eea32b543f7b72349df449dbfdc3`

Quest 3 `2G0YC1ZFB8043H`, `com.kreoda.quest`:

- Previous installed APK pulled/backed up. `adb install -r` **Success**, normal
  activity launch **ok/COLD**. Pulled installed base APK matches guarded artifact.
- APK `8ef4682a69954e35088b92002298945a8688be4d86215145657532955956dcdd`,
  **43,706,121 bytes**, only `arm64-v8a`.
- Current PID **14075** bounded log contains no fresh connected marker and no
  exception/fatal marker. No wake override/Guardian changes. Earlier off-face
  room localization gate remains; no new physical passthrough, comfort, live hand
  tracking, performance or LAN acceptance is claimed.

Local bridge:

- PID **35604**, loopback `http://127.0.0.1:9843/mcp`.
- `C:/Users/matte/Documents/Codex-tools/kreoda-hermes-integration-20261019/bridge-thickness-final`
- Existing per-PC agent configuration reused. Its device, secret, installation
  and logical identity are preserved; the endpoint automatically moved from
  the previous Desktop port to 59426 after proof/authentication/snapshot.
- PC remains `34669a1f-68fa-4153-b0c1-916a24a15a2f`, two devices. Store JSON is
  not byte-identical after runtime startup, but comparing all root/device fields
  confirms both complete records and every value are semantically unchanged.
- Before restarting owned local processes, actual MCP inspection confirmed an
  idle empty document and no active bridge caller. No unsaved user model was lost.
- Voice configuration is loaded; **no Hermes/SSH/Tailscale/inference/STT/TTS
  request or remote restart** occurred. No reboot/login persistence claim.

## Remaining scope

Full Phases 12–16 remains active: general surface operations, broader assembly
mates and imported-face editing, live Hermes/voice/benchmark acceptance and
physical Quest acceptance remain open. Older operational UI metadata/readout
duplication also needs a further minimal-UI pass; this packet does not claim a
complete UI audit. No new independent review (quota fallback), commit, push,
release or hosted-CI result. Concurrent dirty work is preserved.
