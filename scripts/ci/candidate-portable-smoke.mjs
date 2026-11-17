// Hidden, isolated-profile smoke of the newly produced Forge portable build.
// Never install, launch a user-profile app, or contact a normal LAN/Hermes
// service. Run only AFTER prime grants packaging and package manifest exists.
// node scripts/smoke-portable.mjs --manifest=<absolute-manifest-json> \
//   --prime-smoke-grant=PRIME_APPROVED_NO_EXTERNAL_KREODA_OWNER
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";

const evidence = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(evidence, "..", "..");
const workspacePaths = JSON.parse(fs.readFileSync(path.join(root, ".codex", "paths.json"), "utf8"));
const desktop = path.join(path.resolve(workspacePaths.activeImplementationWorktree), "apps", "desktop");
const options = new Map(process.argv.slice(2).map(value => {
  const [key, ...parts] = value.split("="); return [key, parts.join("=")];
}));
const assert = (ok, message) => { if (!ok) throw Error(`SMOKE BLOCKED: ${message}`); };
const sha256 = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const inside = (entry, dir) => {
  const relative = path.relative(dir, entry);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const stableJson = value => JSON.stringify(value, (_, entry) =>
  entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
const readInstalledBaseline = entries => entries.map(value =>
  fs.existsSync(value.path) ? { path: value.path, sha256: sha256(value.path), size: fs.statSync(value.path).size }
    : { path: value.path, missing: true });

async function main() {
  assert(process.platform === "win32" && process.arch === "x64", "requires Windows x64");
  assert(options.has("--manifest") && options.size === 2 &&
    options.get("--prime-smoke-grant") === "PRIME_APPROVED_NO_EXTERNAL_KREODA_OWNER",
    "separate explicit prime smoke grant required (external normal/Quest owner must be absent)");
  const processCheck = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
    "$owner = Get-Process -Id 8616 -ErrorAction SilentlyContinue; " +
    "$active = @(Get-Process -Name Kreoda,kreoda-core -ErrorAction SilentlyContinue); " +
    "if ($owner -or $active.Count -gt 0) { Write-Error ('External owner or existing Kreoda runtime active: ' + (($active | Select-Object -ExpandProperty Id) -join ',')); exit 20 }"],
    { windowsHide: true, timeout: 12_000, encoding: "utf8" });
  assert(processCheck.status === 0, "external Quest/normal Desktop process may kill or interfere with packaged smoke");
  const manifestPath = path.resolve(options.get("--manifest"));
  assert(inside(manifestPath, evidence) && fs.existsSync(manifestPath), "manifest must be in NEW evidence directory");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert(manifest.status === "PACKAGED_UNSMOKED_NOT_PROMOTED" && manifest.smokeRequired === true,
    "not a newly produced, unaccepted package");
  const portable = path.resolve(manifest.portable);
  assert(inside(portable, path.join(evidence, "output")) && fs.existsSync(portable), "unexpected portable directory");
  const exe = path.join(portable, "Kreoda.exe");
  const resources = path.join(portable, "resources");
  const native = path.join(resources, "kreoda-core.exe");
  assert(fs.existsSync(exe) && fs.existsSync(native), "missing portable components");
  assert(sha256(native) === manifest.nativeCore.sha256 &&
    sha256(path.join(resources, "app.asar")) === manifest.packagedResources.appAsarSha256,
    "native core / Electron ASAR provenance mismatch");
  assert(sha256(manifest.zipPath) === manifest.zipSha256, "portable ZIP SHA mismatch");
  const bridgeDir = path.resolve(manifest.bridgePublished ?? "");
  assert(inside(bridgeDir, path.join(evidence, "output")) && fs.existsSync(bridgeDir) &&
    manifest.bridge?.sourceSha256 && manifest.bridge?.selfContained === false,
    "missing separately published .NET 8 HermesBridge provenance");
  for (const entry of manifest.bridge.publishedFiles) {
    const file = path.join(bridgeDir, entry.name);
    assert(fs.existsSync(file) && sha256(file) === entry.sha256,
      `external HermesBridge published file SHA mismatch: ${entry.name}`);
  }
  const bridgeExe = path.join(bridgeDir, "Kreoda.HermesBridge.exe");
  assert(fs.existsSync(bridgeExe), "published HermesBridge.exe missing");
  const baselineBefore = readInstalledBaseline(manifest.installedRollbackBaseline);
  assert(JSON.stringify(baselineBefore) === JSON.stringify(manifest.installedRollbackBaseline),
    "original installed runtime was modified since packaging");

  // The disposable user-data root is nested in the evidence directory.
  // APPDATA/LOCALAPPDATA plus --user-data-dir prevent modifying the normal
  // Windows/Electron profile; the running app's path is checked as well.
  const smokeId = `smoke-${Date.now()}-${process.pid}`;
  fs.mkdirSync(path.join(evidence, "smoke"), { recursive: true });
  const proofDir = path.join(evidence, "smoke", smokeId);
  fs.mkdirSync(proofDir, { recursive: false });
  const userData = path.join(proofDir, "profile");
  const roaming = path.join(proofDir, "roaming");
  const local = path.join(proofDir, "local");
  const tmp = path.join(root, ".codex", "tmp");
  for (const dir of [userData, roaming, local, tmp]) fs.mkdirSync(dir, { recursive: true });
  const env = { ...process.env, KREODA_BACKGROUND_TEST: "1", KREODA_RECOVERY_DIR: path.join(userData, "recovery"),
    KREODA_PLUGINS_DIR: path.join(userData, "plugins"), TEMP: tmp, TMP: tmp, TMPDIR: tmp,
    APPDATA: roaming, LOCALAPPDATA: local };
  for (const name of ["KREODA_SESSION_PORT", "KREODA_SESSION_HOST", "KREODA_SESSION_TOKEN",
    "KREODA_AUTOMATIC_LOOPBACK_TEST", "KREODA_UPDATE_FEED", "KREODA_UPDATE_PUBKEY"])
    delete env[name];

  const require = createRequire(path.join(desktop, "package.json"));
  const { _electron: electron } = require("@playwright/test");
  const proof = { status: "FAIL_OR_BLOCKED", startedAt: new Date().toISOString(),
    releaseId: manifest.releaseId, portable, exeSha256: sha256(exe), coreSha256: sha256(native),
    userData, tests: [], installedBaseline: baselineBefore };
  let app;
  let bridgeChild;
  let stderr = "";
  let bridgeStderr = "";
  try {
    app = await electron.launch({ executablePath: exe, args: ["--no-sandbox", "--lang=en-US", "--start-hidden", `--user-data-dir=${userData}`],
      env, timeout: 40_000 });
    const proc = app.process();
    proc.stderr?.on("data", bytes => { stderr = (stderr + String(bytes)).slice(-150_000); });
    const appInfo = await app.evaluate(({ app, BrowserWindow }) => ({ isPackaged: app.isPackaged,
      exe: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath,
      userData: app.getPath("userData"), visibleWindows: BrowserWindow.getAllWindows().filter(w => w.isVisible()).length }));
    assert(appInfo.isPackaged, "Electron did not launch packaged app");
    assert(samePath(appInfo.exe, exe), "executed an unexpected Electron binary");
    assert(samePath(appInfo.appPath, path.join(resources, "app.asar")), "app.asar path is outside packaged resources");
    assert(samePath(appInfo.resources, resources), "resources path differs from selected portable build");
    assert(appInfo.visibleWindows === 0, "visible Electron window; aborting smoke");
    assert(samePath(appInfo.userData, userData) || inside(appInfo.userData, proofDir),
      "Electron profile escaped isolated evidence directory");
    proof.tests.push({ name: "packaged-ASAR-native-profile-hidden", pass: true, appInfo });

    const page = await app.firstWindow({ timeout: 30_000 });
    await page.getByTestId("home-screen").waitFor({ state: "visible", timeout: 25_000 });
    await page.getByTestId("home-new-project").click();
    await page.getByTestId("workspace-chrome").waitFor({ state: "visible", timeout: 25_000 });
    await page.getByText(/core 0\.1\.0(?!-stub)/i).waitFor({ state: "visible", timeout: 25_000 });
    const coreInfo = await page.evaluate(() => globalThis.window.kreoda.coreInfo());
    assert(coreInfo.running && Number.isInteger(coreInfo.pid) && coreInfo.pid > 0,
      "packaged native core did not start");
    const processPathResult = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
      `(Get-Process -Id ${coreInfo.pid} -ErrorAction Stop).Path`], { encoding: "utf8", windowsHide: true, timeout: 10_000, env });
    assert(processPathResult.status === 0 && samePath(processPathResult.stdout.trim(), native),
      "running native PID does not resolve to packaged kreoda-core.exe");
    proof.tests.push({ name: "real-packaged-OCCT-PID", pass: true, corePid: coreInfo.pid, processPath: processPathResult.stdout.trim() });

    const bridge = await page.evaluate(() => globalThis.window.kreoda.sessionSnapshot());
    assert(typeof bridge.documentId === "string" && Number.isInteger(bridge.revision),
      "packaged Desktop↔native SessionRelay snapshot missing");
    proof.tests.push({ name: "packaged-bridge-session-snapshot", pass: true,
      documentId: bridge.documentId, revision: bridge.revision });

    const createBox = async () => {
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.getByRole("button", { name: /Add box/ }).click();
      await page.getByRole("button", { name: "Create", exact: true }).click();
    };
    await createBox();
    await createBox();
    await page.waitForFunction(() => {
      const s = window.__kreoda_test?.snapshot();
      return s && s.bodies.length === 2 && s.bodies.every(b => b.triangles > 0);
    }, null, { timeout: 25_000 });
    const before = await page.evaluate(() => window.__kreoda_test.snapshot());
    assert(before.bodies.length === 2 && before.bodies.every(b => b.triangles > 0 && b.volumeMm3 > 0),
      "two packaged OCCT B-Rep solids not rendered");
    const [first, second] = before.bodies;
    const baseFirst = [...first.paramsMm];
    const baseSecond = [...second.paramsMm];
    assert(baseFirst.length === 3 && baseSecond.length === 3 && first.id !== second.id,
      "expected two distinct native box identities and dimensions");
    const mediumOverrides = { [first.id]: { widthMm: 150 }, [second.id]: { widthMm: 125 } };
    const mediumRedefined = { [first.id]: { widthMm: 150, heightMm: 70 }, [second.id]: { widthMm: 125 } };
    const largeOverrides = { [first.id]: { heightMm: 80 } };
    const base = { [first.id]: baseFirst, [second.id]: baseSecond };
    const medium = { [first.id]: [150, baseFirst[1], baseFirst[2]], [second.id]: [125, baseSecond[1], baseSecond[2]] };
    const mediumUpdated = { [first.id]: [150, 70, baseFirst[2]], [second.id]: [125, baseSecond[1], baseSecond[2]] };
    const large = { [first.id]: [baseFirst[0], 80, baseFirst[2]], [second.id]: baseSecond };
    const check = async (active, expected, definitions = true) => {
      const actual = await page.evaluate(() => window.__kreoda_test.snapshot());
      assert(actual.bodies.length === 2, `expected two B-Reps in ${active || "Base"}`);
      for (const body of actual.bodies) {
        const required = expected[body.id];
        assert(required?.length === 3 && body.paramsMm.length === 3, `unexpected feature in ${active || "Base"}`);
        for (let i = 0; i < 3; ++i)
          assert(Math.abs(body.paramsMm[i] - required[i]) <= 1e-5,
            `dimension mismatch in ${active || "Base"}: ${body.id} index ${i}`);
        const volume = required.reduce((a, b) => a * b, 1);
        assert(body.triangles > 0 && Math.abs(body.volumeMm3 - volume) <= Math.max(0.01, volume * 1e-6),
          `native B-Rep volume mismatch in ${active || "Base"}: ${body.id}`);
      }
      const state = await page.evaluate(() => window.__kreoda_test.configurationE2E.query());
      assert(state.active === active && state.revision === actual.revision,
        `active/revision mismatch: expected '${active}', observed '${state.active}'`);
      if (definitions) assert(stableJson(state.named.Medium) === stableJson(mediumRedefined) &&
        stableJson(state.named.Large) === stableJson(largeOverrides), "named override metadata changed unexpectedly");
      return state;
    };
    const action = (verb, ...args) => page.evaluate(({ verb, args }) =>
      window.__kreoda_test.configurationE2E[verb](...args), { verb, args });
    await action("define", "Medium", mediumOverrides);
    await action("activate", "Medium");
    await check("Medium", medium, false);
    await action("define", "Medium", mediumRedefined); // active-name redefine must apply instantly
    await action("activate", "Medium"); // same-name no-op, but forces UI snapshot refresh
    await check("Medium", mediumUpdated, false);
    await action("define", "Large", largeOverrides);
    await action("activate", "Large");
    await check("Large", large);
    await action("undo");
    await check("Medium", mediumUpdated);
    await action("redo");
    await check("Large", large);
    await action("activate", ""); // explicit canonical Base sentinel
    await check("", base);
    await action("undo");
    await check("Large", large);
    await action("redo");
    await check("", base);
    await action("activate", "Large"); // Base→Large must equal Medium→Large
    await check("Large", large);
    await action("activate", "Medium");
    await check("Medium", mediumUpdated);
    await action("activate", "Large");
    await check("Large", large);
    await action("activate", "");
    await check("", base);
    proof.tests.push({ name: "native-two-box-Medium-Large-Base-sparse-undo-redo", pass: true,
      firstId: first.id, secondId: second.id, medium: mediumRedefined, large: largeOverrides });

    // A manual edit made while Base is active must become the canonical
    // persisted baseline, not get lost on Base→Medium→Base. Execute through
    // the real Desktop command bar, not a synthetic replacement core.
    await page.getByRole("button", { name: "Project" }).click();
    await page.getByTestId(`object-tree-${first.id}`).click();
    const input = page.getByTestId("command-input");
    await input.fill("set widthMm 130");
    await input.press("Enter");
    const preview = page.getByTestId("plan-preview");
    await preview.waitFor({ state: "visible", timeout: 10_000 });
    await preview.getByRole("button", { name: /Run 1 step/ }).click();
    await preview.waitFor({ state: "hidden", timeout: 30_000 });
    const manualBase = { ...base, [first.id]: [130, baseFirst[1], baseFirst[2]] };
    await check("", manualBase);
    await action("undo");
    await check("", base);
    await action("redo");
    await check("", manualBase);
    await action("activate", "Medium");
    await check("Medium", mediumUpdated);
    await action("activate", "");
    await check("", manualBase);
    proof.tests.push({ name: "manual-Base-SetDimension-persists-across-switches-and-UndoRedo", pass: true,
      baseWidthMm: 130 });

    const project = path.join(proofDir, "portable-roundtrip.icad");
    await page.evaluate(file => window.__kreoda_test.saveIcad(file), project);
    assert(fs.existsSync(project) && fs.readFileSync(project).readUInt32LE(0) === 0x04034b50,
      "native ICAD save did not yield ZIP-backed project");
    await page.evaluate(file => window.__kreoda_test.openIcad(file), project);
    await check("", manualBase);
    await action("activate", "Large");
    const largeAfterManualBase = { ...large, [first.id]: [130, 80, baseFirst[2]] };
    await check("Large", largeAfterManualBase);
    await action("activate", "");
    await check("", manualBase);
    proof.tests.push({ name: "packaged-ICAD-save-open-sparse-Base-recovery", pass: true,
      bodyIds: [first.id, second.id], baseWidthMm: 130, icadSha256: sha256(project) });

    // HermesBridge is NOT in Forge resources; test the separately published
    // framework-dependent binary on a disposable loopback port with no CAD
    // credentials, no external Hermes URL and no ordinary profile/service.
    const localPort = await new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        server.close(error => error ? reject(error) : resolve(port));
      });
    });
    const bridgeUrl = `http://127.0.0.1:${localPort}`;
    const bridgeEnv = { ...env, KREODA_CAD_DEVICE_FILE: path.join(userData, "unpaired-smoke-device.json"),
      KREODA_HERMES_BRIDGE_URL: bridgeUrl };
    for (const name of ["KREODA_CAD_SESSION_URL", "KREODA_CAD_PAIR", "KREODA_CAD_PC_ID",
      "KREODA_HERMES_CONFIG", "KREODA_VOICE_TOKEN"]) delete bridgeEnv[name];
    bridgeChild = spawn(bridgeExe, [], { cwd: bridgeDir, windowsHide: true, env: bridgeEnv,
      stdio: ["ignore", "ignore", "pipe"] });
    bridgeChild.stderr.on("data", bytes => { bridgeStderr = (bridgeStderr + String(bytes)).slice(-120_000); });
    let bridgeHealth;
    for (let attempt = 0; attempt < 45; ++attempt) {
      assert(bridgeChild.exitCode === null, `HermesBridge exited before health: ${bridgeChild.exitCode}`);
      try {
        const response = await fetch(`${bridgeUrl}/health`, { signal: AbortSignal.timeout(1500) });
        if (response.ok) { bridgeHealth = await response.json(); break; }
      } catch { /* wait only on the isolated loopback health endpoint */ }
      await new Promise(resolve => setTimeout(resolve, 160));
    }
    assert(bridgeHealth?.service === "kreoda-hermes-bridge" && bridgeHealth?.mcp === true &&
      bridgeHealth?.voiceConfigured === false, "published isolated Bridge /health contract failed");
    proof.tests.push({ name: "published-HermesBridge-Release-loopback-health", pass: true,
      bridgeSha256: sha256(bridgeExe), service: bridgeHealth.service, mcp: true,
      voiceConfigured: false, offlineNoCredentials: true });
    proof.status = "PASS_PACKAGED_REAL_OCCT_BRIDGE_HIDDEN";
  } catch (error) {
    proof.error = String(error?.stack || error);
    throw error;
  } finally {
    if (bridgeChild && !bridgeChild.killed) bridgeChild.kill();
    if (app) await app.close().catch(e => { proof.closeError = String(e); });
    proof.finishedAt = new Date().toISOString();
    proof.installedAfter = readInstalledBaseline(manifest.installedRollbackBaseline);
    if (JSON.stringify(proof.installedAfter) !== JSON.stringify(baselineBefore)) {
      proof.status = "FAIL_INSTALLED_REFERENCE_CHANGED";
    }
    fs.writeFileSync(path.join(proofDir, "smoke.json"), JSON.stringify(proof, null, 2) + "\n", { flag: "wx" });
    fs.writeFileSync(path.join(proofDir, "electron-stderr.log"), stderr, { flag: "wx" });
    fs.writeFileSync(path.join(proofDir, "bridge-stderr.log"), bridgeStderr, { flag: "wx" });
    console.log(JSON.stringify({ status: proof.status, proof: path.join(proofDir, "smoke.json") }));
  }
  assert(proof.status === "PASS_PACKAGED_REAL_OCCT_BRIDGE_HIDDEN", "smoke did not pass every gate");
}

main().catch(error => { console.error(error?.stack || String(error)); process.exitCode = 1; });
