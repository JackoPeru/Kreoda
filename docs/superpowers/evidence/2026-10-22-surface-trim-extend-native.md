# Surface trim and extend — native verification

22 October 2026. Checkout `.worktrees/phase10-ci`, unchanged branch/HEAD
`codex/phase12-quest-foundation` / `7b196638a84e4caaeea05a707d94038011e4ba33`.
Luna/Max implemented the native tranche. After its usage limit, root continued
under the user's explicit fallback authorization.

## Verified

- Native commands 55/56 and read-only `resolveSurfacePoint` are implemented.
  Existing IDs 0..54 match the original schema and generated enums.
- Exact trim partitions preserve the selected physical connected region.
  Extend preserves the source and its holes, adds an exact support annex, then
  sews. Outputs have no solids and zero volume. No mesh/cap fallback.
- Pure surface acquisition IDs distinguish colliding faces and boundaries.
  Existing solid role lookup and ambiguity reporting retain their prior behavior.
  Lost indexed picks require repair. A known single-face sketch generator can
  renew its bound OCAF selection after radius/placement changes only when its
  producer chain and sketch entity identities still match. Replacing the original
  curve fails atomically.
- Native full suite: **379/379**, 58 suites, 82.859 s in `native-full-2.xml`.
  Afterwards one candidate-context regression was added without production changes:
  **15/15** surface tests in `candidate-focused-1.xml`. Direct parameter preview
  uses genuine bindings; detached upstream candidates fail explicitly. Snapshots,
  history and live area remain unchanged.
- Independent stdio proof `parent-native-shell-3`: eight real outputs (rectangle,
  cylinder, sphere, torus, L-shell, sewn box; rectangle/cylinder extension), six
  atomic invalid commands, read-only acquisition, preserved source records and
  mesh fingerprints, numeric edit, Undo/Redo and save/open.
  Native SHA256: `de35f9e66a913ec1744760f34184da6c2b4270481302f310a734b2b301e77c38`.
- Source guard `native-source-review-2/proof.json`: 1738 source files, 20 original
  preimages verified, 18 scoped changes, unrelated dirty files preserved.

Evidence directory:
`.artifacts/Codex-tools/Native/phase15-surface-trim-extend-20261021/parent`.
Earlier failed builds/tests/proofs are preserved. In particular `native-full-1`
found five regressions from applying surface acquisition naming to solids; the
correction is verified by the full second run. `strict-reference-red-1` found
public internal-binding fields and empty missing-reference errors; the green
focused/full runs verify the strict three-field public reference contract.

## Remaining delivery

Shared schemas, Desktop UI/picking/revision fences and Quest classification/render
proof are the next tranche. The installed app/APK still contains command 54.
This evidence does not prove client integration, packaging, device deployment,
physical hand tracking, comfort, live Hermes/voice, hosted CI or release.
The original Phases 12–16 goal remains active.
