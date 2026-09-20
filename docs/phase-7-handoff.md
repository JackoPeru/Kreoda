# Phase 7 → Phase 8 handoff

Phase 7 acceptance (§61) is green: the command bar parses deterministic
short commands offline, previews typed plans, and commits through the single
command path — including the acceptance shape "100×60×10 plate, four 6 mm
holes 8 mm from corners" as 5 editable features. Genuine prose without a
configured model gets an honest offline message, never a fake result.

## Verified Phase 7 results

- Local parser (`intent/parse.ts`): box/plate, cylinder/tube, sphere/ball,
  hole [blind], holes-corner pattern (1|4, through/blind), fillet, chamfer,
  set, undo, redo, view, help, export (honest Phase-8 pointer); units
  (mm/cm/m/in), word counts, usage errors per rule — 34 unit tests.
- Provider layer (`intent/provider.ts`): `IntentModelProvider` interface,
  structured selection+model context (never meshes, §28), `validatePlan`
  split by source (local shorthand vs LLM registry zod), `HttpLlmProvider`
  (OpenAI-compatible tools from COMMANDS, endpoint errors route to short
  syntax), `runPlan` with live-selection resolution + stop-at-first-failure.
- Corner holes expand client-side (top-face heuristic, face-frame mapping,
  bbox insets) into N typed `CreateHole` steps — one preview, N commits.
- CommandBar rewrite: parse → typed preview chips → Run/Cancel, Esc clears,
  NL → provider or honest message, ⚙ settings (endpoint/model persisted).
- `executeValidatedCommand`: validated dispatch for plan expansion with
  explicitly resolved context (fixes "Select a face first" on expanded
  holes — the plan resolves target/face itself).
- E2E `phase7-nl`: plate → 4 corner holes exact → prose fallback → front
  view asserted. 10/10 E2E green.

## Hard-won notes (do not regress)

- All previous notes still apply (see phase-6-handoff appendix).
- Plan steps needing selection must resolve context in the EXPANSION, not
  rely on the availability gate (which correctly rejects body-selected
  hole commands from direct UI calls).
- `getByRole(name)` substring-matches: `exact: true` for shared words;
  icon buttons need `aria-label`.
- Corner-hole features are INDEPENDENT (each cuts the plate, not chained)
  — 5 bodies for plate+4, each hole volume = plate − one cylinder.
- LLM plans are capped at 12 steps and zod-checked per field; the model
  never sees geometry, only ids + summaries (§28).

## Phase 8 entry (§61: professional hardening)

1. STEP import/export (OCCT `STEPControl`), 3MF via lib3mf, STL/OBJ/glTF.
2. Large-model optimization (progressive display, LOD policy enforcement).
3. Recovery journal + signed updater + license notices.
4. `flatc` codegen from `schemas/cad_protocol.fbs` (C++ + TS together).
5. Deferred: shell/mirror/patterns/loft/sweep, full assemblies.
