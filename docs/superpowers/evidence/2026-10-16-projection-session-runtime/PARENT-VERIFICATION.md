# Independent parent verification

Candidate is the completed runtime working tree based on e71ff5dc53da79a0ed582d267cbeb81aa4cd00d1, before the following evidence-only packaging. The separate runtime worker01a14525-18cd-7c62-98ca-173d0e064fd5 completed its turn; parent reran the actual gates independently.

- Protocol57, canonical15, Desktop295 and managed255 (153/34/35/33) cases passed, with no failures/skips. Prior protocol/canonical/managed occurrences were retained; the explicitly documented FourMiB-to64MiB contract test rename is mapped once.
- All11 required managed projection/state/delta/transport regressions were discovered, including late replies, same-ID document/restart cases, latest versus stale query failure cleanup, never-reused request tokens across Clear, Unicode and exact definition-byte bounds.
- Deterministic generation, protocol/canonical/Desktop build and lint, and full .NET Release solution build passed.
- One independently rerun hidden Electron/official MCP/real OCCT E2E passed: source edit changes analytic volume with same IDs, owner rollback, actual dropped commit acknowledgement/replay, healthy/broken .icad reopen, same-ID explicit repair and Undo restoring broken state. No GUI capture or live server/device operation.
- All445 runtime/dependency source hashes unchanged through this independent gate. Concurrent Unity UI sources are explicitly excluded and owned by another selected worker; this gate does not validate the new Quest UI or an integrated APK.
- Native product sources remain at the previously verified e71ff candidate. Runtime staging manifest verifies the matching exe and44app-local DLLs, with restricted-PATH self-test success.

Raw parent sources remain at C:/Users/matte/Documents/Codex-tools/Native/phase15-session-runtime-parent-20261016. Archived log/XML/TRX text is normalized only as recorded in parent-provenance.json; the actual .icad archives are byte-for-byte copies. Original raw files are retained. Source manifests describe verification-working-tree bytes; Git index EOL normalization is separate from product behavior.

Fresh accumulated final review and exact accepted-head hosted CI remain open. All Desktop/Quest projection interactions, new passthrough Home and automatic local PC connection, outstanding advanced CAD/intent work and physical/live acceptance remain part of the full goal. No merge/release/full-goal completion claim.
