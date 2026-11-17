# Phase15: Desktop and Quest section view

## Purpose and scope

The full roadmap remains binding. This feature implements the section-view capability in Phase15.5 while datum/reference geometry, projected geometry, advanced sketches, surface modeling, other analysis, constrained assemblies, configurations/direct editing and Phase16 remain separate unfinished work. Sectioning must help inspect the interior of an actual CAD model in Desktop and controller-free Quest.

A section is a client-local presentation plane expressed in authoritative CAD millimetres. The roadmap permits client-specific presentation and does not require a shared section definition. No geometry, feature IDs, canonical model dimensions, B-Rep, export, revision or Undo entry may change when enabling/moving the view.

## Controls

- Desktop: compact on-demand “Sezione” control in the existing tool dock/menu. Enable/disable, X/Y/Z normal preset, signed quota in mm, side inversion and reset. Preserve accepted mouse left-rotate/right-pan/wheel-zoom controls and viewport space.
- Quest: compact existing panel/page, with pinch-compatible buttons; no controller dependency. Enable/disable, axis preset, quota adjustment and inversion/reset. No keyboard/IP/setup requirement. Current panel dragging, two-hand model placement and voice cancellation rules remain intact.
- Initial quota uses the actual model bounds midpoint on the chosen axis. Empty model cannot initialize an arbitrary misleading cut. Reject NaN/infinite/out-of-range state and preserve the last valid state.
- A newly opened/different model resets the view; ordinary geometry updates within the same document retain a valid section. Preview and selected-edge/face overlays follow the same cut.

## Plane semantics and observed existing paths

Represent the plane as finite unit normal `n` in CAD XYZ and signed offset `dMm`, plus enabled/inverted flags. Visible points satisfy `sign * (dot(n,pCadMm) - dMm) >= 0`, with a documented small boundary tolerance for picking. Presets are axis normals; the math supports arbitrary unit normals without an additional CAD kernel.

Desktop receives native mesh coordinates in CAD mm through `CadViewport`. Use Three local material clipping on CAD surfaces, their edge lines, previews and selection/shared-target overlays. Grid/reference images/UI remain presentation aids. All newly created/replaced materials must inherit current section state; disabling restores original presentation.

Actual `CadMeshTransform` maps CAD `(x,y,z)` to Unity metres `(x,z,y)*0.001` (reflection, not a guessed sign flip). `QuestConnection` creates body views under `DisplayRoot` with identity local transforms; native instance placement is already baked into coordinates. Section evaluation can therefore use mesh-local Unity points and that exact inverse conversion. Moving/rotating/scaling `DisplayRoot` must not move the CAD quota relative to the model. If a nonidentity per-view transform is introduced, the mapping must explicitly account for it rather than treating world metres as CAD mm.

Quest surface/edge/selection/preview shaders must use the same clip equation, support stereo/instancing and preserve current material color/transparency behavior. Avoid mutating shared asset materials or leaking cloned materials; use per-renderer state where appropriate. Existing `Selection.shader` and generated scene material references must stay compatible.

## Selection and topology

Clipping must affect picking as well as pixels. Desktop currently chooses the first body/edge raycast result; choose the nearest visible candidate instead, respecting native face/edge spans and persistent IDs. A crossing edge must not be selected through its hidden portion. Quest currently uses nearest `Physics.Raycast`; evaluate visible candidates without clipping panel/button/edit-handle input. Section-off behavior stays unchanged.

No display-created intersection may pretend to be a persistent native face/edge. Render-only cut surfaces/contours, if added, are not eligible for CAD mutation or voice target IDs. Existing selections remain real native references; section toggles do not rewrite shared semantic selection. Any intentionally unsupported cut-surface selection must remain clear to the person using the tool.

## Required evidence

- Deterministic plane tests for all axes, inversion, boundary, negative quota, invalid numbers and CAD↔Unity mapping.
- Actual Desktop/native E2E: section visible, changed appearance and visible-only picking; same canonical revision, feature IDs, exact native volume/solid count before/after; controls and Undo still operate. Use hidden-at-construction local QA and actual OCCT, not generated mesh stand-ins as acceptance proof.
- Unity editor tests: clipping applies to surfaces/edges/selection/preview, follows moved/rotated/scaled display root, does not mutate source mesh buffers or IDs, and repeated toggles/remesh release owned resources.
- Explicit controller-free input path coverage for the Quest controls. Shader/build verification on the normal ARM64 player; physical usability/performance remain separate and unproven until device evidence exists.
- Preserve existing relevant JS/managed/schema/Unity/native gates; exact hosted head and fresh source-frozen Sol6/high review before accepting the software packet.

## Boundaries

No new dependency or renderer CAD solver. No hidden reasoning, microphone/camera capture, PC playback, real Hermes run/restart/reload or remote mutation while the user's image work is active. Native cut geometry, section persistence/sharing, full Phase15 acceptance and physical Quest acceptance must not be inferred from a shader or unit test. Do not silently represent incomplete cap/contour behavior as a finished engineering section workflow; record it and complete any required presentation work before the final feature acceptance.
