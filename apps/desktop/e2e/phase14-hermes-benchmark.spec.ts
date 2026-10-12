import { test, expect, _electron as electron } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAIN, HERE, hideForBackgroundE2E, runBar, snapOf } from "./helpers";

async function listenLocal(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local test server did not bind a TCP port");
  return (address as AddressInfo).port;
}

async function unusedLocalPort(): Promise<number> {
  const server = createServer();const port = await listenLocal(server);
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

test("benchmark records unavailable Hermes and refuses occupied native document", async () => {
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-benchmark-boundary-"));
  const app = await electron.launch({ executablePath: createRequire(import.meta.url)("electron") as string,
    args: [MAIN, "--no-sandbox", "--lang=en-US", `--user-data-dir=${profile}`],
    env: { ...process.env, KREODA_SESSION_PORT: "", KREODA_SESSION_TOKEN: "", KREODA_RECOVERY_DIR: profile } });
  let bridge: ReturnType<typeof spawn> | undefined;
  const sessionPort = await unusedLocalPort();let bridgePort = await unusedLocalPort();
  while (bridgePort === sessionPort) bridgePort = await unusedLocalPort();
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
    await hideForBackgroundE2E(app);
    await expect.poll(() => page.evaluate(() => globalThis.window.kreoda.coreInfo().then(i => i.running))).toBe(true);
    await page.evaluate(port => globalThis.window.kreoda.sessionEnable("127.0.0.1", port), sessionPort);
    const pairing = await page.evaluate(() => globalThis.window.kreoda.sessionPair());
    const token = "benchmark-test-only-voice-token";
    bridge = spawn("dotnet", [path.join(sessionRoot, "tools/Kreoda.HermesBridge/bin/Release/net8.0/Kreoda.HermesBridge.dll")], {
      windowsHide: true, env: { ...process.env, KREODA_HERMES_BRIDGE_URL: `http://127.0.0.1:${bridgePort}`, KREODA_CAD_SESSION_URL: `ws://127.0.0.1:${sessionPort}/`,
        KREODA_CAD_PAIR: pairing.token, KREODA_CAD_DEVICE_FILE: path.join(profile, "cad-device.json"), KREODA_HERMES_CONFIG: "", KREODA_VOICE_TOKEN: token } });
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${bridgePort}/health`)).ok; } catch { return false; } }).toBe(true);
    const voiceConfig = path.join(profile, "voice.json");writeFileSync(voiceConfig, JSON.stringify({ endpoint: `http://127.0.0.1:${bridgePort}`, token }));
    const env = { ...process.env, KREODA_BENCHMARK_MCP_URL: `http://127.0.0.1:${bridgePort}/mcp`, KREODA_BENCHMARK_VOICE_CONFIG: voiceConfig, KREODA_BENCHMARK_HERMES_CONFIG: "" };
    const requirements = path.resolve(HERE, "../../../docs/superpowers/benchmarks/phase14-requirements.json");
    const runner = "tools/Kreoda.ModelingAgent.Benchmark/bin/Release/net8.0/Kreoda.ModelingAgent.Benchmark.dll";
    const unavailablePath = path.join(profile, "unavailable.json");
    const unavailable = await child(runner, [requirements, "centered-hole-plate", unavailablePath], env);
    expect(unavailable.code).toBe(1);
    const report = JSON.parse(readFileSync(unavailablePath, "utf8")) as { error: string; accepted: boolean; geometryPassed: boolean; before: { features: unknown[] } };
    // Voice routes are absent when no Hermes backend is configured.
    expect(report.error).toBe("voice-http-404");expect(report.accepted).toBe(false);expect(report.geometryPassed).toBe(false);expect(report.before.features).toHaveLength(0);
    const probe = await child("probes/Kreoda.McpProbe/bin/Release/net8.0/Kreoda.McpProbe.dll", [], { ...process.env, KREODA_MCP_PROBE_URL: `http://127.0.0.1:${bridgePort}/mcp` });
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

test("local-fake-Hermes benchmark records failed-run events without acceptance", async () => {
  const fakeRunId = "fixture_failed";const fakeApiKey = "local-fake-api-key";const fakeSessionKey = "local-fake-session";
  const reasoningMarker = "LOCAL_FAKE_REASONING_MUST_NOT_APPEAR";
  const state = { submissions: 0, stoppedRuns: [] as string[], eventReads: 0, unexpected: [] as string[] };
  const evidenceDir = process.env.KREODA_E2E_EVIDENCE_DIR;
  if (evidenceDir && !existsSync(evidenceDir)) throw new Error("KREODA_E2E_EVIDENCE_DIR must name a new external QA directory");
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-fake-hermes-benchmark-"));
  const outputDir = evidenceDir ?? profile;
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let bridge: ReturnType<typeof spawn> | undefined;
  const sessionRoot = path.resolve(HERE, "../../../clients/session-dotnet");
  const fakeGateway = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.headers.authorization !== `Bearer ${fakeApiKey}` || request.headers["x-hermes-session-key"] !== fakeSessionKey) {
        state.unexpected.push(`unauthorized ${request.method} ${url.pathname}`);response.writeHead(401).end();return;
      }
      if (request.method === "POST" && url.pathname === "/v1/runs") {
        state.submissions++;
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ run_id: fakeRunId, status: "queued" }));return;
      }
      const events = /^\/v1\/runs\/([^/]+)\/events$/.exec(url.pathname);
      if (request.method === "GET" && events) {
        state.eventReads++;
        const frames = [
          { type: "tool.started", tool: "search_knowledge", preview: "fixture evidence" },
          { type: "tool.completed", tool: "search_knowledge", duration: 1, error: true },
          { type: "reasoning.available", text: reasoningMarker },
        ];
        response.writeHead(200, { "content-type": "text/event-stream" }).end(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join("") );return;
      }
      const stop = /^\/v1\/runs\/([^/]+)\/stop$/.exec(url.pathname);
      if (request.method === "POST" && stop) {
        state.stoppedRuns.push(decodeURIComponent(stop[1]!));
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "stopped" }));return;
      }
      const run = /^\/v1\/runs\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && run) {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
          run_id: decodeURIComponent(run[1]!), status: "failed", model: "local-fake-model", provider: "local-fake-hermes",
        }));return;
      }
      state.unexpected.push(`unexpected ${request.method} ${url.pathname}`);response.writeHead(404).end();
    })().catch(() => { state.unexpected.push("fake gateway handler failed");if (!response.headersSent) response.writeHead(500);response.end(); });
  });
  try {
    const gatewayPort = await listenLocal(fakeGateway);
    const sessionPort = await unusedLocalPort();let bridgePort = await unusedLocalPort();
    while (bridgePort === sessionPort || bridgePort === gatewayPort) bridgePort = await unusedLocalPort();
    const reportPath = path.join(outputDir, "local-fake-hermes-benchmark.json");
    app = await electron.launch({ executablePath: createRequire(import.meta.url)("electron") as string,
      args: [MAIN, "--no-sandbox", "--lang=en-US", `--user-data-dir=${profile}`],
      env: { ...process.env, KREODA_SESSION_PORT: "", KREODA_SESSION_TOKEN: "", KREODA_RECOVERY_DIR: profile } });
    const page = await app.firstWindow();await hideForBackgroundE2E(app);
    await expect.poll(() => page.evaluate(() => globalThis.window.kreoda.coreInfo().then(i => i.running))).toBe(true);
    await page.evaluate(port => globalThis.window.kreoda.sessionEnable("127.0.0.1", port), sessionPort);
    const pairing = await page.evaluate(() => globalThis.window.kreoda.sessionPair());
    const token = "local-fake-hermes-voice-token";
    const hermesConfig = path.join(profile, "hermes-fake.json");
    const voiceConfig = path.join(profile, "voice-fake.json");
    writeFileSync(hermesConfig, JSON.stringify({ gatewayUrl: `http://127.0.0.1:${gatewayPort}/v1/`, apiKey: fakeApiKey, sessionKey: fakeSessionKey }));
    writeFileSync(voiceConfig, JSON.stringify({ endpoint: `http://127.0.0.1:${bridgePort}`, token }));
    bridge = spawn("dotnet", [path.join(sessionRoot, "tools/Kreoda.HermesBridge/bin/Release/net8.0/Kreoda.HermesBridge.dll")], {
      windowsHide: true, env: { ...process.env, KREODA_HERMES_BRIDGE_URL: `http://127.0.0.1:${bridgePort}`, KREODA_CAD_SESSION_URL: `ws://127.0.0.1:${sessionPort}/`,
        KREODA_CAD_PAIR: pairing.token, KREODA_CAD_DEVICE_FILE: path.join(profile, "cad-device.json"), KREODA_HERMES_CONFIG: hermesConfig, KREODA_VOICE_TOKEN: token } });
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${bridgePort}/health`)).ok; } catch { return false; } }).toBe(true);
    const env = { ...process.env, KREODA_BENCHMARK_MCP_URL: `http://127.0.0.1:${bridgePort}/mcp`,
      KREODA_BENCHMARK_VOICE_CONFIG: voiceConfig, KREODA_BENCHMARK_HERMES_CONFIG: hermesConfig };
    const requirements = path.resolve(HERE, "../../../docs/superpowers/benchmarks/phase14-requirements.json");
    const runner = path.join(sessionRoot, "tools/Kreoda.ModelingAgent.Benchmark/bin/Release/net8.0/Kreoda.ModelingAgent.Benchmark.dll");
    expect(existsSync(reportPath)).toBe(false);
    const result = await new Promise<{ code: number | null; out: string; errors: string }>((resolve, reject) => {
      const child = spawn("dotnet", [runner, requirements, "centered-hole-plate", reportPath], { windowsHide: true, env });
      let out = "", errors = "";child.stdout.on("data", b => out += String(b));child.stderr.on("data", b => errors += String(b));
      const timeout = setTimeout(() => { child.kill();reject(new Error("local-fake-Hermes benchmark timed out")); }, 45000);
      child.once("error", error => { clearTimeout(timeout);reject(error); });
      child.once("exit", code => { clearTimeout(timeout);resolve({ code, out, errors }); });
    });
    expect(result.code, result.errors).toBe(1);
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
      error: string; runId: string | null; accepted: boolean; geometryPassed: boolean;
      before: { features: unknown[]; sketches: unknown[]; bodies: unknown[]; requestActive: boolean };
      after: { features: unknown[]; sketches: unknown[]; bodies: unknown[]; requestActive: boolean } | null;
      metadata: { status: string; model: string; provider: string; tools: Array<{ type: string; tool: string; error: boolean | null }>; eventsComplete: boolean } | null;
      metadataError: string | null;
    };
    expect(report.error).toBe("voice-http-502");expect(report.runId).toBe(fakeRunId);
    expect(report.accepted).toBe(false);expect(report.geometryPassed).toBe(false);
    expect(report.before.features).toHaveLength(0);expect(report.before.sketches).toHaveLength(0);expect(report.before.bodies).toHaveLength(0);
    expect(report.before.requestActive).toBe(false);
    expect(report.after?.features).toHaveLength(0);expect(report.after?.sketches).toHaveLength(0);expect(report.after?.bodies).toHaveLength(0);
    expect(report.after?.requestActive).toBe(false);
    expect(report.metadataError).toBeNull();expect(report.metadata).not.toBeNull();
    expect(report.metadata!.status).toBe("failed");expect(report.metadata!.model).toBe("local-fake-model");
    expect(report.metadata!.provider).toBe("local-fake-hermes");
    expect(report.metadata!.tools.map(tool => [tool.type, tool.tool])).toEqual([
      ["tool.started", "search_knowledge"], ["tool.completed", "search_knowledge"],
    ]);
    expect(report.metadata!.tools.find(tool => tool.type === "tool.completed")?.error).toBe(true);
    expect(report.metadata!.eventsComplete).toBe(true);
    expect(readFileSync(reportPath, "utf8")).not.toContain(reasoningMarker);
    expect(state.submissions).toBe(1);expect(state.stoppedRuns).toEqual([fakeRunId]);expect(state.eventReads).toBe(1);expect(state.unexpected).toEqual([]);
    const evidencePath = path.join(outputDir, "local-fake-hermes-evidence.json");
    writeFileSync(evidencePath, JSON.stringify({ kind: "local-fake-hermes-failure-evidence", requests: state, report }, null, 2));
    await test.info().attach("local-fake-hermes-failure-evidence", { contentType: "application/json", path: evidencePath });
  } finally {
    bridge?.kill();if (app) await app.close();
    if (fakeGateway.listening) await new Promise<void>((resolve, reject) => fakeGateway.close(error => error ? reject(error) : resolve()));
  }
});
