// Complete isolated crash gate; never leave a test-enabled core ready to ship.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const source = join(repo, "native", "kreoda-core");
const build = join(source, "build");
const cache = readFileSync(join(build, "CMakeCache.txt"), "utf8");
const pnpm = process.env.npm_execpath;
if (!pnpm || !existsSync(pnpm)) {
  throw new Error("Run this gate through pnpm test:e2e:crash:full.");
}
if (!/^WITH_OCCT:BOOL=ON$/m.test(cache) ||
    !/^KREODA_ALLOW_STUB_CORE:BOOL=OFF$/m.test(cache) ||
    !/^KREODA_CRASH_TEST_BARRIERS:BOOL=OFF$/m.test(cache)) {
  throw new Error("Crash gate requires a configured real production core with barriers OFF.");
}

function run(executable, args, env = process.env) {
  const result = spawnSync(executable, args, {
    cwd: repo, env, stdio: "inherit", windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${executable} failed: ${result.error?.message ?? result.status ?? result.signal}`);
  }
}

function configure(enabled) {
  run("cmake", ["-S", source, "-B", build, `-DKREODA_CRASH_TEST_BARRIERS=${enabled}`]);
  run("cmake", ["--build", build, "--config", "Release", "--target",
    "kreoda-core", "kreoda-solver-crash-control"]);
  run("ctest", ["--test-dir", build, "-C", "Release", "--output-on-failure", "--no-tests=error",
    "-R", "^SolverCrashBarrierControl$"]);
}

let passed = false;
let restored = false;
try {
  configure("ON");
  run(process.execPath, [pnpm, "test:e2e:crash"], {
    ...process.env, KREODA_CRASH_TEST_BARRIERS: "1",
  });
  passed = true;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  try {
    configure("OFF");
    restored = true;
  } catch (error) {
    console.error("Production core restoration failed:", error);
    process.exitCode = 1;
  }
  console.log(`PHASE10_CRASH_GATE ${JSON.stringify({ passed, production_core_restored: restored })}`);
}
