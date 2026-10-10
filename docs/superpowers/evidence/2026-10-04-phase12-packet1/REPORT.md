# Phase 12 Packet 1 evidence

Scope: shared managed client compatibility only. Packets 2–5 and headset acceptance remain open.

## Changes

- `Kreoda.Protocol`, `Kreoda.SessionClient`, and `Kreoda.QuestFoundation` target `net8.0` and `netstandard2.1`.
- The Unity target supplies the `IsExternalInit` polyfill and a cancellation-safe `Task.WaitAsync` shim. Session capabilities are exposed through a read-only collection.
- `System.Text.Json` is pinned at 8.0.6 for `netstandard2.1`; `Google.FlatBuffers` remains pinned at 25.2.10. The resolved graph had no known vulnerable packages according to the configured NuGet sources on 2026-10-04. NuGet reports newer major versions; this packet retains the graph exercised by the Unity compatibility build.
- The staging script derives dependency DLLs from MSBuild target paths and `project.assets.json`, checks the pinned versions, generates deterministic Unity importer metadata, omits Unity-provided BCL assemblies, and writes SHA-256 entries. `link.xml` preserves generated DTOs and their JSON converters.
- No generated DTO or schema files changed.

## Verification

- Initial compatibility failures are captured in `red-session-netstandard2.1.txt`, `red-foundation-netstandard2.1.txt`, and `red-managed-compatibility-tests.txt`.
- `pnpm test:dotnet`: 40/40 passed on .NET 8. `tests-netstandard-compat.txt`: 40/40 passed with the test project loading the `netstandard2.1` session-client assembly. The four focused compatibility tests passed for both targets; the framework-attribute assertion confirms the selected assembly target.
- `pnpm check:session-contract`: passed; five artifacts and 24 DTO schemas verified, with no generated output changes.
- Release builds of all three libraries succeeded for `net8.0` and `netstandard2.1`, with zero warnings and errors (`finalbuild-*.txt`).
- `node --check scripts/build-quest-managed.mjs` and `git diff --check` passed.
- `build-quest-managed.mjs` staged eight DLLs and four Unity-provided BCL exclusions. A second fresh staging run produced a byte-identical manifest. The staged manifest SHA-256 is `a431aa8c65ddb21896eedb58f79284f0fa2ef4ab62eda26313b859bbfc927647`.
- The hidden Unity 6000.3.25f1 Editor fixture loaded the staged DLLs, checked Editor and Android ARM64 importer settings, verified generated-type linker preservation, and ran product-derived snapshot parsing, JSON control serialization, and Quest display-transform checks. Android ARM64 IL2CPP Development build succeeded with zero errors.
- APK: `ManagedCompatibility.apk`, 25,635,239 bytes, SHA-256 `4fc4364e23ef3fe0ac23f73c7145b7b8dae35d24c3bdb5699b1c60e63ba76bd4`. ZIP inspection found native libraries only under `lib/arm64-v8a`. The Unity build report separately records `summary.totalSize=221958908`; that aggregate is not the APK file length.
- Unity result JSON SHA-256: `5519d5f718dc90efc12c2f4ece3b82d4c0a42353fc29aa2b44c82f6bef1c6ad4`. Editor log SHA-256: `e6c099c67511920895d91b8f0890bb992af033a80fad91c5db654b05510468d1`.

## Evidence boundary

The Unity fixture is a minimal, product-derived compatibility scene in `C:\Users\matte\Documents\Codex-tools\Unity\QA\KreodaPhase12Packet1Product-20261004-8e5d711b1e0242b8bf84eae4c015d51a`. Its staged manifest and raw Editor outputs remain there. The fixture proves managed assembly import, product-derived JSON/session/Foundation execution in the Editor, and ARM64 IL2CPP compilation. It does not prove the full CAD client, network mesh delivery, headset installation, or Quest hardware runtime.

The prior hidden Unity Editor build ended with process exit 0. The built APK was re-hashed independently, its staged DLLs were checked against the manifest, and its ABI entries were inspected from the APK ZIP.
