# Desktop section view — verification in progress

Scope: Task1 of the committed Desktop/Quest section plan, Phase15.5. Full Phases12–16 remain unfinished.

Separate actual GPT-6-Luna/max task `01a13088-8e15-70c1-9e15-fde7d755d4c0` implements compact controls, client-local CAD-mm clipping, native-only visible selection, render-only cut caps/contours and reset/remesh lifecycle. Native B-Rep and CAD Undo remain authoritative.

## Observed worker native proof

Run `phase15-section-desktop-worker-r12-20261012`: actual OCCT `8.0.1-native`, one native Electron E2E passed in1.2min. Hidden at construction, no offscreen/throttling wrapper override, compiled main restored exactly (`ed967338bd7a29481f9f1daa87475eb826edb15cd2c669978926ad615dc454f1`).

A real Playwright mouse ray first selects the uncut roof, then a true native blind-hole wall below the inverted Z=10mm cut. More is closed for model interaction; elementFromPoint verifies canvas. Cap area5949.817818843745mm² and a clear hole center prove the native triangulated cut opening; the actual unobscured image was visually inspected by the parent. Revision4, native feature IDs, volume119246.01776313846mm³ and solidCount1 stay identical through section changes. The same document remesh retains the plane, native width edit Undo restores100mm, and successful open disables section.

R1–R11 failures are retained in external QA: screenshot acquisition, off-state diagnostic mismatch, overlay interception, stale selection and curved-face averaging. R11 native data identified all126 wall triangles with winding opposing supplied outward normals. The implementation uses native outward normals for anchors and DoubleSide only during section, with original material side restoration. Unit checks and final delivery still need parent confirmation.

## Remaining gates

Independent parent Desktop unit/lint and native section plus existing pull workflow rerun; full diff/scope inspection; fresh source-frozen Sol6/high review; commit/push and exact new-head hosted CI. Quest section/shaders/controller-free integration and normal ARM64 build are Task2, not completed by this Desktop proof. Real Hermes seven-fixture benchmark, complete command evidence, physical hands/voice/comfort and all other Phase15/16 capabilities remain open. Hermes image work was left undisturbed; no real Hermes calls or remote service changes.

## Independent parent verification

Initial full Desktop unit gate failed2 App tests because the existing viewport mock lacked setSection; that RED result is retained in TEMP/kreoda-section-parent-unit.log. Worker updated only the mock boundary, preserving assertions. Parent repeated all Desktop tests:38files/223passed,0failed; lint and fresh Desktop build passed. Parent hidden native section+existing pull gate passed2tests in1.8min. Legacy pull fixture then received an isolated temporary user/recovery profile and existing background-hide helper, preserving all real drag/parameter/one-Undo assertions; its independent rerun passed1test in37.7s. All compiled-main wrappers restored raw SHA ed967338bd7a29481f9f1daa87475eb826edb15cd2c669978926ad615dc454f1.

Native parent proof is retained here as native-proof.json, with actual same-ray roof→wall selection and unchanged revision4/IDs/volume119246.01776313846/solidCount1. Diagnostic correction now measures actual FrontSide (123hits/26unoccluded) separately from DoubleSide (189hits); production section has92visible wall hits. Review and exact new-head hosted CI remain pending.

## First review and authorized root correction

Fresh actualSol6/high01a130e7-0565-76b3-9bd7-8854255bc9b9 returned fix-first: a tangent cap could mask a native face; edge selection ignored retained native surface occlusion. All888source and33compiled-artifact hashes remained unchanged during review. Observed host danger-full-access/disabled; read-only behavior was procedural.

Luna correction turn ended immediately with terminal usage-limit error, so root continued under the user’s explicit quota fallback instruction without replacing or retrying the implementer. Three new assertions were observed RED, then GREEN11focused checks. Tangent planes no longer create a cut cap without geometry strictly on both sides; equal-depth native faces may win over a coincident display cap. Edge candidates are checked against retained native surfaces and caps along the actual segment-point ray, preserving tolerance for exposed boundary edges.

