# Phase 15 zebra analysis and native normals — verification

## Scope and execution

Current dirty worktree `Kreoda-phase10-ci`, base `7b196638a84e4caaeea05a707d94038011e4ba33`.
The parent implemented this packet under the user's explicit fallback after verified
Luna/reviewer quota exhaustion. No new independent review verdict. Concurrent changes
were preserved; no broad commit, push, hosted-CI or release claim.

Desktop Properties now offers reversible zebra inspection, density 4–48 and orientation
0–180 degrees. The fragment shader reflects a fixed striped environment using native
interpolated normals and view direction, with derivative antialiasing and a small material
tint to retain hover/selection/shared-target feedback. It reuses the existing body materials,
clipping, topology, geometry and picking. Uniforms reach newly hydrated meshes. Document
replacement resets presentation. These display controls do not send CAD mutation commands.

## Root cause found by visual inspection

The initial actual GPU capture showed jagged bands. Native `appendFaceTriangles` assigned
the last incident triangle's normal to every shared vertex, with zero normals at some sphere
poles. Two analytic-normal tests failed against that implementation. Replaced that loop
with OCCT `BRepLib_ToolTriangulatedShape::ComputeNormals`, which uses surface UV data and
its singular-node fallback. Transform normals by face placement and respect reversed
orientation. Sharp edges remain separate because each native face retains its own nodes.
Positions, indices, persistent IDs and the wire buffer layout are unchanged. This shared
core correction also applies to meshes sent to Quest; it does not add Quest zebra controls.

## Observed evidence

Private QA: `C:/Users/matte/Documents/Codex-tools/Native/phase15-zebra-20261019`.

- Initial viewport test RED: `setZebra` missing. Final focused viewport/state/panel/section
  subset **17/17**; covers current/future meshes, geometry identity, unchanged normals,
  face selection, section clipping, settings bounds and document reset.
- Native analytic normals RED **0/2**; corrected normals plus mesh cache **4/4**. Placed
  and reversed sphere normals, including poles/seams, agree with the analytic radial
  direction to dot product > 0.999999; cylinder caps retain sharp planar normals.
- Full native **316/316**, **52 suites**, **98.457 s**. XML: zero failures, errors or disabled.
  Includes geometry, persistence, import/export, resource cycles and many-body baselines.
- Full Desktop **361/361**, **65 files**. The first full run exposed a stale test viewport
  mock without `setZebra`; the mock was extended to the real interface. Production code
  was not weakened with an optional-method guard. Final run has no unhandled errors.
- Hidden real Electron/native GPU E2E **4/4**, **34.9 s**: three section/picking regressions
  plus zebra on a native radius-60 sphere. Exact native volume 904778.6842338605 mm³.
  The zebra test changes density/orientation, orbits with the actual mouse, retains native
  mesh identity and revision, and restores the original cropped viewport bitmap exactly
  when disabled. Zero captured shader errors. Zebra case **14.4 s** in that final run.
- Inspected the corrected actual `zebra-sphere.png` and `zebra-controls.png` captures.
  The initial jagged capture was used to diagnose the native defect; corrected capture
  shows continuous smooth bands. Final crop has 22,495 bright and 19,925 dark pixels.
- TypeScript/Vite production build and Desktop package exited 0. Source guard hashed
  **1,665 files**, **zero changes** during build/package; native binary hash unchanged
  across packaging. Scoped `git diff --check` passed.
- Backed up the owned hidden installed program and original UX profile. Stopped only
  verified owned PID 40216 after confirming it stayed hidden and its native log had no
  activity since 00:55:01. Copied the package to the existing firewall-authorized location,
  **119 files SHA-256 verified**, restarted with the same UX profile and `--start-hidden`.
  New PID **30064**: window handle 0, actual native sidecar ready, normal LAN listeners.

Installed Desktop location:
`C:/Users/matte/Documents/Codex-tools/kreoda-phase12-pc-20261010/kreoda-win32-x64`.

Artifact SHA-256:

- `resources/app.asar`: `cac897edbad77dddf9b17fee2d083429074ac734ee98fbc1e98c40e789c0f74a`
- `resources/kreoda-core.exe`: `afdd97aaf0953dc8e56803eedf44f669127b805112c43096fd37b21efd2672f0`

## Boundaries and remaining work

No remote Hermes, SSH, Tailscale, image-generation, STT or TTS request was made. No foreground
window opened. Before the latest install, the previous Desktop restart had a live LAN TCP
connection to Quest at 192.168.1.11 while ADB reported USB absent. This is transport evidence,
not an in-headset visual or comfort acceptance. After the latest restart only the PC listeners
were observed; a fresh Quest reconnect was not claimed. No new Quest APK was installed here.

Zebra is visual tessellation-based inspection, not a numerical continuity/curvature certificate.
Quest zebra controls/presentation, curvature visualization, minimum thickness and the broader
surface/direct-edit/assembly and real-agent gates remain open. The original full Phases 12–16
goal remains active; this report does not mark Phase 15 or the full goal complete.
