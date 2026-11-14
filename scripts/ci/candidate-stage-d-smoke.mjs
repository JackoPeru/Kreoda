// REAL exact-candidate StageD acceptance: packaged Electron + packaged OCCT,
// separately published HermesBridge, and a freshly built Release McpProbe.
// This is a NEW, GitHub-hosted-only smoke. Never run on the shared DSH host.
//
// After the existing pinned staging helper and a provenance-checked Release
// build of clients/session-dotnet/probes/Kreoda.McpProbe:
// node scripts/ci/candidate-stage-d-smoke.mjs \
//   --probe-sha256=<fresh-Release-McpProbe.dll-SHA256> \
//   --prime-stage-d-grant=PRIME_APPROVED_GITHUB_HOSTED_STAGE_D
//
// It does not invoke an LLM, rename binaries, mock CAD, or edit the original
// package, manifest, hosted workflow, normal user profile, or production source.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidence = path.join(root, ".artifacts", "kreoda-integrated-package-20261113");
const releaseId = "0.1.0-integrated-20261113-c211b2e01fb7-f003945f69bd-476eccda";
const extracted = path.join(evidence, "output", releaseId);
const desktop = path.join(extracted, "Kreoda-win32-x64");
const resources = path.join(desktop, "resources");
const bridgeDir = path.join(extracted, "Kreoda.HermesBridge-net8.0");
const exe = path.join(desktop, "Kreoda.exe");
const coreExe = path.join(resources, "kreoda-core.exe");
const appAsar = path.join(resources, "app.asar");
const bridgeExe = path.join(bridgeDir, "Kreoda.HermesBridge.exe");
const originalManifest = path.join(extracted, "release-manifest.json");
const hostedManifest = path.join(evidence, "hosted-smoke-manifest.json");
const probeDll = path.join(root, "clients", "session-dotnet", "probes",
  "Kreoda.McpProbe", "bin", "Release", "net8.0", "Kreoda.McpProbe.dll");
