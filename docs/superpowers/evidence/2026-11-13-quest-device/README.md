# Quest 3 device acceptance — 2026-11-13

First end-to-end Quest acceptance run with the Unity Editor licensed and the headset attached over USB.

## Artifacts

- `evidence.json` — machine-readable summary with hashes, performance and resume facts.
- `quest-home-new-apk.png` — stereo capture (4128×2208) of the freshly built APK on the Kreoda Home
  (`KREODA`, *Progetti recenti*, `MODELLA` / `MOSTRA` / `VISTA`, `APRI DA QUI`).
- `device-logcat-excerpt.txt` — `KREODA_*` lines plus VrApi frame stats (72–73 FPS of 72, no tears,
  `KREODA_RESUME preserved_connected`).
- The 6.7 MB stereo capture showing Meta's *"Individuazione della posizione"* dialog was reviewed but is not
  committed (it shows only the system dialog, which stayed in front because the headset was not worn).

## What was executed

1. **Unity EditMode suite** — `Unity.exe -batchmode -nographics -runTests -testPlatform EditMode`
   with the WinGet Node directory on PATH (the Quest wire fixtures spawn `node`), after staging the
   current managed plugins (the previous plugin folder was from 2026-10-23 and lacked
   `Kreoda.QuestFoundation.IVoiceClient`): **274/274 passed, 0 failed, 0 skipped**.
2. **ARM64 APK build** — `node scripts/build-quest-client.mjs --unity … --sdk … --output …`:
   `BUILD_SUCCEEDED_HARDWARE_UNTESTED`, Unity report `Succeeded`, 0 errors, 26 warnings,
   no source file changed during the build. APK `5420c648…`, 43,915,653 bytes, `arm64-v8a`.
3. **Install** — `adb install -r` on `2G0YC1ZFB8043H`: `Success`, `lastUpdateTime=2026-11-13 00:09:49`,
   `firstInstallTime` retained (2026-10-10), signature accepted (no reinstall of data).
4. **Device run** — launched `com.kreoda.quest`; Unity logs `App: Kreoda Quest #1521753221`,
   XR session `FOCUSED`, `KREODA_DISCOVERY … peers=1`, `KREODA_CONNECTED`.
5. **Desktop → Quest live delta** — a hidden production Desktop instance (normal profile, recovery
   redirected to `.codex/tmp`) created `box-qa-1794525479622` (100×80×5) through the same typed IPC the
   UI uses: revision 1. The Quest received it:
   `KREODA_MESH_APPLIED … revision=1 bodyId=body-…` then `KREODA_MODEL objects=1 triangles=12`;
   TCP `192.168.1.11:44414 → 192.168.1.7:63803 ESTABLISHED`.
6. **On-device performance with heavy meshes** — proximity keep-alive broadcast every 8 s kept the app
   rendering while the Desktop fed it a real OCCT sphere; VrApi samples captured per second:
   - r = 600 mm → Quest LOD mesh **120,582 triangles**: 15 samples, FPS mean **71.73** (min 60, max 73),
     1 sample below 72, tears 0, early 0, stale 12, app CPU mean 2.56 ms (max 2.90), GPU ≤ 0.49 %.
   - r = 1100 mm → Quest LOD mesh **221,602 triangles**: 14 samples, FPS mean **71.21** (min 57, max 73),
     2 samples below 72, tears 0, early 0, stale 21, app CPU mean 2.30 ms (max 2.71), GPU ≤ 0.49 %.
   Raw lines: `perf-heavy-vrapi.txt`, `perf-large-vrapi.txt`. Short windows with the headset off-head, so
   this is a bounded datapoint, not the full roadmap performance acceptance.
7. **Restore** — device back to `Asleep`, `stayon false`, proximity broadcast restored; the Desktop QA
   instance was closed. The user's normal profile was only used as the paired identity; its autosave was
   redirected to a temp recovery directory and no project was opened from it.

## Not covered

Physical hand tracking, panel drag/placement, on-device voice/mic, passthrough alignment and the
"Individuazione della posizione" confirmation require the headset to be worn and clicked by the user.
