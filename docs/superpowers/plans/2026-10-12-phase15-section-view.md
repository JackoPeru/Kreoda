# Desktop and Quest section view Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inspect actual model interiors in Desktop and controller-free Quest with a consistent, reversible view section.

**Architecture:** Client-local plane state in CAD millimetres drives presentation clipping and visible-only picking. Native B-Rep, IDs, geometry buffers, revision, export and Undo stay authoritative and unchanged. Reuse existing renderers/controls and native coordinate conversion; do not add a renderer CAD solver.

**Tech Stack:** Existing React/Zustand/Three.js, .NET8/netstandard2.1, Unity6 built-in rendering/Meta XR and current test tools. No dependencies.

**Spec:** `docs/superpowers/specs/2026-10-12-phase15-section-view.md`; roadmap Phase15.5. This does not complete full Phases15–16.

## Global Constraints

- Compact on-demand UI: enable, X/Y/Z axis, quota in mm, inversion and reset; native bounds midpoint initializes quota, empty model stays disabled.
- Keep accepted mouse/panel/hand/two-hand/voice behavior. Quest must work without controllers and no manual connection setup.
- A plane uses unit CAD normal `n`, finite `dMm` within ±1000000mm, enabled/inverted flags. Visible CAD points satisfy `sign*(dot(n,p)-dMm)>=0`; picking tolerance is1e-6mm.
- Actual Unity mapping is `(x,z,y)*0.001`, with identity body views below DisplayRoot; instances are baked in native buffers. Local section follows root placement/rotation/scale.
- Apply section to CAD surface/edges/highlights/shared-target/preview; never invent a persistent cut face/edge or mutate original mesh data. Unrelated UI/grid/reference aids stay functional.
- Reset on successful document open/new identity; retain on ordinary in-document remesh. Dispose all owned resources during toggles/remesh/unmount.
- No real Hermes request, remote mutation/restart/reload, mic/camera capture or PC audio while user image work is active. Local tests/builds only; hidden PC QA. Physical usability is separately unproven.

## Review Focus

- Unit conversion/reflection and root transform must preserve the quota relative to model geometry.
- Hidden outer triangles/edges cannot steal picks from visible interior geometry; panel/button/edit handles remain usable.
- New/replaced materials, selection and preview must inherit section; disabling must restore presentation.
- Invalid input/document change/empty model cannot strand the viewport in an unexplained blank state.
- Repeated toggles/remesh must not leak materials/buffers or create CAD/Undo mutations. Incomplete cap/contour presentation must be recorded and finished before feature acceptance.

### Task 1: Desktop section and native invariants

**Files:** new `apps/desktop/src/section/plane.ts`, `store.ts`; new `apps/desktop/src/components/workspace/SectionPanel.tsx`; modify `TopToolDock.tsx`, `Viewport.tsx`, `viewport/CadViewport.ts`, `viewport/viewportHandle.ts`; relevant successful-open/reset hook located in current document actions; locale `i18n/en.ts`,`it.ts`; new tests `apps/desktop/tests/section-plane.test.ts` and `apps/desktop/e2e/phase15-section.spec.ts`.

**Interfaces:** pure `SectionPlane { normal: [number,number,number]; offsetMm: number; inverted: boolean }`, bounded constructor/validation and signed-distance/visible-point helpers. View store owns `enabled/plane` and a local initialization flag; an explicitly configured zero quota must survive toggles and panel remounts. Document reset clears initialization. Viewport `setSection(plane: SectionPlane|null)` and an E2E diagnostic summary expose presentation state without CAD commands.

- [x] Read current material creation/replacement, all overlays and body/edge raycast paths. Add failing math tests for axes/inversion/boundary/invalid numbers and negative quota.
- [x] Implement bounded pure plane math/store and compact dock panel. Default axisZ, quota from actual mesh bounds. Reject invalid edits while retaining previous state.
- [x] Use Three local material clipping and request demand render; apply consistently to replacement surfaces/lines/highlights/preview. Preserve original material ownership and styles.
- [x] Filter body/edge ray hits to nearest visible candidate, including crossing-segment behavior; no fabricated IDs for display intersections.
- [x] Add actual native Desktop E2E: create measured model, change section, inspect changed visual/pick state; canonical revision/IDs/volume/solidCount unchanged; disable restores and one existing CAD Undo still works. Verify empty/open/remesh/reset behavior.
- [x] Include a genuine OCCT hollow/blind-hole body: the cut presentation leaves the opening empty and a real interior face remains pickable through it. Synthetic cap-hole unit fixtures alone do not prove this native path. Undo to empty must disable section; ordinary same-document remesh retains quota.
- [x] For that interior proof, retain the lower half with an inverted Z cut and use a controlled ray to a native wall below the cut that the uncut exterior occluded. Record the actual core information in evidence; do not hardcode a kernel label or count an already-visible hole opening as proof of removal.
- [x] Review cut presentation against spec; finish required cap/contour behavior instead of counting a merely enabled shader as acceptance.
- [x] Run relevant JS tests/lint and hidden native E2E, capture before/after source/artifact evidence, obtain fresh Sol6/high review and record accepted Desktop software slice. Full section remains incomplete until Quest path is proven.

