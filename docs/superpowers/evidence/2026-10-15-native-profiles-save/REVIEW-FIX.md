# Initial native profiles/save review: fix-first

Fresh reviewer01a14001-ea5a-7613-995a-f18a46786570, actual GPT-6-Sol/high, reviewed immutablee4edeea..9e2dc8fa11b502a0cdc89abb992321719fc236ae and returned fix-first. Parent observed the clean unchanged candidate after review. Actual environment was danger-full-access, disabled permission profile and approval never; the reviewer remained behaviorally read-only. No enforced sandbox is claimed.

Required correction: ValidateProfileEdge checks all poles of the underlying native B-spline, even those outside the edge's finite first/last interval. A planar trimmed span can therefore fail merely because unused parts of the source curve are nonplanar. Parent inspected the actual all-poles loop and accepted the finding against the native-trim contract.

The same completed GPT-6-Luna/Max worker01a13fdd-edbe-7612-aec8-e6913da609d6 resumed on correction turn01a14004-ebcf-7e20-840d-07c4605f3060. Ownership is narrowed to sketch_face.cpp and test_projection.cpp. Required behavioral RED/GREEN uses a valid multi-span native B-spline with a planar used span and off-plane unused span, closes the trimmed edge into a measured exact profile, retains native curve/trim and immutable complete source BRep, and still rejects a trim actually entering the nonplanar span. Validation must use the exact native interval, not remove planarity checking or substitute a sampled polygon.

Prior254/254 and the first review do not establish acceptance of the correction. Final normal build, complete native CTest, restricted-PATH self-test, independent parent verification and a NEW fresh immutable review are required. The unchanged published9df evaluator CI success does not cover this candidate. Associative lifecycle and full original Phases12–16 remain active.
