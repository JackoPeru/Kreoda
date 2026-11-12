import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, HERE } from "./helpers";
import { CommandType, frameMessage, PROTOCOL_VERSION } from "@kreoda/protocol";

test.use({ trace: "off" });
test("automatic MCP agent preserves its identity across Desktop port changes", async ({}, testInfo) => {
  test.setTimeout(120000);
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-agent-auto-e2e-"));
  const deviceFile = path.join(profile, "private-agent.json");
  let app: Awaited<ReturnType<typeof boot>>["app"] | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  const launch = () => boot({ KREODA_BACKGROUND_TEST: "1", KREODA_AUTOMATIC_LOOPBACK_TEST: "1",
    KREODA_SESSION_PORT: "", KREODA_SESSION_TOKEN: "", KREODA_RECOVERY_DIR: profile }, [`--user-data-dir=${profile}`]);
  const probe = async () => {
    child = spawn("dotnet", [path.resolve(HERE, "../../../clients/session-dotnet/probes/Kreoda.McpProbe/bin/Release/net8.0/Kreoda.McpProbe.dll")], {
      windowsHide: true, env: { ...process.env, KREODA_MCP_PROBE_SCENARIO: "automatic-agent-local-connection", KREODA_CAD_DEVICE_FILE: deviceFile },
    });
    let stdout = "", stderr = "";
    child.stdout!.on("data", chunk => { stdout += String(chunk); });
    child.stderr!.on("data", chunk => { stderr += String(chunk); });
    const code = await new Promise<number | null>((resolve, reject) => { child!.once("error", reject);child!.once("exit", resolve); });
    expect(code, stderr + stdout).toBe(0);
    return JSON.parse(stdout.trim().split(/\r?\n/).at(-1)!);
  };
  try {
    const first = await launch();app = first.app;
    const frame = frameMessage(Buffer.from(JSON.stringify({ protocolVersion: PROTOCOL_VERSION,
      requestId: "agent-auto-box", documentId: "doc-phase1", type: CommandType.CreateBox,
      featureId: "agent-auto-box", widthMm: 10, depthMm: 10, heightMm: 10 })));
    const raw = await first.window.evaluate(payload => window.kreoda.invoke(payload), Buffer.from(frame).toString("base64"));
    expect(JSON.parse(Buffer.from(raw, "base64").toString()).status).toBe("ok");
    const before = await probe();
    expect(before).toMatchObject({ status: "automatic-agent-ready", manualInputs: 0, features: 1, tools: 7 });
    const identity = JSON.parse(readFileSync(deviceFile, "utf8"));
    await app.close();app = undefined;
    const second = await launch();app = second.app;
    const after = await probe();
    expect(after).toMatchObject({ status: "automatic-agent-ready", pcId: before.pcId, deviceId: before.deviceId,
      installationId: before.installationId, manualInputs: 0, features: 0, tools: 7 });
    expect(after.sessionUrl).not.toBe(before.sessionUrl);
    expect(after.sessionId).not.toBe(before.sessionId);
    const saved = JSON.parse(readFileSync(deviceFile, "utf8"));
    expect(saved.credential === identity.credential).toBe(true);
    expect(saved.logicalClientId).toBe(identity.logicalClientId);
    const devices = JSON.parse(readFileSync(path.join(profile, "session-devices/devices.json"), "utf8"));
    expect(devices.devices).toHaveLength(1);
    expect(devices.devices[0].name).toBe("Hermes Kreoda MCP");
    await testInfo.attach("automatic-agent-port-migration", { body: JSON.stringify({ before, after }), contentType: "application/json" });
  } finally {
    if (child && child.exitCode === null) child.kill();
    await app?.close();
    const parent = realpathSync(os.tmpdir()), target = realpathSync(profile);
    if (path.dirname(target).toLowerCase() !== parent.toLowerCase() || !path.basename(target).startsWith("kreoda-agent-auto-e2e-"))
      throw new Error("invalid isolated agent cleanup target");
    rmSync(target, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
  }
});
