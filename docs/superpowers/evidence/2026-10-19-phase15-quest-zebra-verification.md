# Quest zebra, presentation and connection regression — 2026-10-19

## Scope

Worktree `Kreoda-phase10-ci`, base `7b196638a84e4caaeea05a707d94038011e4ba33`.
The parent continued under the user's explicit fallback after previously verified
Luna/reviewer quota exhaustion. No new independent review verdict. Concurrent edits,
the human checkout, existing UX profile and remote Hermes/image services were preserved.

Added local reflection-band inspection to the existing Quest Section page. Three real
actions control zebra, density and orientation through the same QuestButton/ray/pinch
path as the existing controls. All 108 previous action IDs remain, plus three new IDs:
**111 measured targets**, **37 existing panels**. Inline labels expose actual band count
and angle without adding tiny secondary text or a permanent window.

`SectionSurface.shader` uses interpolated native world normals and eye direction,
reflection, derivative antialiasing and renderer-local property blocks. Zebra is independent
of section enablement. Mesh uploads, clipping, selection and preview tint retain their
own behavior. Document/session replacement clears local presentation. No CAD mutation,
protocol-layout change or new package dependency was introduced.

## Defects found and corrected

- Actual UI capture showed large workstation headings painting over live facts.
  A new geometric test failed before the correction. The heading's registered width
  is now 44% of the panel, preserving a measured gap before the existing fact column.
  Fresh final captures were inspected after the correction.
- `CHOOSE_PC` invalidated an authentication attempt before its queued discovery result
  could be consumed. The picker stayed empty. Publish the offered candidates inside
  the matching failure-generation callback; retain the stale-attempt fences and identity
  proof requirements. The original per-PC credential switching tests now pass.
- EditMode fixtures manually started connections without the corresponding lifecycle
  cleanup. Destroyed test components could retain managed reconnect workers and enroll
  against the next fixture's listener. The legacy migration case passed isolated but
  failed in the class sequence with two installation identities. Explicit fixture shutdown
  fixes the interference; credential/installation uniqueness assertions were retained.
  A new shutdown test reproduced `ObjectDisposedException` on repeated teardown. Runtime
  teardown is now idempotent and uses immediate mesh-object destruction in Editor only.
- Updated stale UI fixtures to construct the actual voice page, pass peer arrays as one
  reflection argument, inspect the correct renderer type, activate pages before testing
  data widgets and preserve intentionally single-line compact controls. Existing disabled
  decoration colliders remain non-interactive. Full actual action bounds, callback and
  pairwise-overlap assertions remain.
- Home fixtures now use direct-child lookup for names containing `/`, actual current
  section labels and Home-relative panoramic bounds. They retain honest empty-state,
  no-video, no-demo-project and original action-hitbox checks.

## Evidence and artifacts

Private QA: `C:/Users/matte/Documents/Codex-tools/Native/phase15-quest-zebra-20261019`.

- Final full Unity Editor suite: **188/188**, zero failed or skipped (`editor-final.xml`).
  Whole connection class: **25/25** after cleanup correction. Earlier failed runs and
  focused RED/GREEN evidence are retained separately; they were not overwritten.
- Original scene and material files were backed up before tests. `QuestBuild.Prepare`
  changed the saved scene and SectionCap material; those exact pre-test versions were
  restored. Saved-scene test without Prepare then passed **1/1**.
- Native sphere fixture was produced by the actual OCCT 8.0.1-native executable:
  radius 60 mm, volume **904778.6842338605 mm³**, **11,936 triangles** with corrected
  surface normals. Fixture SHA-256:
  `2c7bee15f68014ab5734ed3717c51c0107ae8682eb3aba5003665a2be7c785be`.
- Actual offscreen Unity **Direct3D12** GPU proof: 313,455 changed pixels for enabling
  zebra, 247,976 for density/orientation adjustment, 98,399 for sectioning. Disabling
  analysis and section restored the original bitmap exactly. Native Unity mesh identity
  and upload version were unchanged; **zero shader errors**. Final captures are in
  `gpu-final`; these are Editor renders, not headset or passthrough screenshots.
- **13 final UI captures**, all manifest SHA-256 checks passed, in `ui-final`.
  Inspected the final Section capture, including readable parameter labels and separated
  headings/facts. Initial captures containing the detected overlap remain in `ui`.
- Source-only UI verifier passed with 111 actions and 103 source call sites. Scoped
  `git diff --check` passed. This is supplementary to the actual executed Unity tests.
- Canonical normal Android build exited **0**, report `Succeeded`, **0 errors / 2 warnings**.
  Build elapsed 229.819 seconds; the **1,669-file** source guard reported **zero changes**.
  The next morning all 1,669 current source hashes still matched that build before the
  evidence/plan documentation update. APK inspection found only **arm64-v8a**, including
  `libil2cpp.so`, with 13 native libraries.

APK: `arm64/KreodaQuest.apk`, SHA-256
`1b82e30c0c38fa04b267e47c55806bfbafb0a76bedbcc7bf723c61ac9537e19c`.

## Physical deployment and acceptance boundary

Quest 3 serial `2G0YC1ZFB8043H` became available over authorized ADB. Backed up the installed
APK (SHA-256 `1b4937d04b4d545648b3d5acb18f9fa80c104ca02c42f96670c092db691aab52`),
then `adb install -r` returned **Success**, retaining app data. Started the standard
`com.kreoda.quest/com.unity3d.player.UnityPlayerGameActivity` entry point.

The previous owned Desktop process was no longer running. Verified the installed asar
and native hashes against the already-tested Desktop package, then started it hidden
with the original UX profile. New main PID **13380**, window handle **0**, native sidecar
ready, actual LAN listeners **192.168.1.7:52211/52212**.

Fresh Quest connection acceptance remains **unverified**. Live system logs show the OS
Guardian dialog taking focus and pausing the app. An actual headset screen capture
confirmed the system's room-localization/tracking warning while the headset was off-face.
No `KREODA_CONNECTED` was observed in these attempts. This is not recorded as a successful
application-level LAN or optical-hand-tracking test. The system tracking choice was not
changed, no boundary configuration was disabled, and no claim of new physical UI comfort
or hand acceptance is made.

Temporary off-face wake/proximity automation was restored after every attempt with
`com.oculus.vrpowermanager.automation_disable`, result 0. The commands follow
[Meta's off-face testing documentation](https://developers.meta.com/vr/documentation/unity/meta-xr-operator/quest/).
The capture containing the private room is retained only in the private QA folder.

No foreground PC window, remote Hermes, SSH, Tailscale, STT, TTS or image-generation request
was used. No new hosted-CI, publication or release result is claimed. The original full
Phases 12–16 goal remains active, including outstanding physical Quest and broader
analysis/surface/direct-edit/assembly/real-agent acceptance work.
