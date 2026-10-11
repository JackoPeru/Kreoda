import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAIN, HERE } from "./helpers";

test("actual OCCT preview bytes, compound commit and lost acknowledgement recovery", async () => {
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-preview-acceptance-"));
  const app = await electron.launch({ executablePath: createRequire(import.meta.url)("electron") as string,
    args: [MAIN, "--no-sandbox", "--lang=en-US", `--user-data-dir=${profile}`],
    env: { ...process.env, KREODA_SESSION_PORT: "", KREODA_SESSION_TOKEN: "", KREODA_RECOVERY_DIR: profile } });
  try {
    const window = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.hide()));
    await expect.poll(() => window.evaluate(() => !!globalThis.window.kreoda)).toBe(true);
    await expect.poll(() => window.evaluate(() => globalThis.window.kreoda.coreInfo().then(i => i.running))).toBe(true);
    await window.evaluate(() => globalThis.window.kreoda.sessionEnable("127.0.0.1", 44739));
    const pair = await window.evaluate(() => globalThis.window.kreoda.sessionPair());
    await app.evaluate(() => {
      const runtimeRequire = process.getBuiltinModule("module").createRequire(process.cwd() + "/package.json");
      const prototype = (runtimeRequire("ws") as typeof import("ws")).WebSocket.prototype;
      const send = prototype.send, emit = prototype.emit;
      const audit = { hashes: [] as string[], dropId: "", dropped: 0 };
      (globalThis as unknown as { previewAudit: typeof audit }).previewAudit = audit;
      prototype.emit = function (event, ...args) {
        if (event === "message") {
          try {
            const message = JSON.parse(String(args[0])) as { method?: string; requestId?: string };
            if (!audit.dropId && message.method === "previewCommit") audit.dropId = message.requestId ?? "";
          } catch { /* Binary and unrelated frames are not control requests. */ }
        }
        return emit.call(this, event, ...args);
      };
      prototype.send = function (...args) {
        const data = args[0];
        if (data instanceof Uint8Array) audit.hashes.push(runtimeRequire("node:crypto").createHash("sha256").update(data).digest("hex") as string);
        if (typeof data === "string") {
          try {
            const message = JSON.parse(data) as { requestId?: string; ok?: boolean };
            if (audit.dropped === 0 && audit.dropId && message.requestId === audit.dropId && message.ok === true) {
              audit.dropped++;return;
            }
          } catch { /* Other server messages retain their ordinary route. */ }
        }
        Reflect.apply(send, this, args);
      };
    });
    const dll = path.resolve(HERE, "../../../clients/session-dotnet/probes/Kreoda.SessionProbe/bin/Release/net8.0/Kreoda.SessionProbe.dll");
    const probe = await new Promise<{ passed: string[]; hashes: string[]; boundary: string }>((resolve, reject) => {
      const child = spawn("dotnet", [dll], { windowsHide: true, env: { ...process.env,
        KREODA_SESSION_PROBE_URL: "ws://127.0.0.1:44739/", KREODA_SESSION_PROBE_PAIR: pair.token,
        KREODA_SESSION_PROBE_PREVIEW: "1" } });
      let output = "", errors = "";
      child.stdout.on("data", b => output += String(b));child.stderr.on("data", b => errors += String(b));
      child.once("error", reject);
      const timer = setTimeout(() => { child.kill();reject(new Error("preview probe timed out")); }, 30000);
      child.once("exit", code => { clearTimeout(timer);if (code !== 0) reject(new Error(`preview probe failed: ${errors}`));
        else { try { resolve(JSON.parse(output.trim()) as typeof probe); } catch (error) { reject(error); } } });
    });
    const audit = await app.evaluate(() => (globalThis as unknown as {
      previewAudit: { hashes: string[]; dropped: number } }).previewAudit);
    expect(audit.dropped).toBe(1);
    expect(probe.passed).toHaveLength(3);
    for (const hash of probe.hashes) expect(audit.hashes).toContain(hash);
    const report = path.join(profile, "preview-proof.json");
    writeFileSync(report, JSON.stringify({ ...probe, exactOutboundHashes: audit.hashes, droppedAcknowledgements: audit.dropped,
      inputActions: 0 }, null, 2));
    await test.info().attach("native-preview-proof", { contentType: "application/json", path: report });
  } finally { await app.close(); }
});
