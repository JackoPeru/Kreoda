# Fresh accumulated review: fix first

Candidate29fe5036950e2b973887c1fcf860c95b852da0f5; accumulated scope e4edeea747296adba3407ff19ad63535669e50a1..candidate.

Actual GPT-6-Sol/high reviewer /root/review_projection_public_wire_final, thread01a143ea-a8b2-7432-a4b3-07bf6d90c866, turn01a143ea-a92f-7972-abb0-1a9b16ad2729 completed with **fix-first**. It did not accept the candidate. Parent checked all217 frozen files unchanged and HEAD/clean tree unchanged after review. Host permissions did not enforce read-only; the requested behavioral restriction and before/after audit were used.

1. Set/Remove resolve all groups with allowBroken=false. A loaded sketch with two broken groups cannot repair or remove one while the other remains broken. Existing persistence proof covers one broken group, so all279 green native cases did not prove this scenario. A safe repair path with downstream geometry is required.
2. Native source identifiers are bounded to512 UTF-8 bytes; generated source/nested result validation only enforces512 characters. Multibyte IDs can pass those public validators and fail native validation. Exported source, nested summary/result and generated validation must enforce byte limits consistently.

Review ran no tests/builds and made no edits. Local279/142/54/14 gates remain true but do not close these findings. The next correction plan is 2026-10-16-projection-repair-schema-correction.md. Full Phases12-16, runtime/UI/Quest, hosted and physical/live gates remain open.
