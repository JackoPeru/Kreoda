# Phase 13 Task 6: contextual commands and sketch dimensions

The canonical registry now binds validated selected edges, faces and sketches to available commands. The relay checks session, document and revision before and after reference resolution. Unity consumes the returned command schemas and reasons; it does not keep a second command registry. Creation is confirmed explicitly and uses the existing command and shared Undo paths.

SketchDimensionIntent captures the actual sketch, constraint identity, plane and base revision. A draft changes only its selected dimensional constraint. A dedicated read-only preview query solves the sketch without committing it; native previews now apply solved circle/arc radii as well as points. The confirmed UpdateSketch preserves entity and constraint identities. Unity renders the solved sketch on its actual plane and rejects stale previews and numeric callbacks.

## Evidence

- Meaningful RED/GREEN checks cover unavailable/ambiguous context, native owner metadata, shared registry availability mutation, missing typed APIs, missing scene wiring, disposed cancellation state and circle radius preview returning the old radius.
- Native OCCT: 176/176, direct exit 0, 87.965 s.
- Managed: 119/119 with actual net8 libraries and 119/119 with actual netstandard2.1 libraries, both direct exit 0.
- JavaScript: 272 passed across the workspace, including final Desktop 207/207. The first combined run failed only the obsolete literal capability expectation; it was updated for the two new negotiated server capabilities and Desktop rerun successfully.
- Unity Editor: 40/40, direct exit 0. Lint and generated contract drift checks exit 0.
- Real OCCT 8.0.1 / hidden Electron / compiled C# integration: 1 passed. Validated native selected-edge fillet and shared Undo, pure solved circle preview, exact radius commit and shared Undo preserving plane/entity/constraint identities. Desktop observed revision 6. This is not a headset usability test.
- Normal ARM64 IL2CPP APK: 36,299,166 bytes, SHA256 `4a85ea0077b74800d5c9423e3567d47e59853cca5c26243b15c064e87e69945c`; direct exit 0, 218.193 s, 0 errors and 6 warnings. Build source-before equals source-after and current final 808 input hashes match both.
- Fresh reviewer `01a12a7e-f1b4-7590-a2c0-288dd20feef6`: actual gpt-6-sol/high, SHIP. Host permissions remain danger-full-access/disabled; read-only behavior is not enforced isolation.

The initial review freeze was captured during the Unity build: it contains two temporary RuntimeActionBindings files and temporary values for ProjectSettings/DevAgentSettings. After build, those files are removed and the two settings match committed HEAD. No runtime source differs; final manifest SHA256 is `6e17ea64e08298a7309d582119a1e59af0eaf1f3622282b415e266bbb7fb408a`. The same reviewer independently reconciled all 808 current hashes and retained SHIP; no runtime source drifted.

External evidence is under `C:/Users/matte/Documents/Codex-tools/Unity/QA/phase13-context-actual-20261011`, `phase13-context-sketch-ui-green-20261011` and `phase13-context-sketch-mr-20261011`; test logs and manifests are retained in TEMP.

APK deployment remains pending: ADB currently reports one unauthorized device with the previously used key unchanged. No new installation or physical Quest acceptance is claimed. Task 7 and full Phases 14–16 remain open; no further manual visor setup is requested.
