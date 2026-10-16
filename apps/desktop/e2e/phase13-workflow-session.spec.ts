import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAIN, HERE, hideForBackgroundE2E, runBar, snapOf } from "./helpers";

test("actual spatial worker workflow returns to Desktop expressions", async () => {
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-context-acceptance-"));
  const app = await electron.launch({ executablePath: createRequire(import.meta.url)("electron") as string,
    args: [MAIN, "--no-sandbox", "--lang=en-US", `--user-data-dir=${profile}`],
    env: { ...process.env, KREODA_SESSION_PORT: "", KREODA_SESSION_TOKEN: "", KREODA_RECOVERY_DIR: profile } });
  try {
    const page = await app.firstWindow();
    await hideForBackgroundE2E(app);
    await expect.poll(() => page.evaluate(() => !!globalThis.window.kreoda)).toBe(true);
    await expect.poll(() => page.evaluate(() => globalThis.window.kreoda.coreInfo().then(i => i.running))).toBe(true);
    await page.evaluate(() => globalThis.window.kreoda.sessionEnable("127.0.0.1", 44741));
    const pair = await page.evaluate(() => globalThis.window.kreoda.sessionPair());
    const dll = path.resolve(HERE, "../../../clients/session-dotnet/probes/Kreoda.SessionProbe/bin/Release/net8.0/Kreoda.SessionProbe.dll");
    const proof = await new Promise<{ passed: string[]; finalRevision: number; boundary: string; extrudeId: string; holeId: string; previewCount: number }>((resolve, reject) => {
      const child = spawn("dotnet", [dll], { windowsHide: true, env: { ...process.env,
        KREODA_SESSION_PROBE_URL: "ws://127.0.0.1:44741/", KREODA_SESSION_PROBE_PAIR: pair.token, KREODA_SESSION_PROBE_WORKFLOW: "1", KREODA_SESSION_PROBE_SAVE: path.join(profile, "workflow.icad") } });
      let output = "", errors = "";
      let checkpoint = false;
      child.stdout.on("data", b => {
        output += String(b);
        if (!checkpoint && output.includes('"checkpoint":"save-fixture"')) {
          checkpoint = true;
          void page.evaluate(file => (window as unknown as { __kreoda_test: { saveIcad(path: string): Promise<unknown> } }).__kreoda_test.saveIcad(file), path.join(profile, "workflow.icad"))
            .then(() => child.stdin.write("saved\n"), reject);
        }
      });child.stderr.on("data", b => errors += String(b));child.once("error", reject);
      const timer = setTimeout(() => { child.kill();reject(new Error("context probe timed out")); }, 45000);
      child.once("exit", code => { clearTimeout(timer);if (code !== 0) reject(new Error(`context probe failed: ${errors}`));
        else { try { resolve(JSON.parse(output.trim().split("\n").at(-1)!) as typeof proof); } catch (error) { reject(error); } } });
    });
    expect(proof.passed).toHaveLength(4);
    await expect.poll(() => page.evaluate(() => (globalThis.window as unknown as { __kreoda_test: { snapshot(): { revision: number } } }).__kreoda_test.snapshot().revision)).toBe(proof.finalRevision);
    expect(proof.previewCount).toBeGreaterThan(0);
    await page.getByTestId("home-new-project").click();
    await page.evaluate(id => (window as unknown as { __kreoda_test: { selectMany(ids: string[]): void } }).__kreoda_test.selectMany([id]), proof.holeId);
    await runBar(page, `set diameterMm =100 / ${proof.extrudeId}.distanceMm`);
    const expression = `100 / ${proof.extrudeId}.distanceMm`;
    await expect.poll(async () => (await snapOf(page)).bodies.find(b => b.id === proof.holeId)?.expressions.diameterMm).toBe(expression);
    expect((await snapOf(page)).bodies.find(b => b.id === proof.holeId)?.paramsMm[0]).toBeCloseTo(100 / 30, 6);
    const report = path.join(profile, "workflow-proof.json");writeFileSync(report, JSON.stringify({ ...proof, desktopRevisionObserved: true, screenshots: 0 }, null, 2));
    await test.info().attach("native-workflow-proof", { contentType: "application/json", path: report });
  } finally { await app.close(); }
});
