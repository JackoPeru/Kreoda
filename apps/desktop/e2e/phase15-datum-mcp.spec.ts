import { test, expect, _electron as electron } from "@playwright/test";
import { CommandType, frameMessage } from "@kreoda/protocol";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, HERE, snapOf } from "./helpers";

test.use({ trace: "off" });

let queryId = 0;

async function nativeCall(page: import("@playwright/test").Page, type: number, fields: Record<string, unknown> = {}) {
  const frame = frameMessage(Buffer.from(JSON.stringify({
    protocolVersion: 1, requestId: `phase15-datum-mcp-${++queryId}`, documentId: "doc-phase1", type, ...fields,
  })));
  const response = await page.evaluate((payload) => window.kreoda.invoke(payload), Buffer.from(frame).toString("base64"));
  return JSON.parse(Buffer.from(response, "base64").toString("utf8")) as Record<string, any>;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a local bridge port");
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
      !path.basename(target).startsWith("kreoda-phase15-datum-mcp-")) {
    throw new Error("Refusing to remove profile outside its isolated temp directory");
  }
  rmSync(target, { recursive: true, force: true });
}

test("official MCP creates native datum, supported sketch and solid in one Desktop Undo group", async () => {
  test.setTimeout(180000);
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-phase15-datum-mcp-"));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let bridge: ReturnType<typeof spawn> | undefined;
  let probe: ReturnType<typeof spawn> | undefined;
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
    await expect.poll(() => window.evaluate(() => window.kreoda.coreInfo().then((info) => info.running))).toBe(true);
    const kernel = await nativeCall(window, CommandType.GetCoreInfo);
    expect(kernel.occtVersion).toBe("8.0.1-native");
    const initial = await snapOf(window);
    expect(initial.datums ?? []).toHaveLength(0);
    expect(initial.sketches).toHaveLength(0);
    expect(initial.bodies).toHaveLength(0);

    const listener = await window.evaluate(() => window.kreoda.sessionEnable("127.0.0.1", 0));
    expect(listener.listener?.port).toBeGreaterThan(0);
    const pairing = await window.evaluate(() => window.kreoda.sessionPair());
    const bridgeEnv = {
      ...process.env,
      KREODA_HERMES_BRIDGE_URL: `http://127.0.0.1:${bridgePort}`,
      KREODA_CAD_SESSION_URL: `ws://127.0.0.1:${listener.listener!.port}/`,
      KREODA_CAD_PAIR: pairing.token,
      KREODA_CAD_DEVICE_FILE: path.join(profile, "mcp-device.json"),
      KREODA_HERMES_CONFIG: "",
      KREODA_VOICE_TOKEN: "",
    };
    const secrets = Object.entries(bridgeEnv)
      .filter(([name, value]) => value && /token|key|secret|password|pair|auth/i.test(name) && value.length >= 4)
      .map(([, value]) => value as string)
      .sort((a, b) => b.length - a.length);
    const redact = (value: string) => secrets.reduce((text, secret) => text.replaceAll(secret, "[redacted]"), value);
    let bridgeExit: string | undefined;
    let bridgeStderr = "";
    bridge = spawn("dotnet", [path.resolve(HERE, "../../../clients/session-dotnet/tools/Kreoda.HermesBridge/bin/Release/net8.0/Kreoda.HermesBridge.dll")], {
      windowsHide: true, env: bridgeEnv,
    });
    bridge.stderr?.on("data", (chunk) => { bridgeStderr = (bridgeStderr + String(chunk)).slice(-4000); });
    bridge.once("error", (error) => { bridgeExit = `spawn error: ${error.message}`; });
    bridge.once("exit", (code, signal) => { bridgeExit = `exit code=${code ?? "null"} signal=${signal ?? "none"}`; });
    const bridgeUrl = `http://127.0.0.1:${bridgePort}`;
    try {
      await expect.poll(async () => {
        if (bridgeExit) return false;
        try { return (await fetch(`${bridgeUrl}/health`)).ok; } catch { return false; }
      }, { timeout: 30000, intervals: [100, 250, 500, 1000] }).toBe(true);
    } catch {
      const safeStderr = redact(bridgeStderr).trim();
      throw new Error(["Local HermesBridge did not become healthy", bridgeExit ?? "process running", safeStderr].filter(Boolean).join("; "));
    }

    const probeDll = path.resolve(HERE, "../../../clients/session-dotnet/probes/Kreoda.McpProbe/bin/Release/net8.0/Kreoda.McpProbe.dll");
    const result = await new Promise<{ stdout: string; exitCode: number | null }>((resolve, reject) => {
      probe = spawn("dotnet", [probeDll], {
        windowsHide: true,
        env: { ...process.env, KREODA_MCP_PROBE_URL: `${bridgeUrl}/mcp`, KREODA_MCP_PROBE_SCENARIO: "datum" },
      });
      let out = "", errors = "", settled = false;
      const timer = setTimeout(() => {
        probe?.kill(); settled = true; reject(new Error("Official datum MCP probe timed out after 45s"));
      }, 45000);
      probe.stdout?.on("data", (chunk) => { out = (out + String(chunk)).slice(-65536); });
      probe.stderr?.on("data", (chunk) => { errors = (errors + String(chunk)).slice(-4000); });
      probe.once("error", (error) => {
        clearTimeout(timer); settled = true; reject(new Error(`Official datum MCP probe spawn failed: ${error.message}`));
      });
      probe.once("close", (code) => {
        clearTimeout(timer);
        if (settled) return;
        if (code !== 0 && !out.trim().startsWith("{")) reject(new Error(`Official datum MCP probe exited ${code}: ${redact(errors).trim()}`));
        else resolve({ stdout: out.trim(), exitCode: code });
      });
    });
    const proof = JSON.parse(result.stdout) as {
      scenario: string;
      status: string;
      passed: string[];
      commandMetadata: { id: string; nativeType: number; creation: { fixedCount: number } }[];
      featureIds: { plane: string; sketch: string; solid: string };
      finalRevision: number;
      volumeMm3: number;
      solidCount: number;
      bboxMm: number[];
      datum: Record<string, any>;
      sketch: Record<string, any>;
      nativeValidation?: Record<string, any>;
      measurements?: unknown;
    };
    if (result.exitCode !== 0) {
      const report = path.join(profile, "datum-mcp-red.json");
      writeFileSync(report, JSON.stringify({ ...proof, kernel: kernel.occtVersion, desktopEmptyBeforeRequest: true,
        probeExitCode: result.exitCode, screenshots: 0 }, null, 2));
      await test.info().attach("native-datum-mcp-red", { contentType: "application/json", path: report });
    }
    expect(proof.status, JSON.stringify(proof.nativeValidation ?? proof.measurements)).toBe("committed");
    expect(result.exitCode).toBe(0);
    expect(proof.scenario).toBe("datum");
    expect(proof.passed).toContain("official-mcp-native-datum-sketch-solid-transaction");
    expect(proof.commandMetadata.map(({ nativeType }) => nativeType)).toEqual([31, 32, 33, 34, 35]);
    const { plane: datumId, sketch: sketchId, solid: solidId } = proof.featureIds;
    for (const id of [datumId, sketchId, solidId]) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(new Set([datumId, sketchId, solidId]).size).toBe(3);
    expect(proof.volumeMm3).toBeCloseTo(35000, 2);
    expect(proof.solidCount).toBe(1);
    expect(proof.bboxMm[2]).toBeCloseTo(24, 6);
    expect(proof.bboxMm[5]).toBeCloseTo(31, 6);

    await expect.poll(async () => (await snapOf(window)).revision).toBe(proof.finalRevision);
    const committed = await snapOf(window);
    expect(committed.datums?.find((datum) => datum.featureId === datumId)).toMatchObject({
      kind: "DatumPlane", status: "ok",
      definition: { type: "offset", base: { type: "principal", planeKind: "XY" }, offsetMm: 24 },
      resolved: { originMm: [0, 0, 24], normal: [0, 0, 1] },
    });
    expect(committed.sketches.find((sketch) => sketch.id === sketchId)).toMatchObject({
      supportRef: datumId,
      plane: { origin: [0, 0, 24], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
      points: 4,
    });
    expect(committed.bodies.find((body) => body.id === solidId)).toMatchObject({ type: "Extrude", volumeMm3: 35000 });
    const nativeBounds = await nativeCall(window, CommandType.RequestSessionQuery, {
      method: "getBoundingBox", params: { featureId: solidId },
    });
    expect(nativeBounds.status).toBe("ok");
    expect(nativeBounds.result.solidCount).toBe(1);
    expect(nativeBounds.result.volumeMm3).toBeCloseTo(35000, 2);
    expect(nativeBounds.result.bboxMm[2]).toBeCloseTo(24, 6);
    expect(nativeBounds.result.bboxMm[5]).toBeCloseTo(31, 6);

    await window.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => {
      const snapshot = await snapOf(window);
      return [snapshot.datums?.length ?? 0, snapshot.sketches.length, snapshot.bodies.length];
    }).toEqual([0, 0, 0]);
    const undone = await nativeCall(window, CommandType.RequestSnapshot, { includeReferencePlanes: true });
    expect(undone.features).toHaveLength(0);
    expect(undone.sketches).toHaveLength(0);
    expect(undone.datums).toHaveLength(0);

    await expect(window.getByRole("button", { name: "Redo" })).toBeEnabled();
    await window.getByRole("button", { name: "Redo" }).click();
    await expect.poll(async () => {
      const snapshot = await snapOf(window);
      return [snapshot.datums?.some((datum) => datum.featureId === datumId) ?? false,
        snapshot.sketches.some((sketch) => sketch.id === sketchId), snapshot.bodies.some((body) => body.id === solidId)];
    }).toEqual([true, true, true]);
    const redone = await snapOf(window);
    expect(redone.datums?.find((datum) => datum.featureId === datumId)).toMatchObject({
      kind: "DatumPlane", status: "ok", resolved: { originMm: [0, 0, 24], normal: [0, 0, 1] },
    });
    expect(redone.sketches.find((sketch) => sketch.id === sketchId)).toMatchObject({
      supportRef: datumId,
      plane: { origin: [0, 0, 24], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
    });
    expect(redone.bodies.find((body) => body.id === solidId)).toMatchObject({ type: "Extrude", volumeMm3: 35000 });
    const redoneNative = await nativeCall(window, CommandType.RequestSnapshot, { includeReferencePlanes: true });
    expect(redoneNative.features.map((feature: { featureId: string }) => feature.featureId)).toContain(solidId);
    expect(redoneNative.sketches.map((sketch: { featureId: string; supportRef: string; plane: unknown }) => sketch.featureId)).toContain(sketchId);
    expect(redoneNative.datums.map((datum: { featureId: string }) => datum.featureId)).toContain(datumId);

    const report = path.join(profile, "datum-mcp-proof.json");
    writeFileSync(report, JSON.stringify({ ...proof, kernel: kernel.occtVersion, desktopObserved: true,
      oneUndoRestoredEmptyDocument: true, redoRestoredOriginalIdsAndFrame: true, screenshots: 0 }, null, 2));
    await test.info().attach("native-datum-mcp-proof", { contentType: "application/json", path: report });
  } finally {
    await stopChild(probe);
    await stopChild(bridge);
    await app?.close().catch(() => {});
    removeProfile(profile);
  }
});