FullDesktop226/226 passes with maxWorkers2, lint/build pass. A concurrent-build full run had one asynchronous workspace-load timeout; isolated App7/7 and the limited-concurrency full gate passed, no timeout/assertion/skip changes. Hidden native blind-hole and pull paths pass after runtime fixes. New native boundary case passes24.9s with realmouse: native tangent face selected, occluded rear edge rejected, exposed front edge selected, native B-Rep/revision unchanged. Earlier fixture attempts targeted overlapping visible edges and an incorrectly assumed iso direction; those failures are retained. Final test asserts actual iso view direction (+X,-Y,+Z camera) before selecting rear/front corners. Boundary proof retained as native-boundary-proof.json. Fresh corrected review and hosted head remain pending; no broad completion claim.

## Section-off compatibility correction

FreshSol6/high01a131eb-6c4a-7932-9fec-b19ee36c1a19 returned fix-first because surface occlusion also affected edge picks while section was disabled, contrary to the spec. All889sources/33artifacts unchanged during that review. Root added an off-state regression and observed it fail, then restricted the new occlusion filter to active section planes. FullDesktop226/226 passes with2workers; fresh build/type check pass. Hidden native boundary case now also selects the original rear edge after disabling section, while rejecting it when active and keeping the exposed edge selectable. Independent native gate1passed31.9s, compiled main restored exactly. Latest native-boundary-proof.json contains that off-state evidence. New fresh review and hosted head still required.

## Document switch while Home is displayed

FreshSol6/high01a131f0-f5b0-7683-ad87-bc11a9b2d52f returned fix-first: Viewport-only epoch reset missed a nonempty document replacement while Home had unmounted it. All889sources/33artifacts unchanged during review. Root observed an App regression fail on the retained enabled plane, then moved reset to DocumentUiStore.resetDocument and removed the duplicate viewport-epoch effect. The section store has no document-store dependency, so this introduces no import cycle; ordinary in-document updates retain section.

FullDesktop227/227 with2workers and fresh build/types pass. Native tangent/edge/off-state case and pull passed after the central reset; the blind-hole path also passes with actual open while Home is displayed and reentering the workspace afterward. Initial extended native attempt timed out waiting for Back Home with More still open; normal More-close before Home resolved it, no timeout/assertion/forcedclick changes. Updated native-proof.json records documentOpenedWhileHome=true, reset section/mesh and unchanged CAD proof. New source-frozen review required before acceptance.

## Explicit zero quota preservation

FreshSol6/high01a131ff-1348-7512-929e-85f5f22af79a returned fix-first: the default Z/0 plane was used as an initialization sentinel, losing a legitimate zero quota on re-enable. All889sources/33artifacts unchanged during review. Root observed the disable/remount/re-enable regression RED, then added a view-local initialization flag. Valid plane edits and explicit Reset View initialize it; authoritative document reset clears it. FullDesktop228/228 passes, build/types pass, and the focused lifecycle also proves a new document initializes its midpoint again. Hidden native blind-hole E2E including actual zero-quota button toggles passes1.4min; B-Rep/IDs/revision/Undo and Home-switch checks remain passing, compiled main restored exactly. Fresh review and new-head CI remain pending.

## Midpoint outside the supported quota interval

FreshSol6/high01a13205-d696-7ee0-bb77-e0f71c34423f returned fix-first: a valid translated model can have a bounds midpoint outside ±1000000mm, and the panel enabled its uninitialized Z0 fallback after constructor rejection. All889sources/33artifacts unchanged during review. Regression observed RED1; initialization now returns before enable when construction rejects that midpoint. FullDesktop229/229 with2workers passes and fresh build/types pass. The previous native zero-toggle/blind-hole/Undo/Home proof remains relevant: this single early-return guard affects only rejected initialization; no renderer or native code changed afterward. No extra native rerun required for that unchanged path. Final fresh review and hosted head remain pending.

The first build after adding the bounds fixture rejected its inferred number[] type; the fixture parameter now uses CoreMeshData["bboxMm"]. Final build/type check passes; no product change was needed for that test typing error.

## Same-document tip hydration and rejected Reset

FreshSol6/high01a13209-2122-7c11-863a-b51e29c191f0 returned fix-first: an empty mesh interval while Box advances to Hole cleared the section; Reset mapped an invalid midpoint to the default plane. All889sources/33artifacts unchanged during review. Root observed two RED regressions. Viewport now distinguishes a genuinely empty model from native tips awaiting their mesh using authoritative bodies/Instance summaries. Reset only accepts a valid constructed midpoint and otherwise preserves enabled/plane. The deterministic regression holds the empty interval explicitly, then hydrates Hole, then proves actual empty-model reset.

