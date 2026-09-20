# Kreoda.Protocol (C#)

C# bindings for the Quest spatial client (Unity) and future agent clients,
generated from the single protocol source of truth
(`schemas/cad_protocol.fbs`, roadmap §11.2).

- `Generated/` — flatc output. Never hand-edit; regenerate with
  `pnpm --filter @kreoda/protocol run codegen`.
- Build check: `dotnet build packages/protocol/csharp` (needs NuGet
  access for `Google.FlatBuffers` on first restore).
