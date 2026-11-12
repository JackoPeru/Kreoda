# Minimum thickness analysis implementation plan

> **For agentic workers:** Use superpowers:executing-plans task by task. The requested Luna/Max lane failed with a usage limit; the user authorizes parent fallback.

**Goal:** Deliver non-mutating B-Rep wall-thickness analysis to Desktop, Quest and canonical agent queries.
**Architecture:** Sample exact trimmed face UVs, cast inward surface-normal rays and measure the first material exit in the same solid. Report the smallest observed thickness, world-space witness points and explicit sampling/coverage limits. This is a sampled directional analysis, never a certified global minimum or manufacturing pass.
**Tech Stack:** Existing C++/OCCT, JSON session contract, TypeScript/React, Unity/C#.
**Spec:** Roadmap section 15.6; existing units, authoritative native geometry and controller-free Quest constraints.

## Global constraints

- Preserve all concurrent dirty work and existing Home, passthrough, auto pairing and hand controls.
- No Hermes/SSH/Tailscale/inference/STT/TTS calls or remote restarts.
- Native geometry, revision, history and persistence do not change.
- Sample budget 32–4096; bounded traversal, explicit missed/unmeasured coverage. Unknown is never zero.
- General valid closed solids, cavities, transformed/imported curved faces; measure each solid separately so air gaps are not thickness.
- Reuse the established read-only session query path; no new geometry command, dependency or mesh protocol field.
- No fresh independent review or physical headset acceptance claim. Keep full Phases 12–16 goal active.

## Review focus

- Thin/cavity walls must stop at the first exit, not an opposite outer boundary.
- Trimmed UV regions, singular normals, tangent intersections and incomplete coverage must remain explicit.
- Rigid transformations must affect witness points and preserve measured lengths.
- Client results must be invalidated on selection/document/revision changes and failed queries.
- No new Quest overlap, tiny text or controller requirement.

### Task 1 — Authoritative measurement and contract

Files: new `native/kreoda-core/src/analysis/minimum_thickness.h`; existing session geometry query and its tests; session-control schema and canonical generated metadata.

- [x] Write/run RED native cases: known box, hollow curved solid, transformed solid, disconnected compound, invalid/open geometry and invalid budgets; verify unchanged document state.
- [x] Implement bounded exact-surface normal rays, first material exit, nullable result and coverage.
- [x] Add `measureMinimumThickness` to the canonical read-only contract and regenerate/check bindings; run focused native and protocol/managed checks.

### Task 2 — Desktop and Quest access

Files: Desktop coreClient, new thickness analysis panel and WorkspaceChrome; QuestControls and a small validated result formatter, focused existing/new UI tests.

- [x] Add RED tests for actual result formatting, error/unknown coverage and stale-response rejection.
- [x] Add explicit Desktop calculation for selected body/feature and clear sampled-result labels/witness coordinates.
- [x] Add the equivalent Quest action in the existing inspection layout, preserving hand input and readable layout.
- [x] Run affected client tests, hidden Electron/native proof and actual Unity renders/layout checks.

### Task 3 — Build, install and evidence

- [x] Run required broader native/client regression gates based on changed runtime paths.
- [x] Guarded Desktop package and normal ARM64 build; preserve original PC/Quest identity/configuration.
- [x] Install owned local targets hidden; verify installed hashes and actual native/MCP query without contacting Hermes.
- [x] Record evidence and remaining physical/whole-roadmap gates. No commit/push unless separately requested.

## Runtime-discovered dependency correction

The installed MCP proof initially failed before opening a transaction: the real
`DefineAssemblyConstraint` command uses a valid object `anyOf`, while the agent
catalog required root `type: object`. Preserve the original union schema and
accept bounded object-only `anyOf`/`oneOf` alternatives. Scalar/empty/malformed
unions remain rejected; validation and creation metadata stay authoritative.
Seven regression cases, complete affected managed suites, final publication and
actual native MCP create/query/cancel proof are complete. This correction is
in the separate bridge, outside the Desktop/Quest package inputs.
