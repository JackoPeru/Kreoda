import { test, expect, _electron as electron } from "@playwright/test";
import { CommandType, frameMessage, PROTOCOL_VERSION } from "@kreoda/protocol";
import { spawn } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import { boot, HERE } from "./helpers";

test.use({ trace: "off" });

let queryId = 0;

async function nativeCall(page: import("@playwright/test").Page, type: number, fields: Record<string, unknown> = {}) {
  const requestId = `phase16-projection-${++queryId}`;
  const frame = frameMessage(Buffer.from(JSON.stringify({
    protocolVersion: PROTOCOL_VERSION, requestId, documentId: "doc-phase1", type, ...fields,
  })));
  const response = await page.evaluate((payload) => window.kreoda.invoke(payload), Buffer.from(frame).toString("base64"));
  const parsed = JSON.parse(Buffer.from(response, "base64").toString("utf8")) as Record<string, any>;
  expect(parsed.requestId).toBe(requestId);
  expect(parsed.status, parsed.errorMessage ?? "native command failed").toBe("ok");
  return parsed;
}

function projectionOf(reply: Record<string, any>): Record<string, any> {
  return (reply.projection ?? reply.result?.projection ?? reply.result ?? reply) as Record<string, any>;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a local port");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function stopChild(child?: ReturnType<typeof spawn>): Promise<void> {
  if (!child || child.exitCode !== null) return;
  try { child.kill(); } catch { return; }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5000);
    child.once("close", () => { clearTimeout(timer); resolve(); });
  });
}

function removeProfile(profile: string): void {
  const root = realpathSync(os.tmpdir());
  const target = realpathSync(profile);
  const relative = path.relative(root, target);
  if (!relative || path.isAbsolute(relative) || path.dirname(relative) !== "." ||
      !path.basename(target).startsWith("kreoda-phase16-projection-")) {
    throw new Error("Refusing to remove a profile outside its isolated temp directory");
  }
  rmSync(target, { recursive: true, force: true });
}

function textOf(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

/** For one real managed-client txnCommit, drop the relay acknowledgement after commit. */
class LostCommitAckProxy {
  private readonly server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  private dropped = false;

  constructor(private readonly upstreamUrl: string, private readonly signalFile: string) {}

  async start(): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("listening", resolve);
      this.server.once("error", reject);
    });
    this.server.on("connection", (client) => {
      const upstream = new WebSocket(this.upstreamUrl);
      const queued: { data: RawData; binary: boolean }[] = [];
      let pendingCommit: { requestId: string; operationId?: string } | undefined;
      client.on("message", (data, binary) => {
        if (!binary) {
          try {
            const message = JSON.parse(textOf(data)) as { method?: unknown; requestId?: unknown; operationId?: unknown };
            if (message.method === "txnCommit" && typeof message.requestId === "string" && !this.dropped) {
              pendingCommit = { requestId: message.requestId,
                ...(typeof message.operationId === "string" ? { operationId: message.operationId } : {}) };
            }
          } catch { /* Forward all protocol text unchanged. */ }
        }
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
        else queued.push({ data, binary });
      });
      upstream.on("open", () => {
        for (const item of queued.splice(0)) upstream.send(item.data, { binary: item.binary });
      });
      upstream.on("message", (data, binary) => {
        if (!binary && pendingCommit && !this.dropped) {
          try {
            const message = JSON.parse(textOf(data)) as { requestId?: unknown };
            if (message.requestId === pendingCommit.requestId) {
              this.dropped = true;
              writeFileSync(this.signalFile, JSON.stringify({ ...pendingCommit, response: message }));
              pendingCommit = undefined;
              return;
            }
          } catch { /* Forward unrecognized protocol text unchanged. */ }
        }
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
      });
      client.on("close", () => { if (upstream.readyState < WebSocket.CLOSING) upstream.close(); });
      upstream.on("close", () => { if (client.readyState < WebSocket.CLOSING) client.close(); });
      client.on("error", () => { if (upstream.readyState < WebSocket.CLOSING) upstream.close(); });
      upstream.on("error", () => { if (client.readyState < WebSocket.CLOSING) client.close(); });
    });
    const address = this.server.address() as AddressInfo | null;
    if (!address) throw new Error("Lost-ack proxy did not bind a local port");
    return `ws://127.0.0.1:${address.port}/`;
  }

  async close(): Promise<void> {
    for (const client of this.server.clients) client.terminate();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

async function runProbe(probeDll: string, environment: Record<string, string>): Promise<Record<string, any>> {
  const child = spawn("dotnet", [probeDll], { windowsHide: true, env: environment });
  let stdout = "", stderr = "", exitCode: number | null = null;
  const exit = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Projection MCP probe timed out after 90s"));
    }, 90000);
    child.stdout?.on("data", (chunk) => { stdout = (stdout + String(chunk)).slice(-131072); });
    child.stderr?.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-8000); });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", (code) => { clearTimeout(timeout); exitCode = code; resolve(); });
  });
  await exit;
  if (exitCode !== 0) throw new Error(`Projection MCP probe exited ${exitCode}: ${stderr.trim()} ${stdout.trim()}`);
  const outputLine = stdout.trim().split(/\r?\n/).reverse().find((line) => line.startsWith("{"));
  if (!outputLine) throw new Error(`Projection MCP probe returned no JSON proof: ${stderr.trim()} ${stdout.trim()}`);
  return JSON.parse(outputLine) as Record<string, any>;
}

