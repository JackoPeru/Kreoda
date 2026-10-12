import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAIN, HERE, runBar, snapOf } from "./helpers";

test("benchmark records unavailable Hermes and refuses occupied native document", async () => {
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-benchmark-boundary-"));
  const app = await electron.launch({ executablePath: createRequire(import.meta.url)("electron") as string,
    args: [MAIN, "--no-sandbox", "--lang=en-US", `--user-data-dir=${profile}`],
    env: { ...process.env, KREODA_SESSION_PORT: "", KREODA_SESSION_TOKEN: "", KREODA_RECOVERY_DIR: profile } });
  let bridge: ReturnType<typeof spawn> | undefined;
  const sessionRoot = path.resolve(HERE, "../../../clients/session-dotnet");
  async function child(dll: string, args: string[], env: NodeJS.ProcessEnv) {
    return await new Promise<{ code: number | null; out: string; errors: string }>((resolve, reject) => {
      const process = spawn("dotnet", [path.join(sessionRoot, dll), ...args], { windowsHide: true, env });
      let out = "", errors = "";
      process.stdout.on("data", b => out += String(b));process.stderr.on("data", b => errors += String(b));
      const timeout = setTimeout(() => { process.kill();reject(new Error("benchmark boundary probe timed out")); }, 45000);
      process.once("error", error => { clearTimeout(timeout);reject(error); });
      process.once("exit", code => { clearTimeout(timeout);resolve({ code, out, errors }); });
    });
  }
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.hide()));
    await expect.poll(() => page.evaluate(() => globalThis.window.kreoda.coreInfo().then(i => i.running))).toBe(true);
    await page.evaluate(() => globalThis.window.kreoda.sessionEnable("127.0.0.1", 44744));
    const pairing = await page.evaluate(() => globalThis.window.kreoda.sessionPair());
    const token = "benchmark-test-only-voice-token";
    bridge = spawn("dotnet", [path.join(sessionRoot, "tools/Kreoda.HermesBridge/bin/Release/net8.0/Kreoda.HermesBridge.dll")], {
      windowsHide: true, env: { ...process.env, KREODA_HERMES_BRIDGE_URL: "http://127.0.0.1:44745", KREODA_CAD_SESSION_URL: "ws://127.0.0.1:44744/",
        KREODA_CAD_PAIR: pairing.token, KREODA_CAD_DEVICE_FILE: path.join(profile, "cad-device.json"), KREODA_HERMES_CONFIG: "", KREODA_VOICE_TOKEN: token } });
    await expect.poll(async () => { try { return (await fetch("http://127.0.0.1:44745/health")).ok; } catch { return false; } }).toBe(true);
    const voiceConfig = path.join(profile, "voice.json");writeFileSync(voiceConfig, JSON.stringify({ endpoint: "http://127.0.0.1:44745", token }));
    const env = { ...process.env, KREODA_BENCHMARK_MCP_URL: "http://127.0.0.1:44745/mcp", KREODA_BENCHMARK_VOICE_CONFIG: voiceConfig, KREODA_BENCHMARK_HERMES_CONFIG: "" };
    const requirements = path.resolve(HERE, "../../../docs/superpowers/benchmarks/phase14-requirements.json");
    const runner = "tools/Kreoda.ModelingAgent.Benchmark/bin/Release/net8.0/Kreoda.ModelingAgent.Benchmark.dll";
    const unavailablePath = path.join(profile, "unavailable.json");
    const unavailable = await child(runner, [requirements, "centered-hole-plate", unavailablePath], env);
    expect(unavailable.code).toBe(1);
    const report = JSON.parse(readFileSync(unavailablePath, "utf8")) as { error: string; accepted: boolean; geometryPassed: boolean; before: { features: unknown[] } };
    // Voice routes are absent when no Hermes backend is configured.
    expect(report.error).toBe("voice-http-404");expect(report.accepted).toBe(false);expect(report.geometryPassed).toBe(false);expect(report.before.features).toHaveLength(0);
    const probe = await child("probes/Kreoda.McpProbe/bin/Release/net8.0/Kreoda.McpProbe.dll", [], { ...process.env, KREODA_MCP_PROBE_URL: "http://127.0.0.1:44745/mcp" });
    expect(probe.code).toBe(0);const proof = JSON.parse(probe.out.trim()) as { featureId: string; finalRevision: number };
    await expect.poll(async () => (await snapOf(page)).revision).toBe(proof.finalRevision);
    const occupiedPath = path.join(profile, "occupied.json");
    const occupied = await child(runner, [requirements, "centered-hole-plate", occupiedPath], env);
    expect(occupied.code).not.toBe(0);expect(occupied.errors).toContain("isolated empty committed document");expect(existsSync(occupiedPath)).toBe(false);
    expect((await snapOf(page)).revision).toBe(proof.finalRevision);
    expect((await snapOf(page)).bodies.find(b => b.id === proof.featureId)?.volumeMm3).toBeCloseTo(100000, 3);
    await page.getByTestId("home-new-project").click();await runBar(page, "undo");
    await expect.poll(async () => (await snapOf(page)).bodies.length).toBe(0);
    await test.info().attach("benchmark-unavailable-native-proof", { contentType: "application/json", path: unavailablePath });
  } finally { bridge?.kill();await app.close(); }
});
