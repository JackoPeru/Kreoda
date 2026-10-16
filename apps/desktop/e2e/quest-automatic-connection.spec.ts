import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, HERE } from "./helpers";
import { CommandType, frameMessage, PROTOCOL_VERSION } from "@kreoda/protocol";

test.use({ trace: "off" });
test("hidden desktop discovers and bootstraps the real managed Quest client without inputs", async ({}, testInfo) => {
  test.setTimeout(90000);
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-autoconnect-e2e-"));
  let app: Awaited<ReturnType<typeof boot>>["app"] | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const launched = await boot({ KREODA_BACKGROUND_TEST: "1", KREODA_AUTOMATIC_LOOPBACK_TEST: "1",
      KREODA_SESSION_PORT: "", KREODA_SESSION_TOKEN: "", KREODA_RECOVERY_DIR: profile }, [`--user-data-dir=${profile}`]);
    app = launched.app;
    const frame = frameMessage(Buffer.from(JSON.stringify({ protocolVersion: PROTOCOL_VERSION,
      requestId: "autoconnect-box", documentId: "doc-phase1", type: CommandType.CreateBox,
      featureId: "automatic-box", widthMm: 10, depthMm: 10, heightMm: 10 })));
    const raw = await launched.window.evaluate(payload => window.kreoda.invoke(payload), Buffer.from(frame).toString("base64"));
    expect(JSON.parse(Buffer.from(raw, "base64").toString()).status).toBe("ok");
    child = spawn("dotnet", [path.resolve(HERE, "../../../clients/session-dotnet/probes/Kreoda.McpProbe/bin/Release/net8.0/Kreoda.McpProbe.dll")], {
      windowsHide: true, env: { ...process.env, KREODA_MCP_PROBE_SCENARIO: "automatic-local-connection" },
    });
    let stdout = "", stderr = "";
    child.stdout!.on("data", chunk => { stdout += String(chunk); });
    child.stderr!.on("data", chunk => { stderr += String(chunk); });
    const code = await new Promise<number | null>((resolve, reject) => {
      child!.once("error", reject);child!.once("exit", resolve);
    });
    expect(code, stderr).toBe(0);
    const proof = JSON.parse(stdout.trim().split(/\r?\n/).at(-1)!);
    expect(proof).toMatchObject({ status: "connected-and-reconnected", manualInputs: 0, features: 1 });
    await testInfo.attach("automatic-managed-session", { body: JSON.stringify(proof, null, 2), contentType: "application/json" });
  } finally {
    if (child && child.exitCode === null) child.kill();
    await app?.close();
    const parent = realpathSync(os.tmpdir()), target = realpathSync(profile);
    if (path.dirname(target).toLowerCase() !== parent.toLowerCase() || !path.basename(target).startsWith("kreoda-autoconnect-e2e-"))
      throw new Error("invalid isolated cleanup target");
    rmSync(target, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
  }
});