Final fullDesktop231/231 with2workers, build/types pass; new-test type check also passes. The first full rerun exposed stale React bounds in the test because its external store update lacked act; corrected test scheduling, no product workaround. Extending the long native E2E exceeded its existing90s limit, so the tip case was separated without raising timeouts or removing assertions. Fresh native boundary and original blind-hole both pass; dedicated native Box→Hole initially lacked required face selection, fixed test setup only, then passes12.8s. Latest native-tip-swap-proof.json proves quota7 survives a real native tip replacement; latest native-proof.json retains roof→wall mouse picking, native invariants, Undo/Home/zero checks. All hidden wrappers restore compiled main exactly. Failed attempts retained. Fresh review/new-head CI still pending; Quest/fullgoal remain open.

## Tangent face beside a crossing solid in one mesh

FreshSol6/high01a13217-1dd9-7871-bf2d-ecdacb1ff636 returned fix-first: the mesh-global crossing guard allowed a tangent-only perimeter on a separate solid to become a cap. All890sources/33artifacts unchanged during review. Root observed two compound area regressions RED (8mm² instead of4). Cut segments now retain incident triangle above/below signs, merge signs for shared on-plane edges, and enter cap/contour generation only when both sides are present. This removes tangent-only loops without a new component graph and preserves cuts along existing triangulation edges. Compound/inversion/edge-aligned presentation tests pass; an actual Three ray intersects no cap above the tangent face and picks its original native semantic ID through the production picker. This unit proof uses raw closed-cube mesh buffers, not a newly measured OCCT compound.

FullDesktop235/235 with2workers and fresh build/types pass. Independent hidden native section suite3/3 passes2.1min: tangent/retained-wall/OFF edge selection, actual Box→Hole quota7 retention, and native blind-hole actual mouse roof→wall with cap aperture/B-Rep/IDs/revision/Undo/Home/zero-toggle unchanged. The initial compound picker fixture queried its default ray before setting the intended ray; corrected test setup only. Latest native proof files copied here; all compiled-main wrappers restored exact raw SHA. New fresh review required, hosted head/Quest/fullgoal remain open.

## Oriented solid and cavity occupancy (13 October)

FreshSol6/high01a1321e-59e9-7970-92ad-2df6717db3e0 returned fix-first: the supposed hollow unit fixture was actually two outward closed boxes, and depth parity gave nested solids a false aperture. All890sources/33artifacts unchanged during review. Root observed nested solid area12 rather than16 RED. The fixture now explicitly reverses the inner cavity shell; a separate outward nested-solid test expects16. Segment direction uses native outward normals (triangle winding fallback when absent), and signed nonzero loop occupancy distinguishes outward solids from inward cavities. Nearest active outer loop owns actual hole contours. Native buffers and IDs remain untouched. Tests include actual normal/winding mismatch and an outward island inside a cavity.

FullDesktop238/238 with2workers and fresh build/types pass. Fresh hidden native section suite3/3 passes2.1min after the orientation change. Genuine OCCT blind-hole cut area5949.817818843745,134triangles, aperture uncovered, same real mouse roof→wall and native revision/IDs/volume/solidCount/Undo/Home/zero tests pass; tangent/edge/OFF and native tip-swap paths also pass. Raw compound/cavity unit fixtures are distinct from this measured native proof. All compiled-main wrappers restored exactly. Fresh review/new-head CI pending; Quest and fullgoal remain open.

## Accepted Desktop software packet

Fresh actualGPT-6-Sol/high01a13590-2b1b-77f0-952a-96ac88f494bb returned ship for bounded Desktop Task1. Parent independently compared all890source files and33compiled artifacts to frozen SHA b0c1273ab94568a23bbb6c272a8a546b96542ff5c0a567c9e0a1de179b4d013e: unchanged. Observed danger-full-access/disabled host; read-only conduct behavioral, not sandbox enforced. Only evidence/plan acceptance annotations follow this verdict; product/test sources stay reviewed. Hosted CI for the forthcoming commit remains pending; QuestTask2, compound/cavity OCCT measurement, physical acceptance and complete Phases12–16 remain open.