const requiredSha = Object.freeze({
  originalManifest: "2064d409a22f1e0020e90ac194e7d8ebb5813550316e5ced69b5dc72b8d88a66",
  combinedBundle: "036cff37ed0b5850926224cb0afc75a159a558897d77ffc1f74e314bccf85b1d",
  receipt: "b7520dcddb43e98eb82f147beec8f22279678e3e39c000cba70a1fbd887f8f7a",
  exe: "a09ee422ccf2c678db1b41ed3d2dbbcf987be1585e0a7cdbbc858321778a35b4",
  core: "f003945f69bdf04e7ab66ea1319b50e22723b5e716047e8dbb2f4e21dc3710b4",
  asar: "e22221c092c28f1c1ce9115c3e3ac883ea37fa1c903ef14cde55ff09ee01fdae",
  bridge: "e1d9cbe0a91480f1b1f608e499ede409ef5a97daa8e38ca30eb27817415f6af0",
});
const fail = message => { throw new Error("STAGE_D_BLOCKED: " + message); };
const assert = (ok, message) => { if (!ok) fail(message); };
const hexSha = value => typeof value === "string" && /^[a-f\d]{64}$/i.test(value);
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const within = (file, folder) => {
  const relative = path.relative(folder, file);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative);
};
const sha = file => {
  const hash = createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally { fs.closeSync(fd); }
  return hash.digest("hex");
};
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const regular = file => {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink(), "not an ordinary exact file: " + file);
  return stat;
};
const checkSha = (file, expected) => {
  regular(file);
  assert(hexSha(expected) && sha(file) === expected.toLowerCase(),
    "SHA256 differs for pinned file: " + file);
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(promise, ms, description) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error("TIMEOUT: " + description)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
async function until(fn, description, ms = 30_000, interval = 125) {
  const limit = Date.now() + ms;
  let last;
  do {
    try {
      const result = await bounded(Promise.resolve().then(fn), Math.min(5000, ms),
        description + " poll");
      if (result) return result;
    } catch (error) { last = error; }
    await delay(interval);
  } while (Date.now() < limit);
  fail("timed out waiting for " + description + (last ? " (" + last.message + ")" : ""));
}
function ps(script, timeout = 12_000) {
  const call = spawnSync("powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", windowsHide: true, timeout, maxBuffer: 256 * 1024 });
  assert(!call.error && call.status === 0, "Windows process ownership check failed closed");
  return call.stdout.trim();
}
function ownerGuard() {
  ps(`$foreign=Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq 8616 -or $_.Name -in @('Kreoda.exe','kreoda-core.exe','Kreoda.HermesBridge.exe') }; if ($foreign) { exit 73 }; 'OWNERS_CLEAR'`);
}
function processInfo(pid, expectedPath, parentPid) {
  assert(Number.isInteger(pid) && pid > 0, "missing owned process PID");
  const json = ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if (-not $p) { exit 43 }; $p | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress`);
  const found = JSON.parse(json);
  assert(found.ProcessId === pid && same(found.ExecutablePath ?? "", expectedPath) &&
    found.ParentProcessId === parentPid,
    "process tree / exact executable path differs for PID " + pid);
  return { pid, parentPid, executablePath: found.ExecutablePath };
}
async function waitProcessInfo(pid, expectedPath, parentPid) {
  return until(() => processInfo(pid, expectedPath, parentPid),
    "exact owned process identity " + pid, 8_000, 150);
}
function argsMap() {
  const args = process.argv.slice(2);
  assert(args.length === 2 && args.every(a => a.startsWith("--") && a.includes("=")),
    "requires exact --probe-sha256 and explicit --prime-stage-d-grant");
  const options = new Map(args.map(a => {
    const pivot = a.indexOf("=");
    return [a.slice(0, pivot), a.slice(pivot + 1)];
  }));
  assert(options.size === 2 &&
    options.get("--prime-stage-d-grant") === "PRIME_APPROVED_GITHUB_HOSTED_STAGE_D" &&
    hexSha(options.get("--probe-sha256")),
  "separate authorized GitHub-hosted StageD grant and actual Release probe SHA required");
  return options;
}
function preflight() {
  // No other host is an acceptable place to launch these image names.
  assert(process.platform === "win32" && process.arch === "x64" &&
    process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_ENVIRONMENT === "github-hosted" &&
    process.env.RUNNER_OS === "Windows" && same(process.env.GITHUB_WORKSPACE ?? "", root),
  "only exact working-directory GitHub-hosted Windows runner is accepted");
  const options = argsMap();
  ownerGuard();
  checkSha(originalManifest, requiredSha.originalManifest);
  const original = readJson(originalManifest);
  const staged = readJson(hostedManifest);
  assert(original.status === "PACKAGED_UNSMOKED_NOT_PROMOTED" && original.smokeRequired === true &&
    original.releaseId === releaseId && staged.releaseId === releaseId &&
    staged.hostedRunner === true &&
    staged.hostedReceiptSha256?.toLowerCase() === requiredSha.receipt &&
    staged.hostedOriginalManifestSha256?.toLowerCase() === requiredSha.originalManifest &&
    same(staged.portable ?? "", desktop) && same(staged.bridgePublished ?? "", bridgeDir) &&
    staged.zipSha256?.toLowerCase() === requiredSha.combinedBundle,
  "pinned extracted release and previously verified hosted staging not established");
  assert(original.nativeCore.sha256?.toLowerCase() === requiredSha.core &&
    original.packagedResources?.appAsarSha256?.toLowerCase() === requiredSha.asar &&
    original.bridge?.selfContained === false,
  "original real-OCCT / separately published Bridge manifest not authentic");
  for (const [file, expected] of [[exe, requiredSha.exe], [coreExe, requiredSha.core],
    [appAsar, requiredSha.asar], [bridgeExe, requiredSha.bridge]])
    checkSha(file, expected);
  for (const entry of original.bridge.publishedFiles ?? []) {
    assert(typeof entry.name === "string" && path.basename(entry.name) === entry.name,
      "unsafe Bridge manifest entry");
    checkSha(path.join(bridgeDir, entry.name), entry.sha256);
  }
  assert(original.bridge.publishedFiles.length === 35,
    "missing one or more separately published Bridge dependencies");
  checkSha(probeDll, options.get("--probe-sha256"));
  regular(path.join(path.dirname(probeDll), "Kreoda.ModelingAgent.dll"));
  regular(path.join(path.dirname(probeDll), "Kreoda.HermesBridge.dll"));
  regular(path.join(root, "apps", "desktop", "package.json"));
  return { probeSha256: options.get("--probe-sha256").toLowerCase(),
    originalManifestSha256: requiredSha.originalManifest, original, staged };
}
async function nextLoopbackPort() {
  const server = createServer();
  await bounded(new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  }), 3000, "allocate loopback port");
  const address = server.address();
  assert(address && typeof address === "object" && Number.isInteger(address.port),
    "invalid loopback port");
  await bounded(new Promise((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve())), 3000, "release loopback port");
  return address.port;
}
function frameRequest(type, fields = {}) {
  const json = Buffer.from(JSON.stringify({
    protocolVersion: 1, requestId: "hosted-stage-d-" + (++frameRequest.serial),
    documentId: "doc-phase1", type, ...fields,
  }));
  const framed = Buffer.allocUnsafe(json.length + 4);
  framed.writeUInt32LE(json.length, 0);
  json.copy(framed, 4);
  return framed.toString("base64");
}
frameRequest.serial = 0;
async function nativeCall(page, type, fields = {}) {
  const result = await bounded(page.evaluate(payload => window.kreoda.invoke(payload),
    frameRequest(type, fields)), 15_000, "native framed RequestSketch/GetCoreInfo");
  assert(typeof result === "string" && result.length < 2_000_000,
    "native response invalid/oversized");
  const response = JSON.parse(Buffer.from(result, "base64").toString("utf8"));
  assert(response && !response.error && response.success !== false,
    "native command returned error");
  return response;
}
function near(actual, expected, tolerance = 0.01) {
  assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    "measured native value differs: expected " + expected + ", got " + actual);
}
function checkSketch(model, width, height) {
  assert(model && Array.isArray(model.points) && model.points.length === 4 &&
    Array.isArray(model.constraints) && model.constraints.length === 6,
  "solver-persisted editable rectangle not returned");
  if (model.lines !== undefined)
    assert(Array.isArray(model.lines) && model.lines.length === 4,
      "native rectangle line identity count mismatch");
  const points = new Map(model.points.map(p => [p.id, p]));
  assert(points.size === 4 && ["p0", "p1", "p2", "p3"].every(id => points.has(id)),
    "native sketch point identities mismatch");
  const [p0, p1, p2, p3] = ["p0", "p1", "p2", "p3"].map(id => points.get(id));
  near(p0.x, 0, 1e-5); near(p0.y, 0, 1e-5);
  assert(p0.fixed === true, "calibration origin not constrained");
  near(Math.hypot(p1.x - p0.x, p1.y - p0.y), width, 1e-5);
  near(Math.hypot(p2.x - p1.x, p2.y - p1.y), height, 1e-5);
  near(p1.y, p0.y, 1e-5); near(p2.x, p1.x, 1e-5);
  near(p3.y, p2.y, 1e-5); near(p3.x, p0.x, 1e-5);
  const expected = [
    ["edge-horizontal-0", "horizontal", ["l0"]],
    ["edge-vertical-1", "vertical", ["l1"]],
    ["edge-horizontal-2", "horizontal", ["l2"]],
    ["edge-vertical-3", "vertical", ["l3"]],
    ["measured-width-mm", "distance", ["p0", "p1"]],
    ["measured-height-mm", "distance", ["p1", "p2"]],
  ];
  for (let i = 0; i < 6; i++) {
    const actual = model.constraints[i], [id, kind, refs] = expected[i];
    assert(actual.id === id && actual.kind === kind &&
      JSON.stringify(actual.refs) === JSON.stringify(refs),
    "native persisted sketch constraint #" + (i + 1) + " differs");
  }
  near(model.constraints[4].value, width, 1e-5);
  near(model.constraints[5].value, height, 1e-5);
  return { widthMm: width, heightMm: height, constraints: 6, fixedOrigin: true };
}
async function checkNativeSketch(page, sketchId, width, height) {
  const reply = await nativeCall(page, 17, { featureId: sketchId }); // CommandType.RequestSketch
  assert(reply.sketch?.model, "missing actual RequestSketch native model");
  return checkSketch(reply.sketch.model, width, height);
}
async function snapshot(page) {
  return bounded(page.evaluate(() => window.__kreoda_test.snapshot()), 10_000,
    "real Renderer/CAD snapshot");
}
async function checkVolume(page, featureId, expectedVolume) {
  const snap = await until(async () => {
    const value = await snapshot(page);
    const body = value?.bodies?.find(b => b.id === featureId);
    if (!body || !Number.isFinite(body.volumeMm3) ||
        Math.abs(body.volumeMm3 - expectedVolume) > 0.01 || body.triangles <= 0 ||
        body.geometryCurrent === false || body.status === "blocked") return null;
    return { revision: value.revision, volumeMm3: body.volumeMm3,
      triangles: body.triangles, geometryCurrent: body.geometryCurrent ?? null };
  }, "real OCCT B-Rep volume " + expectedVolume, 30_000);
  near(snap.volumeMm3, expectedVolume, 0.01);
  assert(Number.isInteger(snap.revision) && snap.revision >= 0,
    "invalid native document revision");
  return snap;
}
function readChild(child, ms, name) {
  return new Promise((resolve, reject) => {
    let stdout = "", stderr = "", finished = false;
    const timer = setTimeout(() => {
      if (!finished) { child.kill(); reject(Error(name + " timed out")); }
    }, ms);
    const append = (existing, data) => {
      const out = existing + String(data);
      assert(out.length < 256 * 1024, name + " stdout/stderr exceeded bound");
      return out;
    };
    child.stdout?.on("data", b => { try { stdout = append(stdout, b); } catch (error) {
      child.kill(); reject(error);
    } });
    child.stderr?.on("data", b => { try { stderr = append(stderr, b); } catch (error) {
      child.kill(); reject(error);
    } });
    child.once("error", error => { finished = true; clearTimeout(timer); reject(error); });
    child.once("exit", code => {
      finished = true; clearTimeout(timer);
      if (code !== 0) reject(Error(name + " exit " + code + " (stderr retained only in CI log on failure)"));
      else resolve({ stdout, stderr, exitCode: code });
    });
  });
}
async function runBar(page, command) {
  const input = page.getByTestId("command-input");
  await input.fill(command, { timeout: 5000 });
  await input.press("Enter", { timeout: 5000 });
  const preview = page.getByTestId("plan-preview");
  await preview.waitFor({ state: "visible", timeout: 8000 });
  await preview.getByRole("button", { name: /Run 1 step/ }).click({ timeout: 10_000 });
  await preview.waitFor({ state: "hidden", timeout: 50_000 });
  const failures = await page.getByText(/Stopped after|planning failed|execution failed/).allTextContents();
  assert(failures.length === 0, "command bar failed: " + command);
}
async function editDistance(page, sketchId, from, to, label) {
  await bounded(page.evaluate(id => window.__kreoda_test.openSketch(id), sketchId),
    10_000, "open solver-backed native sketch");
  const input = page.getByLabel(label, { exact: true });
  await input.waitFor({ state: "visible", timeout: 10_000 });
  assert((await input.inputValue()).trim() === String(from), "wrong current dimension " + label);
  await input.fill(String(to));
  await input.press("Enter");
}
async function verifyStageD(page, receipt, profile, probeDllHash, owned) {
  const details = await nativeCall(page, 1); // GetCoreInfo
  assert(details.occtVersion === "8.0.1-native", "real OCCT 8.0.1 core not detected");
  const listener = await bounded(page.evaluate(() => window.kreoda.sessionEnable("127.0.0.1", 0)),
    10_000, "enable private local CAD session");
  const port = listener?.listener?.port;
  assert(Number.isInteger(port) && port > 0 && port <= 65535,
    "no actual private loopback CAD relay");
  const pairing = await bounded(page.evaluate(() => window.kreoda.sessionPair()),
    10_000, "pair isolated private CAD session");
  assert(typeof pairing?.token === "string" && pairing.token.length > 8,
    "native local pairing token missing");
  const bridgePort = await nextLoopbackPort();
  const bridgeUrl = "http://127.0.0.1:" + bridgePort;
  const baseEnv = { ...process.env, KREODA_BACKGROUND_TEST: "1",
    TEMP: profile, TMP: profile, TMPDIR: profile, APPDATA: path.join(profile, "roaming"),
    LOCALAPPDATA: path.join(profile, "local"), KREODA_HERMES_CONFIG: "",
    KREODA_VOICE_TOKEN: "", KREODA_UPDATE_FEED: "", KREODA_UPDATE_PUBKEY: "",
    KREODA_CAD_SESSION_URL: "ws://127.0.0.1:" + port + "/",
    KREODA_CAD_PAIR: pairing.token };
  for (const key of ["KREODA_AUTOMATIC_LOOPBACK_TEST", "KREODA_SESSION_TOKEN",
    "KREODA_SESSION_HOST", "KREODA_SESSION_PORT"]) delete baseEnv[key];
  fs.mkdirSync(baseEnv.APPDATA, { recursive: true });
  fs.mkdirSync(baseEnv.LOCALAPPDATA, { recursive: true });
  const bridge = spawn(bridgeExe, [], { cwd: bridgeDir, env: { ...baseEnv,
    KREODA_HERMES_BRIDGE_URL: bridgeUrl,
    KREODA_CAD_DEVICE_FILE: path.join(profile, "bridge-device.json") },
  windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
  // Prevent a failed apphost spawn from surfacing as an unhandled event before
  // the bounded ownership/health checks can report the failure in the receipt.
  let bridgeSpawnError = null;
  bridge.on("error", error => { bridgeSpawnError = error; });
  owned.bridge = bridge;
  receipt.ownedBridgePid = bridge.pid ?? null;
  try {
    assert(bridge.pid > 0, "published Bridge could not start");
    await waitProcessInfo(bridge.pid, bridgeExe, process.pid);
    await until(async () => {
      assert(!bridgeSpawnError && bridge.exitCode === null && !bridge.killed,
        "published HermesBridge exited before health");
      try {
        const response = await fetch(bridgeUrl + "/health", { signal: AbortSignal.timeout(1500) });
        if (!response.ok) return false;
        const health = await response.json();
        return health?.service === "kreoda-hermes-bridge" &&
          health.mcp === true && health.voiceConfigured === false ? health : false;
      } catch { return false; }
    }, "isolated published Bridge /health", 30_000, 160);
    receipt.tests.push({ name: "published-exact-HermesBridge-loopback-health", pass: true,
      bridgeSha256: requiredSha.bridge, hostedPort: bridgePort,
      offline: true, voiceConfigured: false });

    const probe = spawn("dotnet", [probeDll], { cwd: path.dirname(probeDll), windowsHide: true,
      env: { ...baseEnv, KREODA_MCP_PROBE_SCENARIO: "native-reference-reconstruction",
        KREODA_MCP_PROBE_URL: bridgeUrl + "/mcp",
        KREODA_CAD_DEVICE_FILE: path.join(profile, "probe-device.json") },
      stdio: ["ignore", "pipe", "pipe"] });
    owned.probe = probe;
    receipt.ownedProbePid = probe.pid ?? null;
    const probeResult = readChild(probe, 45_000, "Release McpProbe");
    // The native probe might finish before the synchronous parent-path check.
    // Attach a rejection handler now, preserving rejection for the await below.
    void probeResult.catch(() => {});
    const dotnetExecutable = ps("(Get-Command dotnet.exe -ErrorAction Stop).Source");
    await waitProcessInfo(probe.pid, dotnetExecutable, process.pid);
    const { stdout } = await probeResult;
    const proof = JSON.parse(stdout.trim());
    assert(proof?.scenario === "native-reference-reconstruction" &&
      proof.status === "committed" && proof.rollbackVerified === true &&
      proof.sourceId === "calibrated-source-01" && proof.calibrationMmPerPixel === 0.5 &&
      typeof proof.featureId === "string" && proof.featureId.length > 0 &&
      Number.isInteger(proof.revision) && proof.revision > 0,
    "McpProbe did not commit the genuine calibrated StageD trial");
    near(proof.volumeMm3, 25_600, 0.01);
    const bodyAt80 = await checkVolume(page, proof.featureId, 25_600);
    assert(bodyAt80.revision === proof.revision,
      "Bridge PrivateCadConnection and packaged renderer revision differ");
    const initial = await snapshot(page);
    assert(initial.sketches?.length === 1 && initial.bodies?.length === 1,
      "McpProbe did not create exactly one editable sketch + OCCT solid");
    const sketchId = initial.sketches[0].id;
    receipt.tests.push({ name: "Release-McpProbe-PrivateCadConnection-rollback-and-commit",
      pass: true, probeSha256: probeDllHash, calibrationMmPerPixel: .5,
      rollbackVerified: true, featureId: proof.featureId,
      solver: await checkNativeSketch(page, sketchId, 80, 40), ...bodyAt80 });

    const home = page.getByTestId("home-new-project");
    if (await home.isVisible()) await home.click();
    await editDistance(page, sketchId, 80, 90, "dist p0–p1");
    const at90x40 = await checkVolume(page, proof.featureId, 28_800);
    await checkNativeSketch(page, sketchId, 90, 40);
    await page.getByRole("button", { name: "Done" }).click();
    receipt.tests.push({ name: "native-width-edit-80-to-90-while-height-40",
      pass: true, sketchId, widthMm: 90, heightMm: 40, ...at90x40 });

    const archive = path.join(profile, "generated-stage-d.icad");
    await bounded(page.evaluate(file => window.__kreoda_test.saveIcad(file), archive),
      30_000, "write genuine ICAD archive");
    assert(fs.existsSync(archive) && regular(archive).size > 4 &&
      fs.readFileSync(archive).readUInt32LE(0) === 0x04034b50,
    "native ICAD save is missing/non-ZIP");
    const archivedSha = sha(archive);
    await bounded(page.evaluate(file => window.__kreoda_test.openIcad(file), archive),
      30_000, "open genuine ICAD archive");
    const afterReopen = await checkVolume(page, proof.featureId, 28_800);
    await checkNativeSketch(page, sketchId, 90, 40);
    receipt.tests.push({ name: "native-ICAD-save-reopen-90x40", pass: true,
      icadSha256: archivedSha, sketchId, ...afterReopen });

    await editDistance(page, sketchId, 40, 50, "dist p1–p2");
    const at90x50 = await checkVolume(page, proof.featureId, 36_000);
    await checkNativeSketch(page, sketchId, 90, 50);
    await page.getByRole("button", { name: "Done" }).click();
    receipt.tests.push({ name: "native-height-edit-40-to-50", pass: true,
      sketchId, widthMm: 90, heightMm: 50, ...at90x50 });

    await runBar(page, "undo");
    const restored90x40 = await checkVolume(page, proof.featureId, 28_800);
    await checkNativeSketch(page, sketchId, 90, 40);
    receipt.tests.push({ name: "native-Undo-restores-saved-90x40-six-constraints",
      pass: true, ...restored90x40 });
  } finally {
    if (!bridge.killed && bridge.exitCode === null) bridge.kill(); // own PID only
  }
}
async function main() {
  // The ownership and runner gates happen BEFORE making any local directory.
  const gate = preflight();
  const receiptRoot = path.join(evidence, "stage-d-smoke");
  fs.mkdirSync(receiptRoot, { recursive: true });
  const receiptDir = fs.mkdtempSync(path.join(receiptRoot, "hosted-"));
  const tempRoot = path.join(root, ".codex", "tmp");
  fs.mkdirSync(tempRoot, { recursive: true });
  const profile = fs.mkdtempSync(path.join(tempRoot, "candidate-stage-d-"));
  const receipt = {
    status: "FAIL_OR_BLOCKED", scenario: "exact-packaged-stage-d-native-reference-reconstruction",
    startedAtUtc: new Date().toISOString(), releaseId, isolatedRunner: "github-hosted-windows",
    sourceCandidateCommit: gate.original.gitHead,
    originalManifestSha256: requiredSha.originalManifest,
    candidateBundleSha256: requiredSha.combinedBundle,
    originalExeSha256: requiredSha.exe, originalCoreSha256: requiredSha.core,
    originalAsarSha256: requiredSha.asar, publishedBridgeSha256: requiredSha.bridge,
    probeReleaseDllSha256: gate.probeSha256,
    tests: [],
  };
  let app;
  const owned = { bridge: null, probe: null };
  let exitFailure;
  let originalCorePid = null;
  try {
    ownerGuard();
    const requireDesktop = createRequire(path.join(root, "apps", "desktop", "package.json"));
    const { _electron: electron } = requireDesktop("@playwright/test");
    const env = { ...process.env, KREODA_BACKGROUND_TEST: "1",
      KREODA_RECOVERY_DIR: path.join(profile, "recovery"),
      KREODA_PLUGINS_DIR: path.join(profile, "plugins"),
      TEMP: profile, TMP: profile, TMPDIR: profile,
      APPDATA: path.join(profile, "roaming"), LOCALAPPDATA: path.join(profile, "local"),
      KREODA_HERMES_CONFIG: "", KREODA_VOICE_TOKEN: "", KREODA_UPDATE_FEED: "",
      KREODA_UPDATE_PUBKEY: "" };
    for (const key of ["KREODA_SESSION_HOST", "KREODA_SESSION_PORT",
      "KREODA_SESSION_TOKEN", "KREODA_AUTOMATIC_LOOPBACK_TEST", "ELECTRON_RUN_AS_NODE",
      "KREODA_CAD_SESSION_URL", "KREODA_CAD_PAIR", "KREODA_MCP_PROBE_SCENARIO"])
      delete env[key];
    for (const folder of [env.APPDATA, env.LOCALAPPDATA]) fs.mkdirSync(folder, { recursive: true });
    app = await bounded(electron.launch({ executablePath: exe,
      args: ["--no-sandbox", "--lang=en-US", "--start-hidden", `--user-data-dir=${profile}`],
      env, timeout: 40_000 }), 50_000, "exact packaged Kreoda Electron launch");
    const appPid = app.process()?.pid;
    const appOwner = await waitProcessInfo(appPid, exe, process.pid);
    receipt.ownedElectronPid = appPid;
    const info = await bounded(app.evaluate(({ app, BrowserWindow }) => ({
      isPackaged: app.isPackaged, exe: process.execPath,
      appPath: app.getAppPath(), resources: process.resourcesPath,
      userData: app.getPath("userData"),
      visibleWindows: BrowserWindow.getAllWindows().filter(win => win.isVisible()).length,
    })), 10_000, "verify packaged Electron identity");
    assert(info.isPackaged && same(info.exe, exe) && same(info.appPath, appAsar) &&
      same(info.resources, resources) && info.visibleWindows === 0 &&
      (same(info.userData, profile) || within(info.userData, profile)),
    "packaged Electron image, profile or hidden window failed exact provenance");
    const page = await bounded(app.firstWindow({ timeout: 30_000 }), 35_000,
      "packaged Desktop BrowserWindow");
    const coreInfo = await until(async () => {
      const status = await bounded(page.evaluate(() => window.kreoda.coreInfo()),
        4000, "native sidecar status");
      return status?.running && status?.pid > 0 ? status : null;
    }, "packaged actual OCCT native sidecar", 25_000);
    const nativeOwner = await waitProcessInfo(coreInfo.pid, coreExe, appPid);
    originalCorePid = coreInfo.pid;
    const nativeInfo = await nativeCall(page, 1);
    assert(nativeInfo.occtVersion === "8.0.1-native", "OCCT version is not the real native core");
    receipt.tests.push({ name: "hidden-exact-packaged-Electron-and-child-real-OCCT",
      pass: true, electron: appOwner, core: nativeOwner,
      appAsarSha256: requiredSha.asar, occtVersion: nativeInfo.occtVersion });
    await bounded(verifyStageD(page, receipt, profile, gate.probeSha256, owned), 240_000,
      "native calibrated StageD through exact packaged CAD and Bridge");
    receipt.status = "PASS_PACKAGED_REAL_OCCT_BRIDGE_STAGE_D";
  } catch (error) {
    // Never put private pair tokens, credentials or full subprocess stderr in a receipt.
    exitFailure = error;
    receipt.failure = { kind: error?.name || "Error",
      message: String(error?.message ?? error).slice(0, 500) };
  } finally {
    // A timeout of the outer operation may race its inner async finally.
    // Never enumerate or terminate external applications by image name.
    for (const child of [owned.probe, owned.bridge]) {
      if (child && child.exitCode === null && !child.killed) child.kill();
    }
    if (app) {
      try { await bounded(app.close(), 12_000, "close owned Electron"); }
      catch (error) {
        receipt.shutdownError = String(error?.message ?? error).slice(0, 300);
        // Only the Electron child we launched, never processes by image name.
        app.process()?.kill();
      }
    }
    receipt.finishedAtUtc = new Date().toISOString();
    // Wait boundedly for our owned child processes to exit. Do not claim PASS
    // with a still-running Bridge/probe from this attempt.
    try {
      await until(() => [owned.probe, owned.bridge].every(child =>
        !child || child.exitCode !== null || child.signalCode !== null),
      "release owned .NET probe / published Bridge processes", 8_000);
    } catch (error) {
      receipt.status = "FAIL_OR_BLOCKED";
      receipt.shutdownError = String(error?.message ?? error).slice(0, 300);
      exitFailure ??= error;
    }
    // Original packaged files must remain byte identical after the test.
    try {
      checkSha(exe, requiredSha.exe);
      checkSha(coreExe, requiredSha.core);
      checkSha(appAsar, requiredSha.asar);
      checkSha(bridgeExe, requiredSha.bridge);
      checkSha(probeDll, gate.probeSha256);
      if (originalCorePid) {
        const lingering = ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${originalCorePid}'; if ($p) { $p.ExecutablePath }`);
        assert(!lingering || !same(lingering, coreExe),
          "owned real OCCT child remains after app shutdown");
      }
    } catch (error) {
      receipt.status = "FAIL_OR_BLOCKED";
      receipt.postflightError = String(error?.message ?? error).slice(0, 500);
      exitFailure ??= error;
    }
    if (receipt.shutdownError) { receipt.status = "FAIL_OR_BLOCKED"; exitFailure ??= Error(receipt.shutdownError); }
    const receiptFile = path.join(receiptDir, "receipt.json");
    fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
    // ICAD and private pairing material stay in the disposable local profile,
    // never in a published JSON or ZIP. Clean up only our own temp directory.
    try { fs.rmSync(profile, { recursive: true, force: true }); }
    catch (error) {
      console.error("StageD temp profile cleanup failed (inspect runner-local path)");
    }
    console.log(JSON.stringify({ status: receipt.status, receipt: receiptFile,
      passed: receipt.tests.length, failed: Boolean(exitFailure) }));
  }
  if (exitFailure) throw exitFailure;
  assert(receipt.status === "PASS_PACKAGED_REAL_OCCT_BRIDGE_STAGE_D",
    "StageD candidate receipt did not prove acceptance");
}
main().catch(error => {
  console.error("StageD smoke failed closed: " + String(error?.message ?? error).slice(0, 500));
  process.exitCode = 1;
});
