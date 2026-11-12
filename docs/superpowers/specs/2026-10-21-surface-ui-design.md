# Manual surface creation in Desktop

## Intent and approved execution

Complete the missing human-facing creation workflow for the six surface commands
already implemented and verified in the full CAD goal. The user authorized
autonomous continuation and explicitly requires separate GPT-6-Luna/Max product
implementation. Parent designs, reviews, verifies and installs; no root fallback
on quota. Native code, Quest, shared schemas and command definitions are frozen.

Worktree: `C:/Users/matte/Desktop/Saas/Kreoda-phase10-ci`. External QA:
`C:/Users/matte/Documents/Codex-tools/Native/phase15-surface-ui-20261021`.

## User flow and layout

One new entry, **More → Surfaces**, opens a nonmodal right-side panel. No permanent
toolbar/sidebar, new backdrop, viewport interaction changes or Home changes. Use
existing Kreoda floating-panel styles: right 12 px, top 68 px, width 320 px capped
by viewport minus 24 px, maximum height viewport minus 176 px. Header/close and
footer/create remain accessible; only form content scrolls. Opening it closes
Project/Properties and competing right-side reference/instance panels. Opening
another side tool closes this panel. Home/document reset or disconnect closes it.

Panel has an accessible localized heading, operation selector, only the current
operation's fields, inline feedback, Create and Close. Escape closes when idle;
focus starts in the operation selector and returns to the More trigger on close.
During a request, disable submission and close/Escape; do not label an outstanding
native commit as cancelled. Other document navigation must remain safe through
the lineage guards below. Preserve mouse left-orbit/right-pan/wheel-zoom.

Operations come from an explicit UI allowlist over the existing command registry:
`CreateSurfaceExtrude`, `CreateSurfaceRevolve`, `CreateSurfaceLoft`,
`CreateSurfaceSew`, `CreateSurfaceOffset`, `CreateSurfaceSweep`. This is a subset,
not a new parameter/command registry. Labels/descriptions reuse localized command
text; no JSON editor, raw-ID input, placeholders for unfinished operations, or LLM.

Pick sources from current cached sketches/surface features. Use existing tree/type
labels with a deterministic ordinal to disambiguate equal names. UUIDs are internal
values, never required user input. Hidden current surfaces may be used without
changing visibility. Surface candidates use `surfaceFeatureIds`, including supported
direct instances; solid `SurfaceSewnSolid`/`SurfaceFaceThicken` are excluded. Refuse
known stale/broken/suppressed/missing sources; never substitute a different source.
Empty lists explain what to create first. Native geometry remains authoritative.

Prefill once from eligible selection when opening: one sketch for extrude/revolve,
selected sketch order for loft, two sketches in profile/path order for sweep, one
selected surface for offset, ordered distinct selected surfaces for sew. Do not
overwrite a user's form draft whenever viewport selection changes. Preserve valid
fields after native failure. Remove/clear invalidated references with an explanation;
do not silently retarget. Keep form values after success for deliberate repetition.

### Fields

| Operation | Fields and defaults |
|---|---|
| Extrude | Profile sketch; signed nonzero distance `10 mm` |
| Revolve | Profile; angle `360 deg`; world axis X/Y/Z/custom (default X); origin XYZ default 0 mm in advanced fields; custom direction XYZ default [1,0,0] |
| Loft | Ordered distinct sketch list, 2–128; add/remove and accessible up/down controls |
| Sew | Ordered distinct surface list, 1–128; tolerance `0.01 mm`; unchecked “Create solid if closed” |
| Offset | Source surface; signed nonzero distance `1 mm`; tolerance `0.000001 mm` |
| Sweep | Profile sketch; distinct path sketch; tolerance `0.000001 mm`; short alignment hint |

Reuse `parseLengthToMm` and `parseAngleToDeg`; dimensionless directions are finite
numbers. Use ordinary decimal strings for small default tolerances (the existing
unit parser does not accept exponent notation). Native/schema bounds and exact
defaults remain unchanged. Precision/origin controls may be collapsed initially;
all seven revolve parameters must be genuinely editable. Reject invalid/empty
values without dispatch; ordered lists must not sort by ID or silently deduplicate.
Sew can fail when the shell is open: show the error and preserve fields. Do not
infer solid closure from a mesh or report a surface as a solid.

## Typed execution and result handling

Add a small Desktop-only module `src/commands/surface-commands.ts` for the six-ID
allowlist/type and a `SurfaceCommandContext` with documentId, revision, epoch and
connectionGeneration. Do not duplicate registry Zod schemas. Add a bounded
`coreClient.createSurface(commandId, parameters, context)` method: runtime allowlist,
`commandNativeRequest`, exactly one allocated feature UUID, ordinary JSON invoke,
`CreatedFeatureSchema` response (surface volume optional, genuine solid preserved).

