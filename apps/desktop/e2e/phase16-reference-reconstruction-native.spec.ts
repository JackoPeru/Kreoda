import { test, expect, _electron as electron, type Page } from "@playwright/test";
import { CommandType, frameMessage } from "@kreoda/protocol";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { MAIN, HERE, hideForBackgroundE2E, openProject, runBar, snapOf } from "./helpers";

type NativePoint = { id: string; x: number; y: number; fixed?: boolean };
type NativeConstraint = { id: string; kind: string; refs: string[]; value?: number };
type NativeSketchModel = { points: NativePoint[]; constraints: NativeConstraint[] };

let requestId = 0;
async function nativeCall(page: Page, type: number, fields: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const framed = frameMessage(Buffer.from(JSON.stringify({
    protocolVersion: 1, requestId: `reference-native-${++requestId}`,
    documentId: "doc-phase1", type, ...fields,
  })));
  const response = await page.evaluate(payload => window.kreoda.invoke(payload),
    Buffer.from(framed).toString("base64"));
  return JSON.parse(Buffer.from(response, "base64").toString("utf8")) as Record<string, any>;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve local HermesBridge port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

async function nativeSketch(page: Page, sketchId: string, widthMm: number, heightMm: number): Promise<void> {
  // Read back the solver-committed native model, not the originating .NET JSON or renderer cache.
  const result = await nativeCall(page, CommandType.RequestSketch, { featureId: sketchId });
  const model = result.sketch?.model as NativeSketchModel | undefined;
  expect(model, "Native RequestSketch must return the solver-persisted model").toBeDefined();
  expect(model!.points).toHaveLength(4);
  const points = new Map(model!.points.map(p => [p.id, p]));
  const p0 = points.get("p0"), p1 = points.get("p1");
  const p2 = points.get("p2"), p3 = points.get("p3");
  for (const point of [p0, p1, p2, p3]) expect(point).toBeDefined();
  // The source has only scale calibration; pixel LeftPx/TopPx do not define a CAD frame.
  expect(p0).toMatchObject({ x: 0, y: 0, fixed: true });
  expect(Math.hypot(p1!.x - p0!.x, p1!.y - p0!.y)).toBeCloseTo(widthMm, 6);
  expect(Math.hypot(p2!.x - p1!.x, p2!.y - p1!.y)).toBeCloseTo(heightMm, 6);
  expect(p1!.y).toBeCloseTo(p0!.y, 6);
  expect(p2!.x).toBeCloseTo(p1!.x, 6);
  expect(p3!.y).toBeCloseTo(p2!.y, 6);
  expect(p3!.x).toBeCloseTo(p0!.x, 6);

  const constraints = model!.constraints;
  expect(constraints, "All six .NET-generated constraints must survive native solve").toHaveLength(6);
  expect(constraints.map(c => [c.id, c.kind, c.refs])).toEqual([
    ["edge-horizontal-0", "horizontal", ["l0"]],
    ["edge-vertical-1", "vertical", ["l1"]],
    ["edge-horizontal-2", "horizontal", ["l2"]],
    ["edge-vertical-3", "vertical", ["l3"]],
    ["measured-width-mm", "distance", ["p0", "p1"]],
    ["measured-height-mm", "distance", ["p1", "p2"]],
  ]);
  expect(constraints[4]!.value).toBeCloseTo(widthMm, 6);
  expect(constraints[5]!.value).toBeCloseTo(heightMm, 6);
}

test("real OCCT reference sketch: six calibrated constraints, dimension edit, Undo and ICAD reopen", async () => {
  test.setTimeout(180000);
  const source = path.resolve(HERE, "../../../clients/session-dotnet/src/Kreoda.ModelingAgent/ReferenceReconstruction.cs");
  const bridgeDll = path.resolve(HERE, "../../../clients/session-dotnet/tools/Kreoda.HermesBridge/bin/Release/net8.0/Kreoda.HermesBridge.dll");
  const probeDll = path.resolve(HERE, "../../../clients/session-dotnet/probes/Kreoda.McpProbe/bin/Release/net8.0/Kreoda.McpProbe.dll");
  // Probe uses Release output, not the already-tested Debug assemblies. Fail closed on stale Release.
  for (const executable of [bridgeDll, probeDll]) {
    expect(existsSync(executable), `Required .NET Release binary not built: ${executable}`).toBe(true);
    const modelingDll = path.join(path.dirname(executable), "Kreoda.ModelingAgent.dll");
    expect(existsSync(modelingDll), `Missing Release ModelingAgent dependency: ${modelingDll}`).toBe(true);
    expect(statSync(modelingDll).mtimeMs, `Stale Release ModelingAgent: rebuild ${executable}`)
      .toBeGreaterThanOrEqual(statSync(source).mtimeMs);
  }
  // The workspace is nested one directory deeper in the local worktree than
  // in GitHub Actions. Use the OS temp directory, not a fixed parent count.
  const tempRoot = os.tmpdir();
  const profile = mkdtempSync(path.join(tempRoot, "kreoda-reference-constrained-"));
  const localEnv = { ...process.env, TEMP: tempRoot, TMP: tempRoot, TMPDIR: tempRoot };
  const app = await electron.launch({ executablePath: createRequire(import.meta.url)("electron") as string,
    args: [MAIN, "--no-sandbox", "--lang=en-US", `--user-data-dir=${profile}`],
    env: { ...localEnv, KREODA_BACKGROUND_TEST: "1",
      KREODA_SESSION_PORT: "", KREODA_SESSION_TOKEN: "", KREODA_RECOVERY_DIR: profile } });
  let bridge: ReturnType<typeof spawn> | undefined;
  try {
    const page = await app.firstWindow();
    await hideForBackgroundE2E(app);
    await expect.poll(() => page.evaluate(() => window.kreoda.coreInfo().then(i => i.running))).toBe(true);
    const kernel = await nativeCall(page, CommandType.GetCoreInfo);
    expect(kernel.occtVersion).toBe("8.0.1-native");
    const listener = await page.evaluate(() => window.kreoda.sessionEnable("127.0.0.1", 0));
    const sessionPort = listener.listener?.port;
    expect(sessionPort).toBeGreaterThan(0);
    const pairing = await page.evaluate(() => window.kreoda.sessionPair());
    const bridgePort = await freePort();
    // HermesBridge is checked locally for health; this existing McpProbe scenario
    // executes generated commands over an authenticated PrivateCadConnection.
    // Its name does not imply that generated commands traverse HTTP /mcp.
    bridge = spawn("dotnet", [bridgeDll], { windowsHide: true, env: { ...localEnv,
      KREODA_HERMES_BRIDGE_URL: `http://127.0.0.1:${bridgePort}`,
      KREODA_CAD_SESSION_URL: `ws://127.0.0.1:${sessionPort}/`,
      KREODA_CAD_PAIR: pairing.token, KREODA_CAD_DEVICE_FILE: path.join(profile, "mcp-device.json"),
      KREODA_HERMES_CONFIG: "", KREODA_VOICE_TOKEN: "" } });
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${bridgePort}/health`)).ok; } catch { return false; }
    }, { timeout: 30000 }).toBe(true);
    const proof = await new Promise<{
      scenario: string; status: string; featureId: string; revision: number;
      volumeMm3: number; calibrationMmPerPixel: number; rollbackVerified: boolean;
    }>((resolve, reject) => {
      const child = spawn("dotnet", [probeDll], { windowsHide: true, env: { ...localEnv,
        KREODA_MCP_PROBE_SCENARIO: "native-reference-reconstruction",
        KREODA_MCP_PROBE_URL: `http://127.0.0.1:${bridgePort}/mcp`,
        KREODA_CAD_SESSION_URL: `ws://127.0.0.1:${sessionPort}/`,
        KREODA_CAD_PAIR: pairing.token, KREODA_CAD_DEVICE_FILE: path.join(profile, "approval-device.json") } });
      let out = "", errors = "";
      child.stdout.on("data", b => out += String(b));child.stderr.on("data", b => errors += String(b));
      const timer = setTimeout(() => { child.kill();reject(new Error("Generated native probe timed out")); }, 45000);
      child.once("error", reject);child.once("exit", code => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error(errors || out));
        else { try { resolve(JSON.parse(out.trim())); } catch (error) { reject(error); } }
      });
    });
    expect(proof).toMatchObject({
      scenario: "native-reference-reconstruction", status: "committed",
      calibrationMmPerPixel: 0.5, rollbackVerified: true,
    });
    expect(proof.volumeMm3).toBeCloseTo(25600, 2);
    await expect.poll(async () => (await snapOf(page)).revision).toBe(proof.revision);
    expect((await snapOf(page)).bodies.find(b => b.id === proof.featureId)?.volumeMm3).toBeCloseTo(25600, 2);
    const initial = await snapOf(page);
    expect(initial.sketches, "Probe must create exactly one native editable sketch").toHaveLength(1);
    const sketchId = initial.sketches[0]!.id;
    await nativeSketch(page, sketchId, 80, 40);

    if (await page.getByTestId("home-new-project").isVisible()) await page.getByTestId("home-new-project").click();
    await page.evaluate(id => (window as unknown as {
      __kreoda_test: { openSketch: (featureId: string) => unknown };
    }).__kreoda_test.openSketch(id), sketchId);
    const widthDimension = page.getByLabel("dist p0–p1", { exact: true });
    await expect(widthDimension).toBeVisible();
    await expect(widthDimension).toHaveValue("80");
    await widthDimension.fill("90");
    await widthDimension.press("Enter");
    await expect.poll(async () => (await snapOf(page)).bodies.find(b => b.id === proof.featureId)?.volumeMm3,
      { timeout: 30000 }).toBeCloseTo(28800, 2);
    await nativeSketch(page, sketchId, 90, 40);
    await page.getByRole("button", { name: "Done" }).click();

    const archive = path.join(profile, "generated.icad");
    await page.evaluate(file => (window as unknown as { __kreoda_test: { saveIcad: (path: string) => Promise<unknown> } }).__kreoda_test.saveIcad(file), archive);
    await page.evaluate(file => (window as unknown as { __kreoda_test: { openIcad: (path: string) => Promise<unknown> } }).__kreoda_test.openIcad(file), archive);
    await expect.poll(async () => (await snapOf(page)).bodies.find(b => b.id === proof.featureId)?.volumeMm3).toBeCloseTo(28800, 2);
    await nativeSketch(page, sketchId, 90, 40);
    // Edit the second native distance after reopening. Undo must restore the 90x40 saved baseline.
    await page.evaluate(id => (window as unknown as {
      __kreoda_test: { openSketch: (featureId: string) => unknown };
    }).__kreoda_test.openSketch(id), sketchId);
    const heightDimension = page.getByLabel("dist p1–p2", { exact: true });
    await expect(heightDimension).toBeVisible();
    await expect(heightDimension).toHaveValue("40");
    await heightDimension.fill("50");
    await heightDimension.press("Enter");
    await expect.poll(async () => (await snapOf(page)).bodies.find(b => b.id === proof.featureId)?.volumeMm3,
      { timeout: 30000 }).toBeCloseTo(36000, 2);
    await nativeSketch(page, sketchId, 90, 50);
    await page.getByRole("button", { name: "Done" }).click();
    await runBar(page, "undo");
    await expect.poll(async () => (await snapOf(page)).bodies.find(b => b.id === proof.featureId)?.volumeMm3).toBeCloseTo(28800, 2);
    await nativeSketch(page, sketchId, 90, 40);

    await openProject(page);
    await page.getByTestId(`object-tree-${proof.featureId}`).click();
    await runBar(page, "set distanceMm 8.8");
    await expect.poll(async () => (await snapOf(page)).bodies.find(b => b.id === proof.featureId)?.volumeMm3).toBeCloseTo(31680, 2);
    await runBar(page, "undo");
    await expect.poll(async () => (await snapOf(page)).bodies.find(b => b.id === proof.featureId)?.volumeMm3).toBeCloseTo(28800, 2);
    await nativeSketch(page, sketchId, 90, 40);
  } finally { bridge?.kill();await app.close(); }
});



