// dotnet test can exit 0 after discovering zero tests (for example, when
// Windows Code Integrity blocks the test assembly). Check its TRX result.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const results = mkdtempSync(join(tmpdir(), "kreoda-dotnet-"));
const trx = join(results, "kreoda-session.trx");
let total = 0;
let failed = 0;
let status = 1;
try {
  const run = spawnSync("dotnet", [
    "test", join(repo, "clients/session-dotnet/Kreoda.Session.sln"),
    "-c", "Release", "-p:Platform=Any CPU",
    "--logger", "trx;LogFileName=kreoda-session.trx",
    "--results-directory", results,
  ], { stdio: "inherit" });
  status = run.status ?? 1;
  if (status === 0) {
    const counters = readFileSync(trx, "utf8").match(/<Counters\b[^>]*>/)?.[0] ?? "";
    total = Number(counters.match(/\btotal="(\d+)"/)?.[1] ?? 0);
    failed = Number(counters.match(/\bfailed="(\d+)"/)?.[1] ?? 0);
  }
} finally {
  rmSync(trx, { force: true });
  rmdirSync(results);
}
if (status !== 0 || total < 21 || failed !== 0) {
  console.error(`.NET tests failed or missing: exit=${status}, total=${total}, failed=${failed}`);
  process.exit(1);
}
