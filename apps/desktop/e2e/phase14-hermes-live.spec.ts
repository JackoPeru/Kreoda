import { test, expect, _electron as electron } from "@playwright/test";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAIN, HERE, hideForBackgroundE2E } from "./helpers";

type LiveResult = {
  fixtureId: string;
  geometryPassed: boolean;
  durationSeconds?: number;
  error?: string | null;
  failedPredicates?: string[];
  runId?: string | null;
  metadata?: unknown;
  metadataError?: string | null;
};

const voiceConfigPath = process.env.KREODA_LIVE_VOICE_CONFIG;
const hermesConfigPath = process.env.KREODA_LIVE_HERMES_CONFIG;
const onlyFixture = process.env.KREODA_LIVE_FIXTURE;
const strict = process.env.KREODA_LIVE_STRICT === "1";

const requirementsPath = path.resolve(HERE, "../../../docs/superpowers/benchmarks/phase14-requirements.json");
const fixtureIds = (JSON.parse(readFileSync(requirementsPath, "utf8")) as { fixtures: { id: string }[] })
  .fixtures.map(fixture => fixture.id)
  .filter(id => !onlyFixture || id === onlyFixture);

test.skip(!voiceConfigPath || !hermesConfigPath, "KREODA_LIVE_VOICE_CONFIG and KREODA_LIVE_HERMES_CONFIG are required");
test.setTimeout(1_800_000);

test("live Hermes benchmark against the isolated app session and remote gateway", async ({}, info) => {
  expect(fixtureIds.length).toBeGreaterThan(0);
  const results: LiveResult[] = [];
  for (const [index, fixtureId] of fixtureIds.entries()) {
    const profile = mkdtempSync(path.join(os.tmpdir(), `kreoda-live-hermes-${index}-`));
    const sessionPort = 45000 + index * 2;
    const bridgePort = sessionPort + 1;
    const voiceToken = `live-benchmark-${index}-voice-token`;
    const bridgeDll = path.resolve(HERE, "../../../clients/session-dotnet/tools/Kreoda.HermesBridge/bin/Release/net8.0/Kreoda.HermesBridge.dll");
    const runnerDll = path.resolve(HERE, "../../../clients/session-dotnet/tools/Kreoda.ModelingAgent.Benchmark/bin/Release/net8.0/Kreoda.ModelingAgent.Benchmark.dll");
    const voiceConfig = path.join(profile, "voice.json");
    const reportPath = path.join(profile, `${fixtureId}.json`);
    let bridge: ReturnType<typeof spawn> | undefined;
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
    try {
      app = await electron.launch({
        executablePath: createRequire(import.meta.url)("electron") as string,
        args: [MAIN, "--no-sandbox", "--lang=en-US", `--user-data-dir=${profile}`],
        env: { ...process.env, KREODA_SESSION_PORT: "", KREODA_SESSION_TOKEN: "", KREODA_RECOVERY_DIR: profile },
      });
      const page = await app.firstWindow();
      await hideForBackgroundE2E(app);
      await expect.poll(() => page.evaluate(() => window.kreoda.coreInfo().then(info => info.running))).toBe(true);
      await page.evaluate(port => window.kreoda.sessionEnable("127.0.0.1", port), sessionPort);
      const pairing = await page.evaluate(() => window.kreoda.sessionPair());
      bridge = spawn("dotnet", [bridgeDll], {
        windowsHide: true,
        env: {
          ...process.env,
          KREODA_HERMES_BRIDGE_URL: `http://127.0.0.1:${bridgePort}`,
          KREODA_CAD_SESSION_URL: `ws://127.0.0.1:${sessionPort}/`,
          KREODA_CAD_PAIR: pairing.token,
          KREODA_CAD_DEVICE_FILE: path.join(profile, "cad-device.json"),
          KREODA_HERMES_CONFIG: hermesConfigPath!,
          KREODA_VOICE_TOKEN: voiceToken,
        },
      });
      await expect.poll(async () => {
        try { return (await fetch(`http://127.0.0.1:${bridgePort}/health`)).ok; } catch { return false; }
      }, { timeout: 20000 }).toBe(true);
      writeFileSync(voiceConfig, JSON.stringify({ endpoint: `http://127.0.0.1:${bridgePort}`, token: voiceToken }));

      const child = spawn("dotnet", [runnerDll, requirementsPath, fixtureId, reportPath], {
        windowsHide: true,
        env: {
          ...process.env,
          KREODA_BENCHMARK_MCP_URL: `http://127.0.0.1:${bridgePort}/mcp`,
          KREODA_BENCHMARK_VOICE_CONFIG: voiceConfig,
          KREODA_BENCHMARK_HERMES_CONFIG: hermesConfigPath!,
        },
      });
      let stdout = "", stderr = "";
      child.stdout.on("data", bytes => { stdout += String(bytes); });
      child.stderr.on("data", bytes => { stderr += String(bytes); });
      const code = await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => { child.kill(); reject(new Error(`live fixture ${fixtureId} timed out`)); }, 660_000);
        child.once("error", error => { clearTimeout(timer); reject(error); });
        child.once("exit", status => { clearTimeout(timer); resolve(status); });
      });
      if (!existsSync(reportPath)) throw new Error(`live fixture ${fixtureId} produced no report (exit ${code}): ${stderr || stdout}`);
      const report = JSON.parse(readFileSync(reportPath, "utf8")) as LiveResult;
      results.push({ ...report, fixtureId });
    } finally {
      bridge?.kill();
      await app?.close().catch(() => {});
      // Keep the report in the evidence directory, not in the transient profile.
    }
  }
  const passed = results.filter(result => result.geometryPassed).length;
  const summary = {
    fixtures: results.map(result => ({
      fixtureId: result.fixtureId,
      geometryPassed: result.geometryPassed,
      durationSeconds: result.durationSeconds,
      error: result.error,
      failedPredicates: result.failedPredicates,
      runId: result.runId,
      metadata: result.metadata,
      metadataError: result.metadataError,
    })),
    geometryPassed: passed,
    total: results.length,
    strict,
  };
  console.log("LIVE_HERMES_BENCHMARK " + JSON.stringify(summary));
  const evidence = path.join(HERE, "..", "test-results", "live-hermes-benchmark.json");
  writeFileSync(evidence, JSON.stringify(summary, null, 2) + "\n");
  await info.attach("live-hermes-benchmark", { path: evidence, contentType: "application/json" });
  if (strict) expect(passed, "live Hermes must pass at least 6 of 7 fixtures").toBeGreaterThanOrEqual(6);
  else expect(results).toHaveLength(fixtureIds.length);
});
