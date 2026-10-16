import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAIN, HERE } from "./helpers";

test("actual OCCT contextual fillet and sketch dimension share Desktop Undo", async () => {
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-context-acceptance-"));
  const app = await electron.launch({ executablePath: createRequire(import.meta.url)("electron") as string,
    args: [MAIN, "--no-sandbox", `--user-data-dir=${profile}`],
    env: { ...process.env, KREODA_SESSION_PORT: "", KREODA_SESSION_TOKEN: "", KREODA_RECOVERY_DIR: profile } });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.hide()));
    await expect.poll(() => page.evaluate(() => !!globalThis.window.kreoda)).toBe(true);
    await expect.poll(() => page.evaluate(() => globalThis.window.kreoda.coreInfo().then(i => i.running))).toBe(true);
    await page.evaluate(() => globalThis.window.kreoda.sessionEnable("127.0.0.1", 44740));
    const pair = await page.evaluate(() => globalThis.window.kreoda.sessionPair());
    const dll = path.resolve(HERE, "../../../clients/session-dotnet/probes/Kreoda.SessionProbe/bin/Release/net8.0/Kreoda.SessionProbe.dll");
    const proof = await new Promise<{ passed: string[]; finalRevision: number; boundary: string }>((resolve, reject) => {
      const child = spawn("dotnet", [dll], { windowsHide: true, env: { ...process.env,
        KREODA_SESSION_PROBE_URL: "ws://127.0.0.1:44740/", KREODA_SESSION_PROBE_PAIR: pair.token, KREODA_SESSION_PROBE_CONTEXT: "1" } });
      let output = "", errors = "";
      child.stdout.on("data", b => output += String(b));child.stderr.on("data", b => errors += String(b));child.once("error", reject);
      const timer = setTimeout(() => { child.kill();reject(new Error("context probe timed out")); }, 45000);
      child.once("exit", code => { clearTimeout(timer);if (code !== 0) reject(new Error(`context probe failed: ${errors}`));
        else { try { resolve(JSON.parse(output.trim()) as typeof proof); } catch (error) { reject(error); } } });
    });
    expect(proof.passed).toHaveLength(3);
    await expect.poll(() => page.evaluate(() => (globalThis.window as unknown as { __kreoda_test: { snapshot(): { revision: number } } }).__kreoda_test.snapshot().revision)).toBe(proof.finalRevision);
    const report = path.join(profile, "context-proof.json");writeFileSync(report, JSON.stringify({ ...proof, desktopRevisionObserved: true, screenshots: 0 }, null, 2));
    await test.info().attach("native-context-proof", { contentType: "application/json", path: report });
  } finally { await app.close(); }
});
