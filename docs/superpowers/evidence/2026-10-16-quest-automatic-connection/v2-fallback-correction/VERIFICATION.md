# Version2 saved-endpoint fallback correction

Fresh corrected review of70e3550 returned fix-first: with a known version2 PC missing from discovery, a foreign PC response prevented the still-working saved WebSocket endpoint from reconnecting. Parent85-file review guard remained unchanged. The previous identity fix and its evidence remain valid, but this acceptance defect required another correction.

QuestConnection now keeps the original valid saved endpoint available when discovery has only unrelated peers. It never replaces that endpoint or sends credentials to the foreign discovered socket. An address explicitly advertised but rejected during identity verification cannot downgrade to credential authentication at that same address.

All13 actual QuestConnection Editor cases pass, including legacy foreign-PC rejection, known-PC automatic trust upgrade and a new version2 saved connection with a foreign responder. The new case confirms actual mesh re-upload/reconnection, zero foreign WebSocket messages, preserved saved endpoint and preserved stable PC ID. No controller/headset/server/foreground operation.

Normal saved-scene ARM64 rebuild succeeded, direct exit0,0errors. APK SHA2563f327c88bbf6354f21ac8e7fd54d55d64e6150b7a8635618c5ae37a204b493e2 at C:/Users/matte/Documents/Codex-tools/Native/quest-autoconnect-parent-20261016/arm64-v2-fallback/KreodaQuest.apk. ZIP native libraries are exclusively arm64-v8a. Quest/managed/protocol/build inputs remained unchanged during build; one concurrently edited Desktop projection test is explicitly outside APK input scope and listed in scoped-inspection.json. The repository as a whole was not immutable.

Fresh accumulated review remains open. Earlier Desktop16 and actual Electron/native/managed identity E2E1 continue to cover unchanged PC/C# product code. Physical LAN/firewall/headset/hands/voice and all full-goal requirements remain open; no merge/release/completion claim.
