# Native datum constructors — partial Task2

Full Phases12–16 goal remains active. Root continued under explicit user quota fallback after selected worker/reviewer terminal quota. This layer does not complete datum features or15.1. No new command IDs, client paths or fake renderer CAD. Main PR headfa78baf unchanged while isolated native worktree advances.

## Implemented

Dedicated DatumStore with stable order and mutex; DatumRecord retains featureId/kind/definitionJson/dependencies, resolved plane/axis/point and status/error. ResolveDatumDefinition is read-only and adopts its output only after successful validation. Definitions and nested refs use the string discriminant type. Plane types: principal, offset, mid, angle, threePoint; axis types: twoPoint, planeNormal, planeIntersection; point types: coordinates, midpoint. Refs: principal/datum/face planes, principal/datum/edge axes, coordinates/datum points.

Coordinates/offsets bounded±1000000mm; finite angleDeg±360 converted once. Basis validation reuses native SketchPlane validation1e-9. Coincident/collinear distances≤1e-7mm and parallel normal-cross length≤1e-9 rejected. Midplane aligns opposed normals through first frame; rotation uses directed axis and right-hand rule. Dependencies retain real source IDs and deduplicate in encounter order.

Native face/edge source resolution reuses actual classified persistent roles and OCCT FaceFrameInfo/BRepAdaptor_Curve. It requires unique planar faces/straight lines, validates native frames, and rebuilds y=normal×x on reversed faces so outward frames stay right-handed. Indexed/ambiguous roles are explicitly rejected; stable TNaming support for general indexed topology still belongs to unfinished Task2 and must not be silently excluded from final scope.

## Actual verification

Initial behavioral RED:6tests,5failed/1passed, retained TEMP/kreoda-datum-resolver-red-tests.log. Constructor math GREEN6/6. Native source/invalid gates9/9 with XML: actual OCCT100x50x20 box +Z offset2 gives z22; -Z outward frame validates; native straight edge drives rotated frame. Shape identity, one shape and100000mm3 volume unchanged by read-only resolution. Real cylinder wall/circular edge rejected; compound boxes with duplicate face roles rejected. Wrong-kind/broken/missing/invalid JSON, finite-range and degeneracy checks leave accepted output unchanged.

Full linked native CTest202/202 in77.06s, zero failures; core--self-test exit0. Whole native build --parallel2 successful; no package installations. TEMP logs kreoda-datum-all-build.log and kreoda-datum-all-ctest.log; focused output kreoda-datum-native-sources-tests.log.

## Remaining mandatory work

OCAF Datums folder, new/open/Undo/recovery synchronization, atomic create/update and graph/source rebuilds, datum-supported native sketches/features, cyclic-update and referenced-delete guards, SetParam edits, numeric commands31–35. Then canonical schemas/generated contracts and Desktop/Quest/MCP exposure with actual native chain/persistence/Undo proofs. Current store is not yet wired to DocumentStore create/reset; no product mutation route uses it. Keep this boundary explicit until lifecycle integration exists. Independent review and physical/live acceptance remain pending. No server/SSH/Hermes, device, mic/camera/audio or foreground GUI actions.
