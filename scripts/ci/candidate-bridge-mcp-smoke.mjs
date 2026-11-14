// GitHub-hosted Windows acceptance of the ORIGINAL byte-pinned packaged
// Desktop/OCCT and separately published HermesBridge through actual HTTP MCP.
// The Release McpProbe uses the official .NET MCP SDK, not a synthetic client.
//
// Run only after prepare-integrated-candidate-smoke.mjs and an authenticated
// Release build of clients/session-dotnet/probes/Kreoda.McpProbe:
// node scripts/ci/candidate-bridge-mcp-smoke.mjs \
//   --probe-sha256=<actual-Release-Kreoda.McpProbe.dll-SHA256> \
//   --prime-bridge-mcp-grant=PRIME_APPROVED_GITHUB_HOSTED_BRIDGE_MCP
//
// Do not run on the shared Windows/DSH owner host. No Hermes LLM is contacted.
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
const release = path.join(evidence, "output", releaseId);
const portable = path.join(release, "Kreoda-win32-x64");
const resources = path.join(portable, "resources");
const bridgeDir = path.join(release, "Kreoda.HermesBridge-net8.0");
const originalManifest = path.join(release, "release-manifest.json");
const stagedManifest = path.join(evidence, "hosted-smoke-manifest.json");
const exe = path.join(portable, "Kreoda.exe");
const nativeExe = path.join(resources, "kreoda-core.exe");
const appAsar = path.join(resources, "app.asar");
const bridgeExe = path.join(bridgeDir, "Kreoda.HermesBridge.exe");
const probeDll = path.join(root, "clients", "session-dotnet", "probes",
  "Kreoda.McpProbe", "bin", "Release", "net8.0", "Kreoda.McpProbe.dll");
