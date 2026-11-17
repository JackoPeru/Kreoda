# Quest Editor baseline against current managed contracts

Status: baseline compatibility verified, not datum/Quest feature acceptance.

Parent staged the actual current Release netstandard2.1 Kreoda.Protocol, SessionClient and QuestFoundation assemblies with scripts/build-quest-managed.mjs. Eight runtime DLLs and SHA256 manifest were produced; all three builds had zero warnings/errors. This includes the newer typed datum/full-frame session contracts rather than relying on the earlier cached Unity plugin binaries.

Unity6000.3.25f1 ran EditMode tests with batchmode/nographics and a hidden process. Actual XML confirms55/55 passed, zero failed/skipped/inconclusive, exit0. Existing controller-free/panel/section/sketch/voice cancellation tests remain green. No device, microphone/camera capture or audio playback was exercised; voice tests check quiet startup and cancellation with owned synthetic data.

Before execution, all154 tracked Quest project files were copied with hashes. Tests regenerated the authored scene and two section materials; the exact original bytes were restored in finally, all154 hashes rechecked, and git status for clients/quest-unity was clean. No concurrent worker owned Quest files.

Retained XML, source hashes, restore summary and managed manifest are evidence here. Full local launcher/editor logs and backup remain at C:/Users/matte/Documents/Codex-tools/Unity/QA/phase15-datum-contract-baseline-editor-20261014-a1. No claim that this baseline implements Quest datum views, semantic targets, pinch construction/editing or a new ARM64 build. Those remain under the original Phase15.1 plan; physical/live/full-goal gates remain open.
