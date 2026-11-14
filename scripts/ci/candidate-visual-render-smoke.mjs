// Strict hosted-only real raster smoke of the ORIGINAL packaged Kreoda.exe.
// Launches a hidden Electron window and its actual packaged OCCT native core;
// captures real compositor pixels over [data-testid="viewport"] canvas.
// NO Hermes/model/Bridge service, mock canvas, synthetic pixels or local run.
//
// GitHub-hosted Windows x64, AFTER the existing exact-bundle staging step:
// node scripts/ci/candidate-visual-render-smoke.mjs \
//   --prime-visual-grant=PRIME_APPROVED_GITHUB_HOSTED_VISUAL
//
// Screenshots and JSON: .artifacts/kreoda-integrated-acceptance-20261114/
//   visual-smoke/<unique-id>/{before-a.png,before-b.png,after.png,receipt.json}
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const staging = path.join(root, ".artifacts", "kreoda-integrated-package-20261113");
const output = path.join(staging, "output");
const hostedManifest = path.join(staging, "hosted-smoke-manifest.json");
const visualRoot = path.join(root, ".artifacts", "kreoda-integrated-acceptance-20261114", "visual-smoke");
const RELEASE_ID = "0.1.0-integrated-20261113-c211b2e01fb7-f003945f69bd-476eccda";
const SHA = Object.freeze({
  originalManifest: "2064d409a22f1e0020e90ac194e7d8ebb5813550316e5ced69b5dc72b8d88a66",
  hostedReceipt: "b7520dcddb43e98eb82f147beec8f22279678e3e39c000cba70a1fbd887f8f7a",
  bundle: "036cff37ed0b5850926224cb0afc75a159a558897d77ffc1f74e314bccf85b1d",
  exe: "a09ee422ccf2c678db1b41ed3d2dbbcf987be1585e0a7cdbbc858321778a35b4",
  core: "f003945f69bdf04e7ab66ea1319b50e22723b5e716047e8dbb2f4e21dc3710b4",
  asar: "e22221c092c28f1c1ce9115c3e3ac883ea37fa1c903ef14cde55ff09ee01fdae",
  bridge: "e1d9cbe0a91480f1b1f608e499ede409ef5a97daa8e38ca30eb27817415f6af0",
});
const MAX_PIXELS = 4_000_000;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const fail = message => { throw new Error("VISUAL_SMOKE_BLOCKED: " + message); };
const assert = (ok, message) => { if (!ok) fail(message); };
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const within = (file, folder) => {
  const relative = path.relative(folder, file);
  return !!relative && relative !== ".." && !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative);
};
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const ordinary = file => {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink(), "not an ordinary pinned file: " + file);
  return stat;
};
function sha256(file) {
  ordinary(file);
  const hash = createHash("sha256");
  const fd = fs.openSync(file, "r");
  const bytes = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const n = fs.readSync(fd, bytes, 0, bytes.length, null);
      if (!n) break;
      hash.update(bytes.subarray(0, n));
    }
  } finally { fs.closeSync(fd); }
  return hash.digest("hex");
}
const hashBytes = buffer => createHash("sha256").update(buffer).digest("hex");
function exactFile(file, sha) {
  assert(typeof sha === "string" && /^[a-f0-9]{64}$/i.test(sha), "bad SHA pin");
  assert(sha256(file) === sha.toLowerCase(), "original package SHA differs: " + file);
}
async function bounded(value, ms, description) {
  let timer;
  try {
    return await Promise.race([Promise.resolve(value), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("TIMEOUT: " + description)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, description, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  let previous;
  do {
    try {
      const item = await bounded(Promise.resolve().then(fn), 4000, description + " poll");
      if (item) return item;
    } catch (error) { previous = error; }
    await delay(150);
  } while (Date.now() < deadline);
  fail("timed out waiting for " + description + (previous ? ": " + previous.message : ""));
}
function powershell(script) {
  const call = spawnSync("powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, timeout: 12_000, maxBuffer: 256 * 1024, encoding: "utf8" });
  assert(!call.error && call.status === 0, "Windows read-only process ownership check failed");
  return call.stdout.trim();
}
function noForeignOwners() {
  powershell("$p=Get-CimInstance Win32_Process | Where-Object { " +
    "$_.ProcessId -eq 8616 -or $_.Name -in " +
    "@('Kreoda.exe','kreoda-core.exe','Kreoda.HermesBridge.exe') }; " +
    "if ($p) { exit 73 }; 'NO_FOREIGN_KREODA'");
}
function ownProcess(pid, expectedExecutable, expectedParent) {
  assert(Number.isInteger(pid) && pid > 0, "owned process PID is invalid");
  const p = JSON.parse(powershell("$p=Get-CimInstance Win32_Process -Filter " +
    "'ProcessId=" + pid + "'; if (-not $p) { exit 72 }; " +
    "$p | Select-Object ProcessId,ParentProcessId,ExecutablePath | ConvertTo-Json -Compress"));
  assert(p.ProcessId === pid && p.ParentProcessId === expectedParent &&
    samePath(p.ExecutablePath ?? "", expectedExecutable), "process PID / path / parent does not match packaged binary");
  return { pid, parentPid: p.ParentProcessId, exeSha256: sha256(expectedExecutable) };
}
function preflight() {
  // Check BEFORE generating evidence or starting any process.
  assert(process.platform === "win32" && process.arch === "x64" &&
    process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_OS === "Windows" &&
    process.env.RUNNER_ENVIRONMENT === "github-hosted" &&
    typeof process.env.GITHUB_WORKSPACE === "string" &&
    path.isAbsolute(process.env.GITHUB_WORKSPACE) &&
    samePath(process.env.GITHUB_WORKSPACE || "", root),
  "only isolated GitHub-hosted Windows x64 checkout is allowed");
  assert(process.argv.length === 3 &&
    process.argv[2] === "--prime-visual-grant=PRIME_APPROVED_GITHUB_HOSTED_VISUAL",
  "explicit separate prime GitHub-hosted visual-smoke grant required");
  noForeignOwners();

  const originalPath = path.join(output, RELEASE_ID, "release-manifest.json");
  exactFile(originalPath, SHA.originalManifest);
  ordinary(hostedManifest);
  const original = readJson(originalPath);
  const hosted = readJson(hostedManifest);
  assert(typeof hosted.portable === "string" && path.isAbsolute(hosted.portable) &&
    typeof hosted.bridgePublished === "string" && path.isAbsolute(hosted.bridgePublished) &&
    typeof hosted.zipPath === "string" && path.isAbsolute(hosted.zipPath),
  "hosted manifest must supply absolute exact binary/bundle paths");
  const portable = path.resolve(hosted.portable);
  const bridgeDir = path.resolve(hosted.bridgePublished);
  const expectedPortable = path.join(output, RELEASE_ID, "Kreoda-win32-x64");
  const expectedBridge = path.join(output, RELEASE_ID, "Kreoda.HermesBridge-net8.0");
  assert(original.releaseId === RELEASE_ID && original.status === "PACKAGED_UNSMOKED_NOT_PROMOTED" &&
    original.smokeRequired === true && hosted.releaseId === RELEASE_ID &&
    hosted.hostedRunner === true &&
    hosted.hostedReceiptSha256?.toLowerCase() === SHA.hostedReceipt &&
    hosted.hostedOriginalManifestSha256?.toLowerCase() === SHA.originalManifest &&
    hosted.zipSha256?.toLowerCase() === SHA.bundle &&
    samePath(portable, expectedPortable) && samePath(bridgeDir, expectedBridge) &&
    within(portable, output) && within(bridgeDir, output),
  "staging manifest does not name the original pinned candidate");
  assert(original.nativeCore?.sha256?.toLowerCase() === SHA.core &&
    original.packagedResources?.appAsarSha256?.toLowerCase() === SHA.asar &&
    original.bridge?.selfContained === false &&
    Array.isArray(original.bridge.publishedFiles) &&
    original.bridge.publishedFiles.length === 35,
  "original native-OCCT / ASAR / published Bridge manifest is inconsistent");
  const exe = path.join(portable, "Kreoda.exe");
  const coreExe = path.join(portable, "resources", "kreoda-core.exe");
  const appAsar = path.join(portable, "resources", "app.asar");
  const bridgeExe = path.join(bridgeDir, "Kreoda.HermesBridge.exe");
  for (const [file, expected] of [[exe, SHA.exe], [coreExe, SHA.core],
    [appAsar, SHA.asar], [bridgeExe, SHA.bridge], [hosted.zipPath, SHA.bundle]]) {
    exactFile(file, expected);
  }
  assert(within(path.resolve(hosted.zipPath), root), "bundle ZIP is outside hosted checkout");
  return { exe, coreExe, appAsar, bridgeExe, portable, originalPath,
    manifest: hostedManifest, bundle: hosted.zipPath };
}

// Decode the *real* PNG returned by Electron's webContents.capturePage.
// No test fixtures or made-up pixel buffers. Fail closed on unsupported PNGs.
function decodePng(png) {
  assert(Buffer.isBuffer(png) && png.length > 64 && png.length < 32 * 1024 * 1024 &&
    png.subarray(0, 8).equals(PNG_SIGNATURE), "not a bounded PNG screenshot");
  let offset = 8, width = 0, height = 0, depth = -1, color = -1, interlace = -1, ended = false;
  const compressed = [];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    assert(length <= 32 * 1024 * 1024 && offset + 12 + length <= png.length, "invalid PNG chunk");
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      assert(width === 0 && length === 13, "duplicate or malformed PNG IHDR");
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; color = data[9]; interlace = data[12];
      assert(width >= 200 && height >= 150 && width * height <= MAX_PIXELS &&
        depth === 8 && [2, 6].includes(color) &&
        data[10] === 0 && data[11] === 0 && interlace === 0,
      "unsupported / empty / excessively large viewport PNG");
    } else if (type === "IDAT") {
      compressed.push(data);
    } else if (type === "IEND") {
      assert(length === 0, "invalid PNG IEND");
      ended = true;
      break;
    } else if (type === "PLTE" || type === "tRNS" || type === "acTL" || type === "fcTL") {
      fail("unsupported paletted/animated/transparent-key PNG screenshot");
    }
    offset += 12 + length;
  }
  assert(ended && compressed.length > 0 && width > 0 && height > 0,
    "truncated PNG without pixels");
  const channels = color === 6 ? 4 : 3;
  const stride = width * channels, expectedBytes = height * (stride + 1);
  const raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: expectedBytes });
  assert(raw.length === expectedBytes, "PNG decompression size mismatch");
  const rgba = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride), sourceOffset = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[sourceOffset++];
    assert(filter <= 4, "unsupported PNG row filter");
    const line = Buffer.from(raw.subarray(sourceOffset, sourceOffset + stride));
    sourceOffset += stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x], upperLeft = x >= channels ? previous[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >>> 1;
      else if (filter === 4) {
        const p = left + up - upperLeft;
        const a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft);
        predictor = a <= b && a <= c ? left : b <= c ? up : upperLeft;
      }
      line[x] = (line[x] + predictor) & 255;
    }
    for (let x = 0; x < width; x++) {
      const src = x * channels, dst = (y * width + x) * 4;
      rgba[dst] = line[src]; rgba[dst + 1] = line[src + 1];
      rgba[dst + 2] = line[src + 2]; rgba[dst + 3] = channels === 4 ? line[src + 3] : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}
