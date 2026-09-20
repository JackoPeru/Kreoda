// Kreoda Phase 8: flatc codegen (C++ + TypeScript together, §61).
// Generates FlatBuffers bindings from schemas/cad_protocol.fbs using the
// vcpkg flatc (fallback: flatc on PATH). Transport stays JSON until the
// migration slice — this only wires generation + parity checks.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const schema = join(repoRoot, "schemas", "cad_protocol.fbs");
const vcpkgFlatc =
  process.platform === "win32"
    ? join(
        repoRoot,
        "native",
        "kreoda-core",
        "vcpkg_installed",
        "x64-windows",
        "tools",
        "flatbuffers",
        "flatc.exe",
      )
    : join(
        repoRoot,
        "native",
        "kreoda-core",
        "vcpkg_installed",
        "x64-windows",
        "tools",
        "flatbuffers",
        "flatc",
      );

const flatc = existsSync(vcpkgFlatc) ? vcpkgFlatc : "flatc";
// NOTE: two output roots — on case-insensitive filesystems (Windows/macOS)
// flatc's `kreoda/` (TS) and `Kreoda/` (C#) namespaces collapse into one
// directory, so the passes must not share an out dir.
const outTs = mkdtempSync(join(tmpdir(), "kreoda-flatc-ts-"));
const outCs = mkdtempSync(join(tmpdir(), "kreoda-flatc-cs-"));

try {
  execFileSync(flatc, ["--version"], { stdio: "inherit" });
  execFileSync(flatc, ["--cpp", "--ts", "-o", outTs, schema], {
    stdio: "inherit",
  });
  execFileSync(flatc, ["--csharp", "-o", outCs, schema], {
    stdio: "inherit",
  });

  const cppSrc = join(outTs, "cad_protocol_generated.h");
  const cppDstDir = join(
    repoRoot,
    "native",
    "kreoda-core",
    "src",
    "protocol",
    "generated",
  );
  cpSync(cppSrc, join(cppDstDir, "cad_protocol_generated.h"), {
    force: true,
  });

  const tsSrc = join(outTs, "kreoda");
  const tsDstRoot = join(repoRoot, "packages", "protocol", "src", "generated");
  // Keep the "kreoda/" root: generated files import each other via
  // relative "../../kreoda/..." paths, so the folder name must survive.
  // Drop the pre-rename "intent-cad/" tree if it is still around.
  rmSync(join(tsDstRoot, "kreoda"), { recursive: true, force: true });
  rmSync(join(tsDstRoot, "intent-cad"), { recursive: true, force: true });
  cpSync(tsSrc, join(tsDstRoot, "kreoda"), { recursive: true });

  // C# bindings for the Quest/agent clients (§11.2): same schema source,
  // no hand-duplicated DTOs. Compiled by dotnet (see csharp/README).
  // flatc lays C# out as Kreoda/Protocol/*.cs (namespace folders).
  const csCandidates = [
    join(outCs, "Kreoda", "Protocol"),
    join(outCs, "kreoda", "protocol"),
  ];
  const csSrc = csCandidates.find((c) => existsSync(c));
  const csDstRoot = join(repoRoot, "packages", "protocol", "csharp");
  rmSync(join(csDstRoot, "Generated"), { recursive: true, force: true });
  if (csSrc) {
    cpSync(csSrc, join(csDstRoot, "Generated"), { recursive: true });
    // Runtime pin: vcpkg flatc (25.12.19) emits a ValidateVersion() guard
    // calling FlatBufferConstants.FLATBUFFERS_25_12_19(), but NuGet only
    // ships Google.FlatBuffers up to 25.2.10. The guard is a no-op minimum-
    // runtime assertion and the wire format is unchanged, so rewrite the
    // marker to the shipped runtime (a future flatc bump that changes the
    // marker fails the dotnet build loudly — the intended signal).
    for (const f of readdirSync(join(csDstRoot, "Generated"))) {
      if (!f.endsWith(".cs")) continue;
      const p = join(csDstRoot, "Generated", f);
      writeFileSync(
        p,
        readFileSync(p, "utf8").replaceAll(
          "FLATBUFFERS_25_12_19",
          "FLATBUFFERS_25_2_10",
        ),
      );
    }
  } else {
    throw new Error("flatc produced no C# output (checked Kreoda/, kreoda/)");
  }
  console.log(`flatc codegen ok:
  C++ -> native/kreoda-core/src/protocol/generated/cad_protocol_generated.h
  TS  -> packages/protocol/src/generated/
  C#  -> packages/protocol/csharp/Generated/`);
} finally {
  rmSync(outTs, { recursive: true, force: true });
  rmSync(outCs, { recursive: true, force: true });
}
