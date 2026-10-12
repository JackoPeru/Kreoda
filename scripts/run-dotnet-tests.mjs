// dotnet test can exit 0 after discovering zero tests (for example, when
// Windows Code Integrity blocks the test assembly). Check its TRX result.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const results = mkdtempSync(join(tmpdir(), "kreoda-dotnet-"));
const solution = join(repo, "clients/session-dotnet/Kreoda.Session.sln");
const suites = [
  { name: "SessionClient", project: "tests/Kreoda.SessionClient.Tests/Kreoda.SessionClient.Tests.csproj", minimum: 125 },
  { name: "ModelingAgent", project: "tests/Kreoda.ModelingAgent.Tests/Kreoda.ModelingAgent.Tests.csproj", minimum: 33 },
  { name: "HermesBridge", project: "tests/Kreoda.HermesBridge.Tests/Kreoda.HermesBridge.Tests.csproj", minimum: 27 },
  { name: "ModelingBenchmark", project: "tests/Kreoda.ModelingAgent.Benchmark.Tests/Kreoda.ModelingAgent.Benchmark.Tests.csproj", minimum: 29 },
];
let total = 0;
let failed = 0;
const failures = [];

function readCounters(path) {
  let trx;
  try {
    trx = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const counters = trx.match(/<Counters\b[^>]*>/)?.[0];
  if (!counters) return null;
  return Object.fromEntries(["total", "passed", "failed", "notExecuted"].map((name) => [
    name,
    Number(counters.match(new RegExp(`\\b${name}="(\\d+)"`))?.[1] ?? 0),
  ]));
}

function runDotnet(args) {
  const run = spawnSync("dotnet", args, { stdio: "inherit" });
  return run.status ?? 1;
}

try {
  const buildStatus = runDotnet([
    "build", solution,
    "-c", "Release", "-p:Platform=Any CPU",
  ]);
  if (buildStatus !== 0) {
    failures.push(`solution build exit=${buildStatus}`);
  } else {
    for (const output of [
      "tools/Kreoda.HermesBridge/bin/Release/net8.0/Kreoda.HermesBridge.dll",
      "probes/Kreoda.McpProbe/bin/Release/net8.0/Kreoda.McpProbe.dll",
      "tools/Kreoda.ModelingAgent.Benchmark/bin/Release/net8.0/Kreoda.ModelingAgent.Benchmark.dll",
    ]) {
      if (!existsSync(join(repo, "clients/session-dotnet", output))) failures.push(`missing build output: ${output}`);
    }
    for (const suite of suites) {
      const trx = join(results, `${suite.name}.trx`);
      const status = runDotnet([
        "test", join(repo, "clients/session-dotnet", suite.project),
        "-c", "Release", "-p:Platform=AnyCPU", "--no-build",
        "--logger", `trx;LogFileName=${suite.name}.trx`,
        "--results-directory", results,
      ]);
      const counters = readCounters(trx);
      if (!counters) {
        failures.push(`${suite.name}: missing or invalid TRX`);
        continue;
      }
      total += counters.total;
      failed += counters.failed;
      console.log(`${suite.name}: total=${counters.total}, passed=${counters.passed}, failed=${counters.failed}, notExecuted=${counters.notExecuted}`);
      if (status !== 0) failures.push(`${suite.name}: dotnet test exit=${status}`);
      if (counters.total < suite.minimum) failures.push(`${suite.name}: discovered ${counters.total}, expected at least ${suite.minimum}`);
      if (counters.passed !== counters.total || counters.failed !== 0 || counters.notExecuted !== 0) {
        failures.push(`${suite.name}: total=${counters.total}, passed=${counters.passed}, failed=${counters.failed}, notExecuted=${counters.notExecuted}`);
      }
    }
  }
} finally {
  rmSync(results, { recursive: true, force: true });
}
if (failures.length || total < 214 || failed !== 0) {
  console.error(`.NET tests failed or missing: total=${total}, failed=${failed}; ${failures.join("; ")}`);
  process.exit(1);
}
console.log(`.NET tests passed: SessionClient=125+, ModelingAgent=33+, HermesBridge=27+, ModelingBenchmark=29+, total=${total}, failed=${failed}`);