function rasterStats(image) {
  const total = image.width * image.height, histogram = new Map();
  let opaque = 0;
  for (let i = 0; i < image.rgba.length; i += 4) {
    const color = ((image.rgba[i] >>> 4) << 8) |
      ((image.rgba[i + 1] >>> 4) << 4) | (image.rgba[i + 2] >>> 4);
    histogram.set(color, (histogram.get(color) || 0) + 1);
    if (image.rgba[i + 3] >= 250) opaque++;
  }
  const dominant = Math.max(...histogram.values());
  return { width: image.width, height: image.height, pixels: total,
    quantizedColors: histogram.size, nonDominantPixelFraction: (total - dominant) / total,
    opaquePixelFraction: opaque / total, rawRgbaSha256: hashBytes(image.rgba) };
}
function rasterDifference(a, b) {
  assert(a.width === b.width && a.height === b.height,
    "before/after screenshots have different viewport dimensions");
  let changed = 0, energy = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    const dr = Math.abs(a.rgba[i] - b.rgba[i]);
    const dg = Math.abs(a.rgba[i + 1] - b.rgba[i + 1]);
    const db = Math.abs(a.rgba[i + 2] - b.rgba[i + 2]);
    if (Math.max(dr, dg, db) >= 24) changed++;
    energy += dr + dg + db;
  }
  return { changedPixels: changed, changedFraction: changed / (a.width * a.height),
    meanRgbAbsoluteDelta: energy / (a.width * a.height * 3) };
}
async function canvasRect(page) {
  const data = await bounded(page.evaluate(() => {
    const elements = document.querySelectorAll('[data-testid="viewport"] canvas');
    if (elements.length !== 1) throw new Error("expected exactly one actual viewport canvas");
    const canvas = elements[0];
    const context = canvas.getContext("webgl2");
    if (!context || context.isContextLost()) throw new Error("real WebGL2 viewport is unavailable");
    const bounds = canvas.getBoundingClientRect();
    const debug = context.getExtension("WEBGL_debug_renderer_info");
    const renderer = debug ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL) :
      context.getParameter(context.RENDERER);
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      backingWidth: canvas.width, backingHeight: canvas.height,
      dpr: devicePixelRatio, renderer: String(renderer), visible: getComputedStyle(canvas).display !== "none" };
  }), 7000, "actual WebGL viewport bounding box");
  assert(data.visible && [data.x, data.y, data.width, data.height,
    data.backingWidth, data.backingHeight].every(Number.isFinite) &&
    data.x >= 0 && data.y >= 0 && data.width >= 200 && data.height >= 150 &&
    data.backingWidth >= 200 && data.backingHeight >= 150 &&
    data.width <= 2200 && data.height <= 1600 &&
    data.renderer.length > 3, "viewport is invisible/empty/invalid");
  return data;
}
async function captureActualCanvas(app, page, targetFile) {
  const dom = await canvasRect(page);
  // capturePage samples the *actual Electron compositor*, not a DOM substitute
  // or screenshot generated from geometry metadata. Stay hidden throughout.
  const rect = { x: Math.floor(dom.x), y: Math.floor(dom.y),
    width: Math.ceil(dom.width), height: Math.ceil(dom.height) };
  const captured = await bounded(app.evaluate(async ({ BrowserWindow }, bounds) => {
    const windows = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed());
    if (windows.length !== 1 || windows[0].isVisible())
      throw new Error("expected exactly one hidden Electron BrowserWindow");
    const image = await windows[0].webContents.capturePage(bounds,
      { stayHidden: true, stayAwake: true });
    if (windows[0].isVisible()) throw new Error("viewport capture exposed a window");
    return { base64: image.toPNG().toString("base64"), width: image.getSize().width,
      height: image.getSize().height };
  }, rect), 15_000, "real hidden Electron compositor viewport capture");
  const png = Buffer.from(captured.base64, "base64");
  const image = decodePng(png);
  assert(image.width === captured.width && image.height === captured.height &&
    image.width >= Math.floor(rect.width / 2) && image.height >= Math.floor(rect.height / 2) &&
    image.width <= rect.width * 3 && image.height <= rect.height * 3,
  "capturePage returned wrong/empty compositor raster");
  fs.writeFileSync(targetFile, png, { flag: "wx" });
  return { image, file: path.basename(targetFile), pngSha256: hashBytes(png),
    bytes: png.length, dom, stats: rasterStats(image) };
}
function evidenceOfPixels(beforeA, beforeB, after) {
  const noise = rasterDifference(beforeA.image, beforeB.image);
  const change = rasterDifference(beforeB.image, after.image);
  const material = Math.max(300, Math.ceil(beforeB.image.width * beforeB.image.height * 0.004));
  assert(beforeB.image.rgba.length === after.image.rgba.length,
    "before and after have incompatible pixel buffers");
  assert(after.stats.opaquePixelFraction >= 0.99 &&
    after.stats.quantizedColors >= 8 &&
    after.stats.nonDominantPixelFraction >= 0.015,
  "real viewport AFTER screenshot is empty, flat or transparent");
  assert(change.changedPixels >= material &&
    change.changedPixels >= noise.changedPixels * 3 + 100 &&
    change.meanRgbAbsoluteDelta >= 1.0 &&
    change.meanRgbAbsoluteDelta >= noise.meanRgbAbsoluteDelta * 2,
  "genuine after-box pixels do not materially differ from stable empty viewport");
  return { baselineNoise: noise, afterGeometryChange: change, minimumChangedPixels: material,
    accepted: true, criteria: "RGBA PNG pixel delta >=24; >=0.4% changed; >3x empty-scene drift" };
}
async function main() {
  const gate = preflight();
  fs.mkdirSync(visualRoot, { recursive: true });
  const proofDir = fs.mkdtempSync(path.join(visualRoot, "hosted-"));
  // Never upload the disposable app profile with visual evidence.
  const tmpRoot = path.join(root, ".codex", "tmp");
  fs.mkdirSync(tmpRoot, { recursive: true });
  const profile = fs.mkdtempSync(path.join(tmpRoot, "visual-profile-"));
  const env = { ...process.env, KREODA_BACKGROUND_TEST: "1", KREODA_RECOVERY_DIR: path.join(profile, "recovery"),
    KREODA_PLUGINS_DIR: path.join(profile, "plugins"), TEMP: profile, TMP: profile, TMPDIR: profile,
    APPDATA: path.join(profile, "roaming"), LOCALAPPDATA: path.join(profile, "local"),
    KREODA_HERMES_CONFIG: "", KREODA_VOICE_TOKEN: "", KREODA_UPDATE_FEED: "", KREODA_UPDATE_PUBKEY: "" };
  for (const name of ["KREODA_AUTOMATIC_LOOPBACK_TEST", "KREODA_SESSION_HOST",
    "KREODA_SESSION_PORT", "KREODA_SESSION_TOKEN", "KREODA_CAD_SESSION_URL",
    "KREODA_CAD_PAIR", "KREODA_CAD_PC_ID", "ELECTRON_RUN_AS_NODE"]) delete env[name];
  for (const folder of [env.APPDATA, env.LOCALAPPDATA]) fs.mkdirSync(folder, { recursive: true });
  const result = { status: "FAIL_OR_BLOCKED", scenario: "hosted-hidden-real-canvas-raster-after-native-box",
    startedAtUtc: new Date().toISOString(), releaseId: RELEASE_ID, runner: "github-hosted-windows-x64",
    pinned: { originalManifestSha256: SHA.originalManifest, bundleSha256: SHA.bundle,
      exeSha256: SHA.exe, coreSha256: SHA.core, appAsarSha256: SHA.asar,
      separatelyPublishedBridgeSha256: SHA.bridge }, files: [], checks: [] };
  let app, failure, nativePid = null;
  try {
    const require = createRequire(path.join(root, "apps", "desktop", "package.json"));
    const { _electron: electron } = require("@playwright/test");
    app = await bounded(electron.launch({
      executablePath: gate.exe, args: ["--no-sandbox", "--lang=en-US", "--start-hidden",
        `--user-data-dir=${profile}`], env, timeout: 40_000,
    }), 50_000, "launch ORIGINAL hidden packaged Kreoda.exe");
    const appPid = app.process()?.pid;
    result.ownedElectron = ownProcess(appPid, gate.exe, process.pid);
    const identity = await bounded(app.evaluate(({ app, BrowserWindow }) => ({
      isPackaged: app.isPackaged, executable: process.execPath, appPath: app.getAppPath(),
      resources: process.resourcesPath, userData: app.getPath("userData"),
      visibleWindows: BrowserWindow.getAllWindows().filter(w => w.isVisible()).length,
    })), 10_000, "exact executable/resources/profile inspection");
    assert(identity.isPackaged && samePath(identity.executable, gate.exe) &&
      samePath(identity.appPath, gate.appAsar) &&
      samePath(identity.resources, path.join(gate.portable, "resources")) &&
      (samePath(identity.userData, profile) || within(identity.userData, profile)),
    "wrong executable/resources or non-isolated Electron profile");
    assert(identity.visibleWindows === 0, "window exposed before viewport capture");
    result.checks.push({ name: "packaged-hidden-provenance", pass: true });
    const page = await bounded(app.firstWindow({ timeout: 30_000 }), 35_000, "hidden packaged renderer");
    await page.getByTestId("home-screen").waitFor({ state: "visible", timeout: 25_000 });
    await page.getByTestId("home-new-project").click({ timeout: 12_000 });
    await page.getByTestId("workspace-chrome").waitFor({ state: "visible", timeout: 20_000 });
    await page.getByText(/core 0\.1\.0(?!-stub)/i).waitFor({ state: "visible", timeout: 20_000 });
    await page.getByTestId("viewport").locator("canvas").waitFor({ state: "visible", timeout: 20_000 });
    const core = await until(async () => {
      const info = await bounded(page.evaluate(() => window.kreoda.coreInfo()),
        4000, "native coreInfo");
      return info?.running && Number.isInteger(info.pid) && info.pid > 0 ? info : null;
    }, "real packaged native core");
    result.ownedNative = ownProcess(core.pid, gate.coreExe, appPid);
    nativePid = core.pid;
    result.checks.push({ name: "actual-packaged-OCCT-child", pass: true });
    const initial = await bounded(page.evaluate(() => window.__kreoda_test?.snapshot()),
      8000, "empty native CAD snapshot");
    assert(initial && Array.isArray(initial.bodies) && initial.bodies.length === 0,
      "new project already contains solids; cannot capture unambiguous before-frame");
    await delay(300);
    const a = await captureActualCanvas(app, page, path.join(proofDir, "before-a.png"));
    await delay(250);
    const b = await captureActualCanvas(app, page, path.join(proofDir, "before-b.png"));
    result.files.push({ name: a.file, pngSha256: a.pngSha256, bytes: a.bytes },
      { name: b.file, pngSha256: b.pngSha256, bytes: b.bytes });
    result.before = { ...b.stats, dom: b.dom };
    // Real UI operations, identical to existing packaged smoke and E2E helpers.
    await page.getByRole("button", { name: "Add", exact: true }).click({ timeout: 8000 });
    await page.getByRole("button", { name: /Add box/ }).click({ timeout: 8000 });
    await page.getByRole("button", { name: "Create", exact: true }).click({ timeout: 10_000 });
    await page.getByRole("button", { name: "Create", exact: true })
      .waitFor({ state: "hidden", timeout: 8000 });
    const snapshot = await until(async () => {
      const value = await bounded(page.evaluate(() => window.__kreoda_test?.snapshot()),
        5000, "post-add native scene snapshot");
      const body = value?.bodies?.[0];
      return value?.bodies?.length === 1 && body && body.triangles > 0 &&
        Number.isFinite(body.volumeMm3) && body.volumeMm3 > 0 &&
        body.geometryCurrent !== false && body.status !== "blocked" ? value : null;
    }, "one real native BRep with triangles and volume", 30_000);
    const body = snapshot.bodies[0];
    assert(Array.isArray(body.paramsMm) && body.paramsMm.length === 3 &&
      body.paramsMm.every(value => Number.isFinite(value) && value > 0) &&
      Number.isFinite(body.triangles) && body.triangles > 0, "native box shape is invalid");
    const expectedVolume = body.paramsMm.reduce((product, value) => product * value, 1);
    assert(Math.abs(body.volumeMm3 - expectedVolume) <=
      Math.max(0.01, expectedVolume * 1e-6), "OCCT BRep volume contradicts actual box dimensions");
    await delay(450);
    const after = await captureActualCanvas(app, page, path.join(proofDir, "after.png"));
    result.files.push({ name: after.file, pngSha256: after.pngSha256, bytes: after.bytes });
    result.after = { ...after.stats, dom: after.dom };
    result.geometry = { bodyId: body.id, triangles: body.triangles, volumeMm3: body.volumeMm3,
      dimensionsMm: body.paramsMm, revision: snapshot.revision, geometryCurrent: body.geometryCurrent ?? null };
    result.raster = evidenceOfPixels(a, b, after);
    result.checks.push({ name: "real-native-OCCT-box-triangles-volume", pass: true },
      { name: "actual-webgl2-compositor-before-after-pixels", pass: true });
    result.status = "PASS_PACKAGED_REAL_OCCT_VISIBLE_CANVAS_PIXELS_HIDDEN_WINDOW";
  } catch (error) {
    failure = error;
    result.error = { kind: error?.name ?? "Error",
      message: String(error?.message ?? error).slice(0, 600) };
  } finally {
    if (app) {
      try { await bounded(app.close(), 15_000, "close exact owned Electron"); }
      catch (error) {
        result.shutdownError = String(error?.message ?? error).slice(0, 250);
        app.process()?.kill(); // OUR launched PID only; never Stop-Process by image name.
      }
    }
    try {
      for (const [file, expected] of [[gate.exe, SHA.exe], [gate.coreExe, SHA.core],
        [gate.appAsar, SHA.asar], [gate.bridgeExe, SHA.bridge]]) exactFile(file, expected);
      if (nativePid) {
        const lingering = powershell("$p=Get-CimInstance Win32_Process -Filter 'ProcessId=" +
          nativePid + "'; if ($p) { $p.ExecutablePath }");
        assert(!lingering || !samePath(lingering, gate.coreExe),
          "real packaged OCCT child remained after Electron close");
      }
    } catch (error) {
      failure ??= error;
      result.postflightError = String(error?.message ?? error).slice(0, 400);
    }
    try { fs.rmSync(profile, { recursive: true, force: true }); }
    catch (error) { failure ??= error; result.profileCleanupError = "isolated profile removal failed"; }
    if (result.shutdownError || result.postflightError || result.profileCleanupError || failure)
      result.status = "FAIL_OR_BLOCKED";
    result.finishedAtUtc = new Date().toISOString();
    fs.writeFileSync(path.join(proofDir, "receipt.json"),
      JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ status: result.status, artifactDirectory: proofDir,
      screenshots: result.files.length, passed: result.checks.length,
      failed: Boolean(failure || result.shutdownError) }));
  }
  if (failure) throw failure;
  assert(result.status === "PASS_PACKAGED_REAL_OCCT_VISIBLE_CANVAS_PIXELS_HIDDEN_WINDOW",
    "visual smoke did not satisfy every real rendered-pixel gate");
}

main().catch(error => {
  console.error("visual smoke failed closed: " + String(error?.message ?? error).slice(0, 600));
  process.exitCode = 1;
});