test("native projection, repair and lost-ack replay stay coherent through hidden Desktop and official MCP", async () => {
  test.setTimeout(300000);
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-phase16-projection-"));
  const healthyFile = path.join(profile, "projection-healthy.icad");
  const brokenFile = path.join(profile, "projection-broken.icad");
  const droppedAck = path.join(profile, "lost-commit-ack.json");
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let bridge: ReturnType<typeof spawn> | undefined;
  let probeDll = "";
  let proxy: LostCommitAckProxy | undefined;
  let bridgeExit: string | undefined;
  let bridgeStderr = "";
  const secrets: string[] = [];
  const redact = (value: string) => secrets.reduce((text, secret) => text.replaceAll(secret, "[redacted]"), value);
  try {
    const bridgePort = await freePort();
    const { app: launched, window } = await boot({
      ...process.env,
      KREODA_BACKGROUND_TEST: "1",
      KREODA_SESSION_PORT: "",
      KREODA_SESSION_TOKEN: "",
      KREODA_RECOVERY_DIR: profile,
    }, [`--user-data-dir=${profile}`]);
    app = launched;

    await expect.poll(() => window.evaluate(() => globalThis.window.kreoda.coreInfo().then((info) => info.running))).toBe(true);
    const kernel = await nativeCall(window, CommandType.GetCoreInfo);
    expect(kernel.occtVersion).toBe("8.0.1-native");
    const initial = await nativeCall(window, CommandType.RequestSnapshot, { includeReferencePlanes: true });
    expect(initial.features).toHaveLength(0);
    expect(initial.sketches).toHaveLength(0);

    const listener = await window.evaluate(() => globalThis.window.kreoda.sessionEnable("127.0.0.1", 0));
    expect(listener.listener?.port).toBeGreaterThan(0);
    const bridgePairing = await window.evaluate(() => globalThis.window.kreoda.sessionPair());
    const directSessionUrl = `ws://127.0.0.1:${listener.listener!.port}/`;
    const bridgeEnv = {
      ...process.env,
      KREODA_HERMES_BRIDGE_URL: `http://127.0.0.1:${bridgePort}`,
      KREODA_CAD_SESSION_URL: directSessionUrl,
      KREODA_CAD_PAIR: bridgePairing.token,
      KREODA_CAD_DEVICE_FILE: path.join(profile, "mcp-device.json"),
      KREODA_HERMES_CONFIG: "",
      KREODA_VOICE_TOKEN: "",
    } as Record<string, string>;
    secrets.push(bridgePairing.token);
    bridge = spawn("dotnet", [path.resolve(HERE, "../../../clients/session-dotnet/tools/Kreoda.HermesBridge/bin/Release/net8.0/Kreoda.HermesBridge.dll")], {
      windowsHide: true, env: bridgeEnv,
    });
    bridge.stderr?.on("data", (chunk) => { bridgeStderr = (bridgeStderr + String(chunk)).slice(-5000); });
    bridge.once("error", (error) => { bridgeExit = `spawn error: ${error.message}`; });
    bridge.once("exit", (code, signal) => { bridgeExit = `exit code=${code ?? "null"} signal=${signal ?? "none"}`; });
    const bridgeUrl = `http://127.0.0.1:${bridgePort}`;
    await expect.poll(async () => {
      if (bridgeExit) return false;
      try { return (await fetch(`${bridgeUrl}/health`)).ok; } catch { return false; }
    }, { timeout: 30000, intervals: [100, 250, 500, 1000] }).toBe(true);

    probeDll = path.resolve(HERE, "../../../clients/session-dotnet/probes/Kreoda.McpProbe/bin/Release/net8.0/Kreoda.McpProbe.dll");
    const preflight = await runProbe(probeDll, {
      ...process.env,
      KREODA_MCP_PROBE_URL: `${bridgeUrl}/mcp`,
      KREODA_MCP_PROBE_SCENARIO: "mcp-preflight",
    } as Record<string, string>);
    expect(preflight).toMatchObject({ scenario: "mcp-preflight", status: "ready", tools: 7 });
    const firstPeerPair = await window.evaluate(() => globalThis.window.kreoda.sessionPair());
    secrets.push(firstPeerPair.token);
    proxy = new LostCommitAckProxy(directSessionUrl, droppedAck);
    const proxyUrl = await proxy.start();
    const creationProof = await runProbe(probeDll, {
      ...process.env,
      KREODA_MCP_PROBE_URL: `${bridgeUrl}/mcp`,
      KREODA_MCP_PROBE_SCENARIO: "projection",
      KREODA_CAD_SESSION_URL: proxyUrl,
      KREODA_MCP_SECOND_PAIR: firstPeerPair.token,
      KREODA_DROP_ACK_SIGNAL_FILE: droppedAck,
    } as Record<string, string>);
    expect(creationProof).toMatchObject({ scenario: "projection", status: "committed" });
    expect(creationProof.passed).toContain("same-id-analytic-source-edit-with-real-lost-ack-operation-replay");
    expect(creationProof.lostAcknowledgementError).toBe("CANCELLED");
    expect(creationProof.replayRevision).toBe(creationProof.editedRevision);
    expect(creationProof.volumeBeforeMm3).toBeCloseTo(Math.PI * 25 * 10, 2);
    expect(creationProof.volumeAfterMm3).toBeCloseTo(Math.PI * 36 * 10, 2);
    expect(creationProof.healthyVolumeMm3).toBeCloseTo(1000, 2);
    expect(creationProof.rollbackOwnerError).toBe("BUSY");
    expect(creationProof.projectedEdgeCount).toBeGreaterThan(0);
    expect(JSON.parse(readFileSync(droppedAck, "utf8")).operationId).toBeTruthy();
    await proxy.close();
    proxy = undefined;

    const ids = creationProof.featureIds as { source: string; target: string; solid: string; healthy: string; group: string };
    for (const id of [ids.source, ids.target, ids.solid, ids.healthy]) expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    const snapshot = await nativeCall(window, CommandType.RequestSnapshot, { includeReferencePlanes: true });
    expect(snapshot.revision).toBe(creationProof.editedRevision);
    const savedTarget = snapshot.sketches.find((sketch: any) => sketch.featureId === ids.target);
    expect(savedTarget.projectionGroups).toEqual(expect.arrayContaining([
      expect.objectContaining({ groupId: ids.group, status: "ok" }),
    ]));
    const directProjection = projectionOf(await nativeCall(window, CommandType.RequestSketchProjection, {
      featureId: ids.target, groupId: ids.group,
    }));
    expect(directProjection.geometryCurrent).toBe(true);
    expect(directProjection.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ groupId: ids.group, status: "ok" }),
    ]));

    // Save a healthy baseline before breaking the persistent source binding.
    await window.evaluate((file) => (window as unknown as {
      __kreoda_test: { saveIcad: (path: string) => Promise<unknown> };
    }).__kreoda_test.saveIcad(file), healthyFile);
    const archiveProof = await runProbe(probeDll, {
      ...process.env,
      KREODA_MCP_PROBE_SCENARIO: "projection-archive-break",
      KREODA_PROJECTION_HEALTHY_FILE: healthyFile,
      KREODA_PROJECTION_BROKEN_FILE: brokenFile,
    } as Record<string, string>);
    expect(archiveProof).toMatchObject({
      scenario: "projection-archive-break", status: "rewritten", replacementCount: 1,
      oldToken: "circle", newToken: "circlX", bindingUnchanged: true,
    });
    expect(archiveProof.xbfBytesBefore).toBe(archiveProof.xbfBytesAfter);
    expect(archiveProof.healthyArchiveSha256).not.toBe(archiveProof.brokenArchiveSha256);
    expect(archiveProof.healthyXbfSha256).not.toBe(archiveProof.brokenXbfSha256);

    // Reset through native CreateDocument, then load the byte-verified file
    // with the real OpenDocument path. The source sketch remains valid; only
    // its authored entity ID differs from the persisted projection binding.
    await nativeCall(window, CommandType.CreateDocument, {});
    await window.evaluate((file) => (window as unknown as {
      __kreoda_test: { openIcad: (path: string) => Promise<unknown> };
    }).__kreoda_test.openIcad(file), brokenFile);
    const loadedBroken = projectionOf(await nativeCall(window, CommandType.RequestSketchProjection, {
      featureId: ids.target, groupId: ids.group,
    }));
    expect(loadedBroken.geometryCurrent).toBe(false);
    expect(loadedBroken.status).toBe("unavailable");
    const loadedSource = await nativeCall(window, CommandType.RequestSketch, { featureId: ids.source });
    expect(loadedSource.geometryCurrent).toBe(true);
    expect(loadedSource.sketch.model.circles).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "circlX", r: 6 }),
      expect.objectContaining({ id: "spare", r: 2 }),
    ]));
    const loadedBrokenSnapshot = await nativeCall(window, CommandType.RequestSnapshot, { includeReferencePlanes: true });
    const secondRepairPair = await window.evaluate(() => globalThis.window.kreoda.sessionPair());
    secrets.push(secondRepairPair.token);
    const repairProof = await runProbe(probeDll, {
      ...process.env,
      KREODA_MCP_PROBE_URL: `${bridgeUrl}/mcp`,
      KREODA_MCP_PROBE_SCENARIO: "projection-repair",
      KREODA_CAD_SESSION_URL: directSessionUrl,
      KREODA_MCP_SECOND_PAIR: secondRepairPair.token,
      KREODA_PROJECTION_SOURCE_ID: ids.source,
      KREODA_PROJECTION_TARGET_ID: ids.target,
      KREODA_PROJECTION_SOLID_ID: ids.solid,
      KREODA_PROJECTION_HEALTHY_ID: ids.healthy,
      KREODA_PROJECTION_GROUP_ID: ids.group,
      KREODA_PROJECTION_SOURCE_ENTITY_ID: "circlX",
      KREODA_PROJECTION_EXPECTED_REVISION: String(loadedBrokenSnapshot.revision),
    } as Record<string, string>);
    expect(repairProof).toMatchObject({ scenario: "projection-repair", status: "committed" });
    expect(repairProof.passed).toContain("saved-broken-binding-is-unavailable-without-stale-volume-or-mesh");
    expect(repairProof.passed).toContain("official-mcp-repair-preserves-source-target-group-and-downstream-ids");
    expect(repairProof.staleMeasurementDenied).toBe(true);
    expect(repairProof.meshError).toBe("GEOMETRY_UNAVAILABLE");
    expect(repairProof.healthyVolumeMm3).toBeCloseTo(1000, 2);
    expect(repairProof.repairedVolumeMm3).toBeCloseTo(Math.PI * 36 * 10, 2);
    const repaired = projectionOf(await nativeCall(window, CommandType.RequestSketchProjection, {
      featureId: ids.target, groupId: ids.group,
    }));
    expect(repaired.geometryCurrent).toBe(true);
    expect(repaired.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ groupId: ids.group, status: "ok" }),
    ]));

    await window.getByRole("button", { name: "Undo" }).click();
    const undone = projectionOf(await nativeCall(window, CommandType.RequestSketchProjection, {
      featureId: ids.target, groupId: ids.group,
    }));
    expect(undone.geometryCurrent).toBe(false);
    expect(undone.status).toBe("unavailable");
    const undoneSnapshot = await nativeCall(window, CommandType.RequestSnapshot, { includeReferencePlanes: true });
    const undoneSolid = undoneSnapshot.features.find((feature: any) => feature.featureId === ids.solid);
    expect(undoneSolid.status).toBe("unavailable");
    expect(undoneSolid).not.toHaveProperty("volumeMm3");

    const report = path.join(profile, "projection-mcp-proof.json");
    writeFileSync(report, JSON.stringify({
      kernel: kernel.occtVersion,
      created: creationProof,
      persistedBindingBreak: archiveProof,
      repaired: repairProof,
      persistedBrokenProjection: loadedBroken,
      undoRestoredBrokenProjection: undone,
      backgroundWindowVerifiedAtLaunch: true,
      screenshots: 0,
    }, null, 2));
  } catch (error) {
    if (bridgeStderr.trim()) {
      const message = redact(bridgeStderr.trim());
      if (error instanceof Error) error.message += `; local bridge stderr: ${message}`;
    }
    throw error;
  } finally {
    await proxy?.close().catch(() => {});
    await stopChild(bridge);
    await app?.close().catch(() => {});
    try {
      const report = path.join(profile, "projection-mcp-proof.json");
      if (existsSync(report)) await test.info().attach("native-projection-mcp-proof", { contentType: "application/json", path: report });
      if (existsSync(healthyFile)) await test.info().attach("native-projection-healthy.icad", { contentType: "application/octet-stream", path: healthyFile });
      if (existsSync(brokenFile)) await test.info().attach("native-projection-broken.icad", { contentType: "application/octet-stream", path: brokenFile });
    } finally {
      removeProfile(profile);
    }
  }
});