### Task 2: Quest section, hands and presentation invariants

**Files:** new SDK `clients/session-dotnet/src/Kreoda.QuestFoundation/SectionPlane.cs` and corresponding test file; new runtime `clients/quest-unity/Assets/Kreoda/Runtime/QuestSection.cs` and Unity `.meta`; modify `QuestMeshView.cs`,`QuestControls.cs`,`QuestConnection.cs` only at presentation/scene-reset integration; `QuestPreviewView.cs` for clipping state preservation; shaders under `Assets/Kreoda/Materials/` (including Selection.shader), scene builder `Assets/Kreoda/Editor/QuestBuild.cs`; new Unity editor tests for section behavior. Root owns evidence/docs.

**Interfaces:** immutable bounded SDK plane with CAD and Unity-local signed-distance helpers, identical semantics to Desktop. Runtime owns view state and applies it to existing body/edge/selection/preview renderers; uses native view bounds for quota and inverse local transform for pick checks. No SessionClient CAD mutation API calls.

- [ ] Add failing SDK tests for exact CAD↔Unity `(x,z,y)*0.001`, axes/inversion/boundary and invalid input; test actual SDK targets.
- [ ] Implement local shader clip equation with stereo/instancing and current material style/transparency. Use per-renderer properties or explicitly owned material instances, never mutate shared asset state accidentally.
- [ ] Add compact pinch-compatible controls and visible-only closest-ray selection while preserving non-CAD UI/edit handles and all current gesture/voice behavior.
- [ ] Handle multiple intersections within the same CAD collider: `Physics.RaycastAll` alone does not expose the next interior triangle after a clipped first hit. Use an exact visible native-triangle query or an equivalent correctly bounded ray strategy; return the original semantic triangle index. Test a single hollow native body with a hidden outer hit and visible interior hit, including inversion. Non-CAD hits still compete at their actual ray distance.
- [ ] Apply to remesh/preview/highlight and reset on document/session identity change; root movement/rotation/scale preserves CAD quota. Never change source positions, indices, persistent maps, revision or Undo.
- [ ] Unity tests prove transformed-root equivalence, buffer/ID preservation, clipping of overlays, toggles/remesh resource cleanup and controller-free routing. Verify rendered section/cap/contour presentation in controlled editor QA.
- [ ] Compile normal ARM64 MR player with shaders included, using hidden batch tooling. No headset camera/person audio. Do not claim physical usability/performance from editor/build success.
- [ ] Parent verifies relevant managed/JS/schema/Unity/native gates, source-frozen Sol6/high review and exact hosted head. Record actual software boundaries and remaining device evidence; full Phase15 is still not complete.

### Task 2 preflight findings (parent, 12 October)

- `CadMeshTransform` resides in `UnityMeshTransform.cs`; exact conversion remains `(x,z,y)*0.001`, and conversion normalizes winding without changing semantic triangle spans.
- `QuestControls.Pointer` routes a tracked hand's index pinch to the same button action used by the controller. Section controls must reuse that path; UI tests must exercise actions plus the hand-first routing contract.
- `QuestPreviewView.Surface` clears its property block and `StaleStyle` replaces it with an alpha block. Ruling: include that file in Task2 ownership and compose section properties with stale styling, rather than losing clipping on preview replacement. Cost if missed: preview hides/displays a different half-space than committed geometry.
- `QuestControls.Update` currently uses one `Physics.Raycast`, and one collider may contain all faces of a hollow native body. Ruling: filtering one result per collider is insufficient; retain native triangle identities while finding the nearest visible intersection. Cost if missed: the clipped outer wall prevents interior selection.
- `BodyMesh` already retains converted positions/indices/edge buffers and original semantic spans (`SceneModel.cs`). Reuse these buffers for section picking instead of reading allocating `Mesh.vertices`/`Mesh.triangles` copies on every pointer frame. Preserve the original triangle index and compare world ray distances under transformed display roots; section-off uses the existing input path.
- `QuestConnection` already emits `SceneChanged`; reset state on observed session/document identity changes, retain it on ordinary revision/remesh, and clear/disable it when the last CAD view disappears. Do not reset from every mesh-upload notification.
- Successful native new/open (relay command types2/11) already rotates `SessionRelay.sessionId` in `apps/desktop/electron/session.ts` before broadcasting the replacement snapshot, even when `documentId` remains `doc-phase1`. Use the existing `(sessionId, documentId)` lineage instead of introducing a protocol field or guessing from revision numbers. The existing `native-blind-hole.meshfb` fixture is available through `QuestMeshViewTests.NativeFixture()` for original-triangle/persistent-reference regression checks.

## Remaining roadmap

Seven live Hermes fixtures/full failed command evidence and physical Quest acceptance remain open. Phase15 still requires reference/datum geometry, projection, advanced sketches, surfaces, other analysis, constrained assemblies, configurations and explicit imported-B-Rep edits. Phase16 intent/pattern/symmetry/generators/design-from-function also remains open. No scope reduction or whole-goal completion claim.
