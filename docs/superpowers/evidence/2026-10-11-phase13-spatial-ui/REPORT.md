# Phase13 Task5 Unity spatial interaction

The populated scene now connects Model/Edit controls, semantic handles, an immutable intent/serialized worker, head-facing CAD quotes, a minimal tracked-palm menu and an on-demand advanced panel. Actual native DescribeParams supplies named currentValues; Unity does not duplicate parameter slot tables. Queries and network work run away from the frame loop and retain applied-view/session/document/revision fences.

Tracked hands take priority; controllers provide fallback. Changing pointer source cancels the held edit and requires a fresh press. Two-hand display gestures also lock both input sources, alter only the independent display transform, and restore their start after tracking loss. CAD vertices are untouched. Exact input captures the selected intent; dismissal without Done requires explicit Apply, and focus loss discards pending confirmation. Snapping uses mm or degrees.

Transient surfaces own cloned/decoded meshes without selection colliders or QuestMeshView identities. Local visual cues derive from the actual constrained/snapped draft, while exact solids come from the PC. The preceding accepted solid remains visible with reduced opacity until replacement; it does not masquerade as the latest exact candidate. Version/ticket/epoch/generation gates reject late candidates and clear the ghost after cancellation or completion. Shared materials survive owned mesh cleanup. Quotes show units, prioritize the selected dimension and use measured projected bounds to resolve overlap. Visual handles are offset outside the displayed body without changing their semantic origin.

Verification:

- Meaningful Unity RED checks reproduced missing interaction paths, hidden handles, missing query metadata, numeric focus retention, input handoff/priority and disappearing accepted solids.
- Final actual Unity EditMode37/37, direct0,20.152s. Covers the actual populated scene, inverse Unity transforms at three scales, quote rendering bounds, native fixture upload/semantic identity, owned ghost clone/replacement/disposal, transport query/reconnect and control lifecycle.
- Shared actual net8 and actual netstandard2.1 libraries:115/115 each, direct0. Added constrained/snap cue checks for linear, planar, radial diameter and angular movement.
- Native OCCT174/174,66.739s. Named manipulator values come from the existing canonical per-type parameter mapping.
- Full JavaScript265/265 and lint passed. Accepted Task4 head6192e4b exact hosted run38099837988 succeeded.
- Corrected normal ARM64 IL2CPP APK:36,253,518B, SHA781bce243b1902e19ab65682276810ed5cbbd8b38bd29f114b38bf76ff54d88f; direct0,102.624s,0errors/6warnings. Build inputs unchanged.
- Fresh actual gpt-6-sol/high reviewer01a1288a-dc65-7570-b9c6-c3ec89022dc4:SHIP. Behaviorally read-only under the broader host policy. Reviewer observed two temporarily different Unity settings/assets while the build ran; final parent reconciliation finds all791 inputs exactly equal to the original review freeze, SHA3535c39922325e0c660aa3d0aa64673e04a2800fda36e57061b991fb9f677ddd. Build-before equals build-after and the current map matches both. No enforced isolation claim.

The corrected APK is built, not yet deployed. Physical usability, hand tracking comfort and real surface contact are not inferred from Editor tests. Updated PC packaging, Task6 context/sketch/history actions, Task7 autonomous workflow and Phases14-16 remain pending. No further manual Quest setup is requested; the existing ADB USB bootstrap/credential path is retained.
