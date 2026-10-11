import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAIN, HERE, runBar, snapOf } from "./helpers";
import { frameMessage } from "@kreoda/protocol";

test("official MCP checked native request reaches Desktop and one shared Undo", async () => {
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-hermes-mcp-"));
  const app = await electron.launch({ executablePath: createRequire(import.meta.url)("electron") as string,
    args: [MAIN, "--no-sandbox", "--lang=en-US", `--user-data-dir=${profile}`],
    env: { ...process.env, KREODA_SESSION_PORT: "", KREODA_SESSION_TOKEN: "", KREODA_RECOVERY_DIR: profile } });
  let bridge: ReturnType<typeof spawn> | undefined;
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.hide()));
    await expect.poll(() => page.evaluate(() => globalThis.window.kreoda.coreInfo().then(i => i.running))).toBe(true);
    const infoRequest = Buffer.from(frameMessage(Buffer.from(JSON.stringify({ protocolVersion: 1, requestId: "mcp-native-info", documentId: "doc-phase1", type: 1, payload: {} })))).toString("base64");
    const core = JSON.parse(Buffer.from(await page.evaluate(frame => window.kreoda.invoke(frame), infoRequest), "base64").toString("utf8")) as { occtVersion: string };
    expect(core.occtVersion).toBe("8.0.1-native");
    await page.evaluate(() => globalThis.window.kreoda.sessionEnable("127.0.0.1", 44742));
    const pairing = await page.evaluate(() => globalThis.window.kreoda.sessionPair());
    const bridgeDll = path.resolve(HERE, "../../../clients/session-dotnet/tools/Kreoda.HermesBridge/bin/Release/net8.0/Kreoda.HermesBridge.dll");
    bridge = spawn("dotnet", [bridgeDll], { windowsHide: true, env: { ...process.env,
      KREODA_HERMES_BRIDGE_URL: "http://127.0.0.1:44743", KREODA_CAD_SESSION_URL: "ws://127.0.0.1:44742/",
      KREODA_CAD_PAIR: pairing.token, KREODA_CAD_DEVICE_FILE: path.join(profile, "mcp-device.json"), KREODA_HERMES_CONFIG: "", KREODA_VOICE_TOKEN: "" } });
    await expect.poll(async () => { try { return (await fetch("http://127.0.0.1:44743/health")).ok; } catch { return false; } }).toBe(true);
    const probeDll = path.resolve(HERE, "../../../clients/session-dotnet/probes/Kreoda.McpProbe/bin/Release/net8.0/Kreoda.McpProbe.dll");
    const proof = await new Promise<{ featureId: string; finalRevision: number; passed: string[] }>((resolve, reject) => {
      const child = spawn("dotnet", [probeDll], { windowsHide: true, env: { ...process.env, KREODA_MCP_PROBE_URL: "http://127.0.0.1:44743/mcp" } });
      let out = "", errors = "";child.stdout.on("data", b => out += String(b));child.stderr.on("data", b => errors += String(b));
      const timer = setTimeout(() => { child.kill();reject(new Error("MCP native probe timed out")); }, 45000);
      child.once("error", reject);child.once("exit", code => { clearTimeout(timer);if (code !== 0) reject(new Error(errors));else { try { resolve(JSON.parse(out.trim())); } catch (e) { reject(e); } } });
    });
    expect(proof.passed).toHaveLength(3);
    await expect.poll(async () => (await snapOf(page)).revision).toBe(proof.finalRevision);
    expect((await snapOf(page)).bodies.find(b => b.id === proof.featureId)?.volumeMm3).toBeCloseTo(100000, 3);
    await page.getByTestId("home-new-project").click();await runBar(page, "undo");
    await expect.poll(async () => (await snapOf(page)).bodies.length).toBe(0);
    const report = path.join(profile, "mcp-proof.json");writeFileSync(report, JSON.stringify({ ...proof, kernel: core.occtVersion, desktopObserved: true, oneUndoRestoredEmptyDocument: true, screenshots: 0 }, null, 2));
    await test.info().attach("native-mcp-proof", { contentType: "application/json", path: report });
  } finally { bridge?.kill();await app.close(); }
});
