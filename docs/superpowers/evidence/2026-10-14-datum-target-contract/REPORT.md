# Canonical datum targets and Desktop sharing

Status: parent unit/build/hidden native E2E verification passed; immutable review pending. Not full Quest/Phase15.1 acceptance.

## Implementation

- Canonical selection kinds now include datumPlane/datumAxis/datumPoint. Desktop classifies actual datum UUIDs by their native record, rather than treating them as bodies or edges; context toolbar avoids solid actions for reference objects.
- Canonical CreateSketch metadata declares optional datumPlane support binding. Session context validates kinds through the canonical schema and binds exactly one valid plane UUID. No selected plane retains principal creation; axes/points never bind support; ambiguity and explicitly invalid/broken references block implicit creation.
- Central Desktop creation uses optional binding for ordinary UI calls. Provider-resolved skipAvailability plans retain their explicit parameters and do not pick up unrelated current UI selection; explicit supportRef remains authoritative for native validation.
- Current shared-target filtering includes datum UUIDs with existing lineage/revision/ambiguity rules. Both viewport and SharedTargetChip receive those records. Remote guide highlights remain independent of body materials, local hover/selection and broken status.
- Standard command-schema build excludes test sources from the published package build; tests continue to run in Vitest. This resolves node:fs test-only type imports without an ad-hoc typeRoots workaround or a new runtime dependency.
- The prior MCP E2E introduced three browser callbacks that referred lexically to Playwright's Page named window. Those callbacks now use globalThis.window, fixing four standard TypeScript errors; no MCP/probe/native behavior changed.

## Parent verification completed

- Full Desktop Vitest284/284 across43 files, zero unhandled errors,36.74 seconds.
- Canonical command-schema24/24; standard package build and lint exit0.
- Protocol51/51 and generated session-contract check: five artifacts/43 DTO schemas match sourcefc27989e6b39fd8d12cafa770f72ab89f26e7bb0f9d14b635f687b3ebbdfe6ce.
- Standard Desktop lint and full build exit0, including renderer/main/preload. Vite's existing chunk-size warning remains recorded rather than suppressed.
- Parent independently reran four hidden native Electron cases:4/4 in1.2 minutes. Existing Box MCP, datum/sketch/solid edit/save/open/Undo, actual datum MCP one-group Undo/Redo, and new datum target flow all passed. New target flow creates native plane/axis, rejects wrong-kind/missing/stale references, executes CreateSketch with the actual session-returned boundParameters and verifies native/renderer full frame, then publishes a remote UUID independently of local selection and removes the guide target with Undo.
- Independent Quest baseline with current managed contracts55/55, source bytes restored, is separately recorded in ../2026-10-14-quest-contract-baseline. It is not proof of the new Quest datum feature.

Worker exactGPT-6-Luna/Max task01a13ab4-dc56-7cd3-9085-f26fe0a9867a delivered scoped code/tests and the authorized MCP callback correction. Parent inspected actual diff, required tests for invalid/broken selection and provider-plan isolation, and repeated standard gates.

## Open gates

A fresh immutable GPT-6-Sol/High review remains required before accepting this packet. Native kernel source and managed contracts are unchanged from reviewed1bd331a;233 native cases were not redundantly rerun for this client-only change. Quest guide/view/pinch/construction/voice target adapters and normal ARM64, current-head CI, live Hermes and physical acceptance remain open under the original full Phases12–16 goal.

No server/Hermes/SSH/AI/device/microphone/camera/audio/foreground GUI calls. Primary dirty user checkout preserved. No merge or release.
