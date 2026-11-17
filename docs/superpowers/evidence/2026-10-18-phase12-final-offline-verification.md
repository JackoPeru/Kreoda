# Phase 12 — final offline verification (2026-10-18)

Scope: current sources only, read before/after Roslyn; Unity Editor licence unavailable, Editor and APK not launched.

- `Kreoda.QuestRuntime`: Roslyn exit 0, zero errors.
- `Kreoda.QuestEditor`: Roslyn exit 0, zero errors; sole unrelated `CS0618` in `QuestBuild.cs:54` (`focusAware`).
- Both used current Unity Bee `.rsp` copied to `%TEMP%/kreoda-phase12-audit-current`; outputs also temporary.
- Static structural preflight PASS: Home + 12 secondary capture mappings (13 PNG filenames), 12 `ExpectedActions`/`SemanticZone` layouts, 103 expected runtime actions from 100 source call sites + 3 PC-loop expansions, 12 live readouts. `AuthoredRows` occurrences: 0.
- Preflight intentionally stopped at nonexistent Unity paths after static checks. This is not a completed screenshot run: 13 *capture definitions* verified, **no new screenshots or manifest generated**, no visual/collider accuracy claimed.

## Current SHA-256 (unchanged before/after both compilations)

| Source | SHA-256 |
| --- | --- |
| QuestControls.cs | `115210006EDE9F81957D261FE4A6F7CA591C5A3B150CC230565EAB60FFD5A628` |
| QuestUi.cs | `45E33617B4217B4E6D4A6725379AF8883C48202DF64BAA3F747945AF63F84DD3` |
| QuestHome.cs | `61B4B2E1D02E50EC133D3B3AFD66D46A131B7578DBC4AC95961B034AB97B73DA` |
| QuestConnection.cs | `B69801D1F2A33E1B31D0FEC78D2F0640597D7DF5F03F1ACEAE03011D9CB17B0C` |
| QuestUi.shader | `548A25D1DF83B701F9629F2D0ED2362E26008FEE4CB3E16EBDF61B34C0EAFF61` |
| QuestHomeRender.cs | `A2A39C5A091E9617854C352539614107AFFFE334C5C93918A30E3F275BE6EFB3` |
## Subsequent current-source geometry and compile validation

- 13 source-mapped captures (Home +12) structurally PASS; no new render images captured.
- 37 static panel AABBs: 0 beyond [-0.21,+0.21] x [-0.32,+0.22] m, **17 non-modal intersections**; alternative reference modalities excluded under source visibility contract. They are surface AABB overlaps, not verified runtime collider/render overlaps.
- Final current Roslyn Runtime PASS and Editor PASS, zero errors; unrelated QuestBuild.cs:54 CS0618 only. Bee response files and compiler outputs isolated in TEMP.
- QuestControls SHA256 EB4B9D3B075132C49E96001870C01C0EAA4D663864532519AA3E915C1AF4FC90; QuestUi E402D9D98CBB183885EB19FF6ECB568AE9F2B4225642A7ED4277BD0D01CC6D61; QuestHome 0AAB0ADCE7CFB39309B3ABA76C76CCCB1133C0683014B48459723B23F568E1C9; QuestConnection B69801D1F2A33E1B31D0FEC78D2F0640597D7DF5F03F1ACEAE03011D9CB17B0C. All stable before/after this compile.
- No Unity Editor (license inactive), no APK. No actual visual claim.
