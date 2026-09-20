// Phase 10 (§10.1): run the built native test binary, cross-platform.
// Windows: native/kreoda-core/build/tests/Release/kreoda-core-tests.exe
// (MSVC layout). Other platforms: build/tests/kreoda-core-tests. Fails
// honestly when the binary is missing (build it first: scripts/build-core).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const candidates =
  process.platform === "win32"
    ? [
        join(
          repoRoot,
          "native",
          "kreoda-core",
          "build",
          "tests",
          "Release",
          "kreoda-core-tests.exe",
        ),
      ]
    : [
        join(
          repoRoot,
          "native",
          "kreoda-core",
          "build",
          "tests",
          "kreoda-core-tests",
        ),
      ];
const exe = candidates.find((c) => existsSync(c));
if (!exe) {
  console.error(
    `native tests not built (looked for ${candidates.join(", ")}) — run scripts/build-core first`,
  );
  process.exit(1);
}
execFileSync(exe, ["--gtest_brief=1"], { stdio: "inherit" });
