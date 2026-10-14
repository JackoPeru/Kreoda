# Independent accumulated packet review

Reviewer: separate Codex task 01a139d0-f177-7550-a22e-fdc7a4f169b9; runtime verified GPT-6-Sol/High, approval never, unrestricted filesystem. Behavioral read-only requested and no source edits observed. This was not filesystem-enforced isolation.

Immutable range: fa78baf2ed3b18f690a1a921af6b9dabd7148af3..5b01f7521eacb9e30afb32b7d643fdfe54ea49d4.

Verdict: **fix-first**, not accepted.

1. **P1: native/schema inconsistency.** The native datum resolver accepts and persists extra definition/reference keys that the canonical strict typed schemas reject. A successful native mutation can then fail session/renderer parsing. Reject noncanonical keys before beginning a mutation, including nested source refs; preserve valid persisted selectionEntry.
2. **P2: invalid incoming sketch support.** Persistence can accept a Datum sketch with absent or wrong-kind support, particularly when no Datums root exists. Require an incoming actual DatumPlane before replacing current state; never resolve to a same-ID live datum. Also verify saved supported frame agreement in incoming persistence, without rejecting legitimate pre-rebuild UpdateDatum staging.

Corrections assigned to the existing verified GPT-6-Luna/Max implementer. Required evidence: behavioral RED/GREEN native command atomicity, real invalid .icad fixtures preserving current B-Rep/registry/revision/Undo, valid supported edits and reopen. Parent must repeat native gates and obtain a new fresh immutable review after correction. The old verdict cannot accept changed source.

Quest integration, actual MCP-to-native datum mutation, current-head hosted CI, live Hermes and physical headset acceptance remain open. No merge or release.
