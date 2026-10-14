# Exact e121e9e hosted CI failure

Run38626163523 completed failure at immutablee121e9efcdb1ad7955e213208932e94105707b61. This is a verified failed gate, not a current hosted success. Draft PR3 remains open; no merge/release.

## Verified results from actual job log

- Native self-test and CTest233/233 passed.
- Managed SessionClient141, ModelingAgent33, HermesBridge34, ModelingBenchmark33:241 passed, zero failed/notExecuted. Independent runner checks remained active.
- Desktop284/284 across43 files; protocol51; command-schema12 unique source cases.
- Ordinary native Electron E2E67/67 passed. Windows packaging smoke and actual Squirrel install/packaged-core verification passed.
- Crash E2E23 passed,6 failed. Failures cover renderer/main/core recovery of uncommitted solved-sketch drags and solver-barrier interruption. The common strict before/after summary comparison loses cached modelPlane and empty supportRef after canonical rehydration, while the top-level native plane remains present. Initial failure excerpt retained; assertions have not been weakened.
- Crash gate reported production_core_restored=true, and the restored SolverCrashBarrierControl passed. The failure is not permission to ship a barrier-enabled core.

Separate GPT-6-Luna/Max task01a13c17-0c6e-7713-83b5-20678e104ce4 owns the bounded Desktop sync/test correction and an actual supported-datum crash regression. Concurrent Quest task01a13bf0 owns only its Quest paths. Neither packet is accepted from this report. Parent verification, fresh immutable review and corrected-head CI remain required.

## Local schema count correction

The earlier local24/24 command-schema report executed four test files: two source tests and two stale ignored compiled copies under dist. The clean hosted checkout executed the same twelve unique source cases once. Parent independently reproduced the duplicate discovery; JSON filenames/counts retained. This is not missing hosted coverage. The selected CI worker is authorized to constrain the package test script to source discovery, leaving stale files intact and every source assertion active. Historical raw logs stay unchanged;24 executions must not be presented as24 unique cases.

Full logs remain at C:/Users/matte/AppData/Local/Temp/kreoda-ci-e121-full.log and kreoda-ci-e121-failed.log. Downloaded crash diagnostics are under C:/Users/matte/Documents/Codex-tools/CI/e121e9e-crash-diagnostics-20261014. Parent watch session77772 ended with exit1; it must not be polled or restarted as a live run.

Full original Phases12–16 goal remains active. Hermes/server/SSH/AI, device/mic/camera/audio and foreground UI restrictions remain in force; all current diagnostics are local or GitHub-hosted.
