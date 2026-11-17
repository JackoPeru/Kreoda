import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAIN, HERE, hideForBackgroundE2E, openProject, runBar, snapOf } from "./helpers";

test("native persistent symmetric sketch proposal approval and stale rejection", async () => {
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-generated-mcp-"));
  const app = await electron.launch({ executablePath: createRequire(import.meta.url)("electron") as string,
    args: [MAIN, "--no-sandbox", "--lang=en-US", `--user-data-dir=${profile}`],
    env: { ...process.env, KREODA_SESSION_PORT: "", KREODA_SESSION_TOKEN: "", KREODA_RECOVERY_DIR: profile } });
  let bridge: ReturnType<typeof spawn> | undefined;
  try {
    const page = await app.firstWindow();
    await hideForBackgroundE2E(app);
    await expect.poll(() => page.evaluate(() => window.kreoda.coreInfo().then(i => i.running))).toBe(true);
    await page.evaluate(() => window.kreoda.sessionEnable("127.0.0.1", 44752));
    const pairing = await page.evaluate(() => window.kreoda.sessionPair());
    const dll = path.resolve(HERE, "../../../clients/session-dotnet/tools/Kreoda.HermesBridge/bin/Release/net8.0/Kreoda.HermesBridge.dll");
    bridge = spawn("dotnet", [dll], { windowsHide: true, env: { ...process.env,
      KREODA_HERMES_BRIDGE_URL: "http://127.0.0.1:44753", KREODA_CAD_SESSION_URL: "ws://127.0.0.1:44752/",
      KREODA_CAD_PAIR: pairing.token, KREODA_CAD_DEVICE_FILE: path.join(profile, "mcp-device.json"),
      KREODA_HERMES_CONFIG: "", KREODA_VOICE_TOKEN: "" } });
    await expect.poll(async () => {
      try { return (await fetch("http://127.0.0.1:44753/health")).ok; } catch { return false; }
    }).toBe(true);
    const probeDll = path.resolve(HERE, "../../../clients/session-dotnet/probes/Kreoda.McpProbe/bin/Release/net8.0/Kreoda.McpProbe.dll");
    const proof = await new Promise<{ sketchId: string; boxId: string; revision: number; staleApprovalRejected: boolean; symmetricConstraints: number }>((resolve, reject) => {
      const child = spawn("dotnet", [probeDll], { windowsHide: true, env: { ...process.env,
        KREODA_MCP_PROBE_SCENARIO: "native-symmetric-approval", KREODA_MCP_PROBE_URL: "http://127.0.0.1:44753/mcp", KREODA_CAD_SESSION_URL:"ws://127.0.0.1:44752/", KREODA_CAD_PAIR:pairing.token, KREODA_CAD_DEVICE_FILE:path.join(profile,"approval-device.json") } });
      let out = "", errors = "";
      child.stdout.on("data", b => out += String(b));child.stderr.on("data", b => errors += String(b));
      const timer = setTimeout(() => { child.kill();reject(new Error("Generated native probe timed out")); }, 45000);
      child.once("error", reject);child.once("exit", code => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error(errors || out));
        else { try { resolve(JSON.parse(out.trim())); } catch (error) { reject(error); } }
      });
    });
    expect(1000).toBeCloseTo(1000, 2);
    await expect.poll(async () => (await snapOf(page)).revision).toBe(proof.revision);
    expect((await snapOf(page)).bodies.find(b => b.id === proof.boxId)?.volumeMm3).toBeCloseTo(1000, 2);
    const archive = path.join(profile, "generated.icad");
    await page.evaluate(file => (window as unknown as { __kreoda_test: { saveIcad: (path: string) => Promise<unknown> } }).__kreoda_test.saveIcad(file), archive);
    await page.evaluate(file => (window as unknown as { __kreoda_test: { openIcad: (path: string) => Promise<unknown> } }).__kreoda_test.openIcad(file), archive);
    await expect.poll(async () => (await snapOf(page)).bodies.find(b => b.id === proof.boxId)?.volumeMm3).toBeCloseTo(1000, 2);
    if (await page.getByTestId("home-new-project").isVisible()) await page.getByTestId("home-new-project").click();
    await openProject(page);
    await page.getByTestId(`object-tree-${proof.boxId}`).click();
    await runBar(page, "set widthMm 11");
    await expect.poll(async () => (await snapOf(page)).bodies.find(b => b.id === proof.boxId)?.volumeMm3).toBeCloseTo(1100, 2);
    await runBar(page, "undo");
    await expect.poll(async () => (await snapOf(page)).bodies.find(b => b.id === proof.boxId)?.volumeMm3).toBeCloseTo(1000, 2);
  } finally { bridge?.kill();await app.close(); }
});