const hashes = Object.freeze({
  originalManifest: "2064d409a22f1e0020e90ac194e7d8ebb5813550316e5ced69b5dc72b8d88a66",
  receipt: "b7520dcddb43e98eb82f147beec8f22279678e3e39c000cba70a1fbd887f8f7a",
  bundle: "036cff37ed0b5850926224cb0afc75a159a558897d77ffc1f74e314bccf85b1d",
  exe: "a09ee422ccf2c678db1b41ed3d2dbbcf987be1585e0a7cdbbc858321778a35b4",
  native: "f003945f69bdf04e7ab66ea1319b50e22723b5e716047e8dbb2f4e21dc3710b4",
  asar: "e22221c092c28f1c1ce9115c3e3ac883ea37fa1c903ef14cde55ff09ee01fdae",
  bridge: "e1d9cbe0a91480f1b1f608e499ede409ef5a97daa8e38ca30eb27817415f6af0",
});
const fail = message => { throw new Error("BRIDGE_MCP_BLOCKED: " + message); };
const check = (condition, message) => { if (!condition) fail(message); };
const same = (a, b) => typeof a === "string" && typeof b === "string" &&
  path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const validHash = value => typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const fileSha = file => {
  const hash = createHash("sha256");
  const fd = fs.openSync(file, "r");
  const bytes = Buffer.allocUnsafe(1024 * 1024);
  try {
    let count;
    while ((count = fs.readSync(fd, bytes, 0, bytes.length, null)) > 0)
      hash.update(bytes.subarray(0, count));
  } finally { fs.closeSync(fd); }
  return hash.digest("hex");
};
function pin(file, expected) {
  const meta = fs.lstatSync(file);
  check(meta.isFile() && !meta.isSymbolicLink() && validHash(expected) &&
    fileSha(file) === expected.toLowerCase(), "pinned file changed: " + file);
}
const jsonFile = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
async function bounded(promise, ms, name) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error("timeout: " + name)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
async function until(checkFn, label, maxMs = 25_000) {
  const deadline = Date.now() + maxMs;
  do {
    try {
      const value = await bounded(Promise.resolve().then(checkFn), 4_000, label);
      if (value) return value;
    } catch { /* a failed poll is retried until the bounded deadline */ }
    await delay(160);
  } while (Date.now() < deadline);
  fail("deadline waiting for " + label);
}
function powershell(source) {
  const result = spawnSync("powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", source],
    { windowsHide: true, encoding: "utf8", timeout: 12_000, maxBuffer: 128 * 1024 });
  check(!result.error && result.status === 0, "Windows ownership check failed closed");
  return result.stdout.trim();
}
function foreignOwnerGuard() {
  powershell("$foreign=Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq 8616 -or $_.Name -in @('Kreoda.exe','kreoda-core.exe','Kreoda.HermesBridge.exe') }; if ($foreign) { exit 73 }; 'OWNERS_CLEAR'");
}
function ownedImage(pid, expectedPath, parentPid = null) {
  check(Number.isInteger(pid) && pid > 0, "missing child PID");
  const data = JSON.parse(powershell(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if (-not $p) { exit 43 }; $p | Select-Object ProcessId,ParentProcessId,ExecutablePath | ConvertTo-Json -Compress`));
  check(data.ProcessId === pid && (parentPid === null || data.ParentProcessId === parentPid) &&
    same(data.ExecutablePath, expectedPath), "unexpected process identity or ancestry");
  return { pid, actualParentPid: data.ParentProcessId, exactImage: true };
}
function safePublishedPath(relativeName) {
  check(typeof relativeName === "string" && relativeName.length > 0 &&
    !path.isAbsolute(relativeName) && !relativeName.startsWith("\\") &&
    !relativeName.startsWith("/") && !relativeName.includes(":"),
  "unsafe published Bridge entry");
  const parts = relativeName.split(/[\\/]/);
  check(parts.every(part => part !== "" && part !== "." && part !== ".."),
    "unsafe published Bridge path segment");
  const file = path.resolve(bridgeDir, ...parts);
  const relative = path.relative(bridgeDir, file);
  check(relative.length > 0 && relative !== ".." && !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative), "published Bridge path escaped candidate");
  return file;
}
function preflight() {
  check(process.platform === "win32" && process.arch === "x64" &&
    process.env.GITHUB_ACTIONS === "true" &&
    process.env.RUNNER_ENVIRONMENT === "github-hosted" &&
    process.env.RUNNER_OS === "Windows" && same(process.env.GITHUB_WORKSPACE, root),
  "requires exact checkout on GitHub-hosted Windows x64");
  const args = process.argv.slice(2);
  check(args.length === 2 && args.every(a => /^--[^=]+=.+$/.test(a)), "invalid smoke invocation");
  const opts = new Map(args.map(a => [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)]));
  check(opts.size === 2 && validHash(opts.get("--probe-sha256")) &&
    opts.get("--prime-bridge-mcp-grant") === "PRIME_APPROVED_GITHUB_HOSTED_BRIDGE_MCP",
  "actual Release probe SHA and prime hosted-runner grant required");
  foreignOwnerGuard();
  pin(originalManifest, hashes.originalManifest);
  const original = jsonFile(originalManifest);
  const staged = jsonFile(stagedManifest);
  check(original.releaseId === releaseId && original.status === "PACKAGED_UNSMOKED_NOT_PROMOTED" &&
    original.smokeRequired === true && original.bridge?.selfContained === false &&
    original.bridge?.publishedFiles?.length === 35 &&
    original.nativeCore?.sha256?.toLowerCase() === hashes.native &&
    original.packagedResources?.appAsarSha256?.toLowerCase() === hashes.asar &&
    staged.hostedRunner === true && staged.releaseId === releaseId &&
    staged.hostedOriginalManifestSha256?.toLowerCase() === hashes.originalManifest &&
    staged.hostedReceiptSha256?.toLowerCase() === hashes.receipt &&
    staged.zipSha256?.toLowerCase() === hashes.bundle &&
    same(staged.portable, portable) && same(staged.bridgePublished, bridgeDir),
  "original candidate staging/provenance differs");
  for (const [file, expected] of [[exe, hashes.exe], [nativeExe, hashes.native],
    [appAsar, hashes.asar], [bridgeExe, hashes.bridge],
    [probeDll, opts.get("--probe-sha256")]]) pin(file, expected);
  for (const entry of original.bridge.publishedFiles) {
    pin(safePublishedPath(entry.name), entry.sha256);
  }
  for (const name of ["Kreoda.HermesBridge.dll", "Kreoda.ModelingAgent.dll"])
    check(fs.lstatSync(path.join(path.dirname(probeDll), name)).isFile(),
      "Release probe dependency missing");
  return { original, probeSha: opts.get("--probe-sha256").toLowerCase() };
}
async function unusedLoopbackPort() {
  const server = createServer();
  try {
    await bounded(new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    }), 3000, "loopback port allocation");
    const port = server.address()?.port;
    check(Number.isInteger(port) && port > 0, "loopback port not assigned");
    return port;
  } finally {
    if (server.listening)
      await bounded(new Promise((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve())), 3000, "close loopback reservation");
  }
}
function probeRun(env, scenario, dotnetExe, children, expectFailure = false) {
  const args = [probeDll];
  const run = spawn(dotnetExe, args, { cwd: path.dirname(probeDll), windowsHide: true,
    env: { ...env, KREODA_MCP_PROBE_SCENARIO: scenario },
    stdio: ["ignore", "pipe", "pipe"] });
  children.push(run);
  const outcome = new Promise((resolve, reject) => {
    let output = "";
    let diagnosticsBytes = 0;
    let settled = false;
    const timer = setTimeout(() => { run.kill(); finish(false, Error("Release MCP probe deadline")); }, 45_000);
    function finish(ok, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok) resolve(value); else reject(value);
    }
    run.stdout.on("data", bytes => {
      output += String(bytes);
      if (output.length > 128 * 1024) { run.kill(); finish(false, Error("probe stdout limit")); }
    });
    run.stderr.on("data", bytes => {
      diagnosticsBytes += bytes.length;
      if (diagnosticsBytes > 128 * 1024) { run.kill(); finish(false, Error("probe stderr limit")); }
    });
    run.once("error", () => finish(false, Error("Release MCP probe spawn failed")));
    run.once("exit", (code, signal) => {
      if (expectFailure) {
        if (code !== null && code !== 0 && signal === null)
          finish(true, { expectedDenial: true, nonzeroExitCode: code });
        else finish(false, Error("revoked Bridge device still reached MCP describe_model"));
      } else if (code !== 0 || signal !== null)
        finish(false, Error("Release MCP probe failed; tool/transport contract did not pass"));
      else {
        try { finish(true, JSON.parse(output.trim())); }
        catch { finish(false, Error("Release MCP probe did not emit valid JSON proof")); }
      }
    });
  });
  // Retain the rejection even if the short process identity check races its exit.
  void outcome.catch(() => {});
  return { child: run, outcome };
}
async function runBar(page, command) {
  const input = page.getByTestId("command-input");
  await input.fill(command, { timeout: 8000 });
  await input.press("Enter", { timeout: 8000 });
  const preview = page.getByTestId("plan-preview");
  await preview.waitFor({ state: "visible", timeout: 12_000 });
  await preview.getByRole("button", { name: /Run 1 step/ }).click({ timeout: 12_000 });
  await preview.waitFor({ state: "hidden", timeout: 30_000 });
}
async function releaseChildren(children) {
  for (const child of children) if (child && child.exitCode === null &&
    child.signalCode === null && !child.killed) child.kill();
  await until(() => children.every(child => !child || child.exitCode !== null ||
    child.signalCode !== null), "owned .NET processes exited", 8_000);
}
async function main() {
  const { original, probeSha } = preflight(); // Before the first write or process launch.
  const receiptRoot = path.join(evidence, "bridge-mcp-smoke");
  const tmpRoot = path.join(root, ".codex", "tmp");
  fs.mkdirSync(receiptRoot, { recursive: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
  const receiptDir = fs.mkdtempSync(path.join(receiptRoot, "hosted-"));
  const profile = fs.mkdtempSync(path.join(tmpRoot, "candidate-bridge-mcp-"));
  const report = { status: "FAIL_OR_BLOCKED", scenario: "original-packaged-HTTP-MCP-bridge-native-undo-revocation",
    startedAtUtc: new Date().toISOString(), releaseId,
    sourceCommit: original.gitHead, zipSha256: hashes.bundle,
    originalManifestSha256: hashes.originalManifest, packagedExeSha256: hashes.exe,
    packagedNativeSha256: hashes.native, packagedAsarSha256: hashes.asar,
    publishedBridgeSha256: hashes.bridge, probeReleaseDllSha256: probeSha, tests: [] };
  const children = [];
  let app, error, corePid;
  try {
    foreignOwnerGuard();
    const env = { ...process.env, KREODA_BACKGROUND_TEST: "1",
      KREODA_RECOVERY_DIR: path.join(profile, "recovery"),
      KREODA_PLUGINS_DIR: path.join(profile, "plugins"),
      TEMP: profile, TMP: profile, TMPDIR: profile,
      APPDATA: path.join(profile, "roaming"), LOCALAPPDATA: path.join(profile, "local"),
      KREODA_HERMES_CONFIG: "", KREODA_VOICE_TOKEN: "", KREODA_UPDATE_FEED: "",
      KREODA_UPDATE_PUBKEY: "" };
    for (const key of ["KREODA_SESSION_HOST", "KREODA_SESSION_PORT", "KREODA_SESSION_TOKEN",
      "KREODA_AUTOMATIC_LOOPBACK_TEST", "KREODA_CAD_SESSION_URL", "KREODA_CAD_PAIR",
      "KREODA_CAD_DEVICE_FILE", "KREODA_CAD_PC_ID", "ELECTRON_RUN_AS_NODE"])
      delete env[key];
    fs.mkdirSync(env.APPDATA);
    fs.mkdirSync(env.LOCALAPPDATA);
    const requireDesktop = createRequire(path.join(root, "apps", "desktop", "package.json"));
    const { _electron: electron } = requireDesktop("@playwright/test");
    app = await bounded(electron.launch({ executablePath: exe,
      args: ["--no-sandbox", "--lang=en-US", "--start-hidden", `--user-data-dir=${profile}`],
      env, timeout: 40_000 }), 50_000, "launch original packaged Electron");
    const electronPid = app.process()?.pid;
    // Playwright may interpose a Windows spawn wrapper. Its returned PID is
    // the owned launch handle; authenticate its executable bytes/path here.
    const electronImage = ownedImage(electronPid, exe);
    const identity = await bounded(app.evaluate(({ app, BrowserWindow }) => ({
      packaged: app.isPackaged, executable: process.execPath, appPath: app.getAppPath(),
      resources: process.resourcesPath, profile: app.getPath("userData"),
      visibleWindows: BrowserWindow.getAllWindows().filter(w => w.isVisible()).length,
    })), 10_000, "packaged Electron identity");
    check(identity.packaged && same(identity.executable, exe) &&
      same(identity.appPath, appAsar) && same(identity.resources, resources) &&
      same(identity.profile, profile) && identity.visibleWindows === 0,
    "packaged app identity, profile, or hidden window not authentic");
    const page = await bounded(app.firstWindow({ timeout: 30_000 }), 35_000, "packaged renderer");
    const core = await until(async () => {
      const value = await page.evaluate(() => window.kreoda.coreInfo());
      return value?.running && value.pid > 0 ? value : null;
    }, "real packaged OCCT process");
    corePid = core.pid;
    const coreImage = ownedImage(core.pid, nativeExe, electronPid);
    report.tests.push({ name: "exact-hidden-packaged-Electron-real-OCCT", pass: true,
      electronImage, coreImage });

    const listener = await bounded(page.evaluate(() => window.kreoda.sessionEnable("127.0.0.1", 0)),
      10_000, "enable private WS session");
    const sessionPort = listener?.listener?.port;
    check(Number.isInteger(sessionPort) && sessionPort > 0 && sessionPort <= 65535,
      "real private loopback WS listener not active");
    const pair = await bounded(page.evaluate(() => window.kreoda.sessionPair()),
      10_000, "pair private WS session");
    check(typeof pair?.token === "string" && pair.token.length >= 16,
      "real private session pairing missing");
    const bridgePort = await unusedLoopbackPort();
    const bridgeUrl = `http://127.0.0.1:${bridgePort}`;
    const deviceFile = path.join(profile, "bridge-device.json");
    const bridgeEnv = { ...env, KREODA_HERMES_BRIDGE_URL: bridgeUrl,
      KREODA_CAD_SESSION_URL: `ws://127.0.0.1:${sessionPort}/`,
      KREODA_CAD_PAIR: pair.token, KREODA_CAD_DEVICE_FILE: deviceFile,
      KREODA_MCP_PROBE_URL: bridgeUrl + "/mcp" };
    const bridge = spawn(bridgeExe, [], { cwd: bridgeDir, windowsHide: true,
      env: bridgeEnv, stdio: ["ignore", "ignore", "ignore"] });
    children.push(bridge);
    let spawnError = false;
    bridge.once("error", () => { spawnError = true; });
    check(bridge.pid > 0, "real HermesBridge apphost did not spawn");
    const bridgeImage = ownedImage(bridge.pid, bridgeExe, process.pid);
    await until(async () => {
      check(!spawnError && bridge.exitCode === null && bridge.signalCode === null,
        "published Bridge exited before /health");
      const response = await fetch(bridgeUrl + "/health", { signal: AbortSignal.timeout(1500) });
      if (!response.ok) return null;
      const health = await response.json();
      return health.service === "kreoda-hermes-bridge" && health.mcp === true &&
        health.voiceConfigured === false ? health : null;
    }, "published isolated Bridge /health", 30_000);
    report.tests.push({ name: "published-HermesBridge-real-WS-pairing-ready", pass: true,
      bridgeImage, bridgePort, sessionPort, voiceConfigured: false });

    const dotnetExe = powershell("(Get-Command dotnet.exe -ErrorAction Stop).Source");
    const probeEnv = { ...env, KREODA_MCP_PROBE_URL: bridgeUrl + "/mcp" };
    const run = async (scenario, mustFail = false) => {
      const { child, outcome } = probeRun(probeEnv, scenario, dotnetExe, children, mustFail);
      check(child.pid > 0, "official MCP probe process did not spawn");
      // A short-lived SDK probe can exit before synchronous CIM completes.
      // Its executable is the resolved absolute dotnet.exe, and its argument
      // is the pinned Release DLL. A live mismatched process always blocks.
      try { ownedImage(child.pid, dotnetExe, process.pid); }
      catch {
        const stillLive = powershell(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${child.pid}'; if ($p) { 'LIVE' }`);
        check(stillLive !== "LIVE", "official Release probe process identity could not be established");
      }
      return outcome;
    };
    const before = await run("mcp-inspect");
    check(before.scenario === "mcp-inspect" && before.status === "inspected" &&
      before.requestActive === false && before.features === 0 &&
      before.bodies === 0 && before.sketches === 0,
    "HTTP MCP discovery/resources/describe_model did not inspect empty native document");
    check(fs.existsSync(deviceFile), "Bridge did not persist a real paired device");
    const device = jsonFile(deviceFile);
    check(typeof device.deviceId === "string" && /^device-[0-9a-f-]{36}$/i.test(device.deviceId) &&
      device.sessionUrl === bridgeEnv.KREODA_CAD_SESSION_URL,
    "Bridge private WS authentication device binding invalid");
    report.tests.push({ name: "HTTP-MCP-eight-tool-catalog-resource-schema-describe_model", pass: true,
      baseline: { features: before.features, bodies: before.bodies, sketches: before.sketches },
      pairedDevicePersisted: true });

    const created = await run(""); // McpProbe default: official HTTP MCP CreateBox/commit/query.
    check(Array.isArray(created.passed) && created.passed.length === 3 &&
      created.passed.includes("native-canonical-checked-transaction") &&
      typeof created.featureId === "string" && created.featureId.length > 0 &&
      Number.isInteger(created.finalRevision) && created.finalRevision > 0 &&
      Math.abs(created.measuredVolumeMm3 - 100_000) <= 0.01 &&
      created.solidCount === 1,
    "official HTTP MCP native CreateBox/commit/measurement proof failed");
    const after = await run("mcp-inspect");
    check(after.status === "inspected" && after.features === 1 && after.bodies === 1 &&
      after.requestActive === false, "MCP commit not visible through describe_model");
    const observed = await until(async () => {
      const snap = await page.evaluate(() => window.__kreoda_test?.snapshot());
      const body = snap?.bodies?.find(b => b.id === created.featureId);
      return snap?.revision === created.finalRevision && body?.triangles > 0 &&
        Math.abs(body.volumeMm3 - 100_000) <= 0.01 ? snap : null;
    }, "actual packaged renderer observes HTTP MCP OCCT solid", 30_000);
    report.tests.push({ name: "HTTP-MCP-CreateBox-measureVolume-commit-renderer", pass: true,
      featureId: created.featureId, finalRevision: created.finalRevision,
      volumeMm3: created.measuredVolumeMm3, triangles: observed.bodies[0].triangles });

    const home = page.getByTestId("home-new-project");
    if (await home.isVisible()) await home.click();
    await page.getByTestId("workspace-chrome").waitFor({ state: "visible", timeout: 15_000 });
    await runBar(page, "undo");
    const undone = await until(async () => {
      const snap = await page.evaluate(() => window.__kreoda_test?.snapshot());
      return snap?.bodies?.length === 0 && snap?.revision > created.finalRevision ? snap : null;
    }, "packaged Desktop Undo removes MCP-created body", 25_000);
    const undoneMcp = await run("mcp-inspect");
    check(undoneMcp.bodies === 0 && undoneMcp.features === 0 &&
      undoneMcp.requestActive === false,
    "official HTTP MCP description did not observe Desktop Undo");
    report.tests.push({ name: "Desktop-Undo-shared-MCP-document-revision", pass: true,
      afterUndoRevision: undone.revision, bodyCount: undoneMcp.bodies });

    await bounded(page.evaluate(id => window.kreoda.sessionRevoke(id), device.deviceId),
      10_000, "revoke real Bridge device");
    const revoked = await run("mcp-inspect", true);
    check(revoked.expectedDenial === true, "MCP device was still authenticated after revoke");
    const stillListening = await fetch(bridgeUrl + "/health", { signal: AbortSignal.timeout(1500) });
    check(stillListening.ok && (await stillListening.json()).mcp === true,
      "Bridge exited; cannot attribute MCP denial to revocation");
    report.tests.push({ name: "Desktop-revoke-denies-Bridge-MCP-describe_model", pass: true,
      deniedWithNonzeroExit: true });
    await bounded(page.evaluate(() => window.kreoda.sessionDisable()),
      10_000, "disable disposable CAD session");
    report.status = "PASS_EXACT_PACKAGED_HTTP_MCP_NATIVE_UNDO_REVOKE";
  } catch (failure) {
    error = failure;
    // Never persist or print pairing secrets, device credential, or .NET stderr.
    report.failure = { step: report.tests.length, kind: failure?.name ?? "Error",
      reason: "Bounded packaged HTTP MCP acceptance failed; inspect source step and hosted test logs" };
  } finally {
    for (const child of children) if (child && child.exitCode === null &&
      child.signalCode === null && !child.killed) child.kill();
    if (app) {
      try { await bounded(app.close(), 12_000, "close owned packaged Electron"); }
      catch { app.process()?.kill(); report.status = "FAIL_OR_BLOCKED";
        report.shutdownError = "owned Electron did not close cleanly";
        error ??= Error("owned Electron shutdown failed"); }
    }
    try { await releaseChildren(children); }
    catch { report.status = "FAIL_OR_BLOCKED";
      report.shutdownError = "owned .NET subprocess did not exit";
      error ??= Error("owned Bridge/probe shutdown failed"); }
    try {
      for (const [file, hash] of [[exe, hashes.exe], [nativeExe, hashes.native],
        [appAsar, hashes.asar], [bridgeExe, hashes.bridge], [probeDll, probeSha]]) pin(file, hash);
      if (corePid) {
        const remaining = powershell(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${corePid}'; if ($p) { $p.ExecutablePath }`);
        check(!same(remaining, nativeExe), "owned native process leaked after shutdown");
      }
    } catch { report.status = "FAIL_OR_BLOCKED";
      report.postflightError = "package integrity or owned native process cleanup failed";
      error ??= Error("MCP postflight integrity failed"); }
    try { fs.rmSync(profile, { recursive: true, force: true }); }
    catch { report.status = "FAIL_OR_BLOCKED";
      error ??= Error("ephemeral profile cleanup failed"); }
    report.finishedAtUtc = new Date().toISOString();
    fs.writeFileSync(path.join(receiptDir, "receipt.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ status: report.status,
      receipt: path.join(receiptDir, "receipt.json"), passed: report.tests.length }));
  }
  if (error) throw Error("packaged HTTP MCP acceptance failed closed");
  check(report.status === "PASS_EXACT_PACKAGED_HTTP_MCP_NATIVE_UNDO_REVOKE",
    "packaged HTTP MCP acceptance was not completed");
}
main().catch(() => { console.error("Bridge MCP smoke FAILED; see isolated receipt.json"); process.exitCode = 1; });