Add six explicit cases to central `commands/execute.ts`. The panel calls the normal
`executeCommand` path with an optional `surfaceContext` captured at submission.
Reject use of this option for other command IDs. No `skipAvailability` in the form;
the existing provider-only option and other commands retain their behavior.

For normal sweep execution only, derive availability context from the two explicit
schema-validated IDs after verifying both are distinct, present, healthy current
sketches in the current UI document. This permits a form to select inputs without
mutating global selection. Preserve the existing global `commandAvailability`
hint and native/session two-selected-sketch binding rules. Other five commands
also validate their explicit sources against the current local model before UI
dispatch. Provider-resolved skipAvailability retains its established semantics;
native validation still owns geometry and source validity.

Before dispatch verify captured revision, documentId, epoch, connectionGeneration,
coreRunning and `coreClient.documentId`. Do not dispatch known stale submissions.
After awaits verify document/epoch/generation/core liveness; do not demand the old
revision after a successful mutation, since canonical session events may already
advance it. These are UI freshness guards, not a new atomic native revision-CAS
contract. Existing native envelope and geometry checks remain authoritative.

Extend private `CoreClient.invoke` with an optional current-context guard, used
only by this new path, BEFORE applying undo counts or other response side effects.
Other calls retain default behavior. `requestSnapshot` may accept the same optional
surface context to guard a post-creation refresh; existing callers are unchanged.
The new execution cases refresh from the full canonical snapshot using existing
`syncFromCoreList`, with lineage checks around awaits. Do not synthesize body
metadata, resurrect a stale feature via append, or add fake zero volume.

The existing sync helper fences epoch but not connection generation during mesh
hydration. Add an optional final guard for this surface path, checked before store
writes and after awaited mesh pulls before mesh replacement or selection cleanup.
Legacy callers retain their behavior. A guarded call must not delegate missing
sketch models to the unguarded opened-session callback. The surface refresh helper
may read the existing typed `window.kreoda.sessionSnapshot()` full canonical model,
validate document/revision/lineage and full sketch models, then pass it to guarded
sync. Never guess models from old caches. A missing model is a read-only refresh
failure. Test real deferred hydration across disconnect/reconnect with unchanged
epoch, and document replacement; executor tests with mocked sync are insufficient.

Distinguish native failure from refresh failure after acknowledged creation. A
successful native creation must not be reported as failed and then accidentally
repeated. Extend the created CommandResult with optional `refreshError` for this
path; on post-commit refresh failure return the acknowledged feature plus that
warning. The panel says creation completed but view refresh failed, disables
Create until a successful read-only refresh, and offers Retry refresh. That button
must never call a creation command or Undo. Reuse one fenced refresh helper from
the executor. Stale/unmounted panels ignore late status/results and never select
old-document features. Busy refs prevent two synchronous clicks from submitting
twice. After a successful refresh, select the created feature only if it still
exists in the current model; do not automatically open Properties over the form.

## Verification and delivery

Meaningful tests must cover all six GUI parameter mappings, source-kind filtering,
source order/reorder, units, custom revolve origin/vector, invalid/no-source states,
document reset/disconnect/removal, duplicate click, native error preserving draft,
post-commit refresh failure/read-only retry, and stale responses not updating undo,
mesh, selection or form status. Preserve existing availability and provider tests.

Parent runs actual hidden Electron UI creation after only sketch/datum fixture
seeding: rectangle extrusion, full/custom-axis revolution, ordered loft through two
planes, sewn authored walls/caps into a solid, signed cylinder offset and sweep.
Creation itself must use the visible form controls, not session creation calls,
internal test executors or direct CoreClient injection. Inspect actual native
parameters/area/volume/dependencies, one feature per creation, undo/redo, source
visibility and save/open. Verify panel bounds at 1600×1000 and 800×600; viewport
remains usable outside the panel, buttons/labels fit, no console/shader errors.

Native binary SHA256 stays
`642489abd0354158c7943fe5cda52aec1145bd76471a7f608bed730c4def9d13`.
No native or Quest rebuild needed for this Desktop-only increment. Parent packages
and updates the same installed Desktop/profile after the idle gate; saves program
and profile backups; verifies all package hashes and saved PC/device identity.

All product edits are Luna-only in explicit file ownership, with preimages/hashes.
No new dependencies, broad restore, foreground windows, headset actions, remote
Hermes/SSH/Tailscale/AI/STT/TTS calls or MCP bridge restart/bypass. Hermes image work
remains protected. No commit/push/CI/release claim. The full goal remains active
afterward: general trim/extend/thicken, remaining assemblies/direct editing,
live integration when permitted and physical Quest acceptance.
