// Kreoda Phase 8: flatc codegen (C++ + TypeScript together, §61).
// Generates FlatBuffers bindings from schemas/cad_protocol.fbs using the
// vcpkg flatc (fallback: flatc on PATH). Transport stays JSON until the
// migration slice — this only wires generation + parity checks.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const schema = join(repoRoot, "schemas", "cad_protocol.fbs");
const vcpkgFlatc =
  process.platform === "win32"
    ? join(
        repoRoot,
        "native",
        "cad-core",
        "vcpkg_installed",
        "x64-windows",
        "tools",
        "flatbuffers",
        "flatc.exe",
      )
    : join(
        repoRoot,
        "native",
        "cad-core",
        "vcpkg_installed",
        "x64-windows",
        "tools",
        "flatbuffers",
        "flatc",
      );

const flatc = existsSync(vcpkgFlatc) ? vcpkgFlatc : "flatc";
const outDir = mkdtempSync(join(tmpdir(), "kreoda-flatc-"));

try {
  execFileSync(flatc, ["--version"], { stdio: "inherit" });
  execFileSync(flatc, ["--cpp", "--ts", "-o", outDir, schema], {
    stdio: "inherit",
  });

  const cppSrc = join(outDir, "cad_protocol_generated.h");
  const cppDstDir = join(
    repoRoot,
    "native",
    "cad-core",
    "src",
    "protocol",
    "generated",
  );
  cpSync(cppSrc, join(cppDstDir, "cad_protocol_generated.h"), {
    force: true,
  });

  const tsSrc = join(outDir, "kreoda");
  const tsDstRoot = join(repoRoot, "packages", "protocol", "src", "generated");
  // Keep the "kreoda/" root: generated files import each other via
  // relative "../../kreoda/..." paths, so the folder name must survive.
  // Drop the pre-rename "intent-cad/" tree if it is still around.
  rmSync(join(tsDstRoot, "kreoda"), { recursive: true, force: true });
  rmSync(join(tsDstRoot, "intent-cad"), { recursive: true, force: true });
  cpSync(tsSrc, join(tsDstRoot, "kreoda"), { recursive: true });
  console.log(`flatc codegen ok:
  C++ -> native/cad-core/src/protocol/generated/cad_protocol_generated.h
  TS  -> packages/protocol/src/generated/`);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
