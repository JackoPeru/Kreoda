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
// Playwright may interpose a Windows launcher/driver, so an immediate parent
// equal to the test's process.pid is NOT an invariant. Traverse a strictly
// bounded, real Win32_Process ancestor chain instead; require BOTH the
// Playwright-launched PID and our current Node PID in the Electron main tree.
// Do not log process command lines or the environment (they may hold secrets).
function processTree(pid, ownerPid) {
  assert(Number.isSafeInteger(pid) && pid > 0 &&
    Number.isSafeInteger(ownerPid) && ownerPid > 0, "owned process PID is invalid");
  const script = "$current=" + pid + "; $seen=@{}; $rows=@(); " +
    "for($i=0;$i -lt 10;$i++){ " +
    "if($current -le 0 -or $seen.ContainsKey([string]$current)){break}; " +
    "$seen[[string]$current]=$true; " +
    "$p=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $current); " +
    "if(-not $p){break}; " +
    "$created=if($p.CreationDate){$p.CreationDate.ToUniversalTime().ToString('o')}else{''}; " +
    "$rows+= [pscustomobject]@{pid=[int]$p.ProcessId;parentPid=[int]$p.ParentProcessId;" +
    "name=[string]$p.Name;image=[string]$p.ExecutablePath;createdUtc=$created}; " +
    "if($current -eq " + ownerPid + "){break}; " +
    "$current=[int]$p.ParentProcessId; " +
    "}; ConvertTo-Json -InputObject @($rows) -Compress -Depth 3";
  const nodes = JSON.parse(powershell(script));
  assert(Array.isArray(nodes) && nodes.length > 0 && nodes.length <= 10 &&
    nodes[0]?.pid === pid, "Windows process identity unavailable");
  return nodes;
}
function ownProcess(pid, expectedExecutable, expectedSha, requiredAncestors, receipt, label, earliestStart, directParent = null) {
  // Persist restricted diagnostics even if an ownership assertion fails.
  // The PIDs and image *names* are enough to diagnose the hosted wrapper;
  // never put arbitrary Win32 command lines or environment in the receipt.
  const record = { targetPid: pid ?? null, requiredAncestors, checked: false };
  receipt.ownershipDiagnostics ??= {};
  receipt.ownershipDiagnostics[label] = record;
  assert(Number.isSafeInteger(pid) && pid > 0 &&
    requiredAncestors.length > 0 &&
    requiredAncestors.every(value => Number.isSafeInteger(value) && value > 0),
  "invalid process identity anchor");
  const chain = processTree(pid, requiredAncestors.at(-1));
  record.chain = chain.map(row => ({ pid: row.pid, parentPid: row.parentPid, name: row.name }));
  record.executableMatchesPinnedPath = samePath(chain[0].image || "", expectedExecutable);
  record.executableSha256MatchesPin = sha256(expectedExecutable) === expectedSha;
  // A PID chain alone is not ownership: an untrusted executable could sit
  // between Playwright's launcher and Electron. Every ancestor must be this
  // exact packaged Electron image, this test's exact Node image or the
  // trusted Windows System32 cmd.exe launcher (never arbitrary executables).
  const trustedCmd = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe");
  const pinnedElectron = path.join(output, RELEASE_ID, "Kreoda-win32-x64", "Kreoda.exe");
  record.trustedAncestryImages = chain.slice(1).every(row =>
    [expectedExecutable, pinnedElectron, process.execPath, trustedCmd]
      .some(image => samePath(row.image || "", image)));
  record.testNodeImageTrusted = samePath(chain.at(-1)?.image || "", process.execPath);
  record.anchorsPresent = requiredAncestors.map(ancestor => ({
    pid: ancestor, inChain: chain.some(row => row.pid === ancestor),
  }));
  const indices = requiredAncestors.map(ancestor => chain.findIndex(row => row.pid === ancestor));
  record.ancestryOrdered = indices.every((index, i) =>
    index >= 0 && (i === 0 || index >= indices[i - 1])) &&
    chain.at(-1)?.pid === requiredAncestors.at(-1);
  const launcher = chain[indices[0]];
  record.launcherImageTrusted = !!launcher &&
    [expectedExecutable, pinnedElectron, process.execPath, trustedCmd]
      .some(image => samePath(launcher.image || "", image));
  const launcherBorn = Date.parse(launcher?.createdUtc ?? "");
  record.launcherStartedSinceLaunch = Number.isFinite(launcherBorn) &&
    launcherBorn >= earliestStart - 8_000 && launcherBorn <= Date.now() + 2_000;
  record.directParentMatches = directParent === null || chain[0].parentPid === directParent;
  // Parent PIDs may be reused on Windows. Never accept an ancestor process
  // created after the child it supposedly launched.
  const born = chain.map(row => Date.parse(row.createdUtc ?? ""));
  record.ancestryTimestampsValid = born.every((value, i) =>
    Number.isFinite(value) && (i === 0 || value <= born[i - 1] + 2_000));
  const createdAtMs = Date.parse(chain[0].createdUtc ?? "");
  record.creationSinceLaunch = Number.isFinite(createdAtMs) &&
    createdAtMs >= earliestStart - 8_000 && createdAtMs <= Date.now() + 2_000;
  record.checked = true;
  assert(record.executableMatchesPinnedPath && record.executableSha256MatchesPin &&
    record.trustedAncestryImages && record.testNodeImageTrusted &&
    record.launcherImageTrusted && record.launcherStartedSinceLaunch &&
    record.anchorsPresent.every(row => row.inChain) && record.ancestryOrdered &&
    record.directParentMatches && record.ancestryTimestampsValid &&
    record.creationSinceLaunch,
  "actual Windows process image/launch-time/ancestry does not match pinned owned process");
  return { pid, parentPid: chain[0].parentPid, createdUtc: chain[0].createdUtc,
    exeSha256: sha256(expectedExecutable), launchOriginNodePid: process.pid,
    ancestryDepth: chain.length };
}
function terminateAttestedElectronIfUnchanged(identity, executable, receipt) {
  // app.process() may be a cmd.exe wrapper. Never terminate that PID.
  // On failed close, only the previously attested Electron MAIN PID may be
  // terminated, after fresh OS image / SHA / creation-time verification.
  const record = { requestedPid: identity?.pid ?? null, exactIdentityMatch: false,
    attempted: false };
  receipt.shutdownFallback = record;
  if (!identity || !Number.isSafeInteger(identity.pid) || !identity.createdUtc) return;
  try {
    const tree = processTree(identity.pid, process.pid);
    const live = tree[0];
    record.exactIdentityMatch = live.pid === identity.pid &&
      live.parentPid === identity.parentPid &&
      live.createdUtc === identity.createdUtc &&
      samePath(live.image || "", executable) &&
      sha256(executable) === SHA.exe && identity.exeSha256 === SHA.exe;
    if (!record.exactIdentityMatch) return;
    record.attempted = true;
    process.kill(identity.pid);
  } catch {
    // Already exited, inaccessible or changed identity: never kill another
    // process and retain the original shutdown failure in receipt.json.
    record.verifiedTermination = false;
  }
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
function centralRoi(image) {
  // The CAD body is centered on this viewport. Ignore outer toolbars, while
  // keeping the ORIGINAL full-canvas threshold as a separate mandatory gate.
  const x = Math.floor(image.width * 0.2), y = Math.floor(image.height * 0.2);
  return { x, y, width: Math.floor(image.width * 0.8) - x,
    height: Math.floor(image.height * 0.8) - y };
}
function rasterDifference(a, b, region = null) {
  assert(a.width === b.width && a.height === b.height,
    "before/after screenshots have different viewport dimensions");
  const bounds = region ?? { x: 0, y: 0, width: a.width, height: a.height };
  assert(bounds.width > 0 && bounds.height > 0 && bounds.x >= 0 && bounds.y >= 0 &&
    bounds.x + bounds.width <= a.width && bounds.y + bounds.height <= a.height,
  "invalid real screenshot pixel comparison rectangle");
  let changed = 0, energy = 0;
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      const i = (y * a.width + x) * 4;
      const dr = Math.abs(a.rgba[i] - b.rgba[i]);
      const dg = Math.abs(a.rgba[i + 1] - b.rgba[i + 1]);
      const db = Math.abs(a.rgba[i + 2] - b.rgba[i + 2]);
      if (Math.max(dr, dg, db) >= 24) changed++;
      energy += dr + dg + db;
    }
  }
  const count = bounds.width * bounds.height;
  return { changedPixels: changed, comparedPixels: count, changedFraction: changed / count,
    meanRgbAbsoluteDelta: energy / (count * 3) };
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
  return { image, path: targetFile, file: path.basename(targetFile), pngSha256: hashBytes(png),
    bytes: png.length, dom, stats: rasterStats(image) };
}
function evidenceOfPixels(beforeA, beforeB, after, result) {
  const noise = rasterDifference(beforeA.image, beforeB.image);
  const change = rasterDifference(beforeB.image, after.image);
  const roi = centralRoi(beforeB.image);
  const roiNoise = rasterDifference(beforeA.image, beforeB.image, roi);
  const roiChange = rasterDifference(beforeB.image, after.image, roi);
  const material = Math.max(300, Math.ceil(beforeB.image.width * beforeB.image.height * 0.004));
  const materialRoi = Math.max(300, Math.ceil(roi.width * roi.height * 0.004));
  const metrics = { baselineNoise: noise, afterGeometryChange: change,
    minimumChangedPixels: material, centralRoi: roi,
    centralBaselineNoise: roiNoise, centralGeometryChange: roiChange,
    minimumCentralChangedPixels: materialRoi, accepted: false,
    criteria: "actual PNG RGB delta>=24; >=0.4% changed for full canvas AND central CAD ROI; both >3x baseline drift" };
  // Keep metrics even on failure, so hosted JSON + real probe PNGs can
  // distinguish a blank canvas, a transient frame and an overlay.
  result.raster = metrics;
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
  assert(roiChange.changedPixels >= materialRoi &&
    roiChange.changedPixels >= roiNoise.changedPixels * 3 + 100 &&
    roiChange.meanRgbAbsoluteDelta >= 1.0 &&
    roiChange.meanRgbAbsoluteDelta >= roiNoise.meanRgbAbsoluteDelta * 2,
  "central CAD viewport shows no material BRep geometry change");
  metrics.accepted = true;
  return metrics;
}
// The previous hosted run captured HOME in before-a and ONBOARDING in
// before-b. A visible canvas is NOT proof that the CAD route has settled.
// Snapshot only sanitized UI states, never modal text, command lines or
// session configuration in uploaded receipt.json.
async function uiState(page) {
  return bounded(page.evaluate(() => {
    const visible = element => !!element && element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== "hidden";
    const countVisible = selector =>
      [...document.querySelectorAll(selector)].filter(visible).length;
    const snapshot = window.__kreoda_test?.snapshot?.();
    const canvas = document.querySelector('[data-testid="viewport"] canvas');
    return {
      homeVisible: countVisible('[data-testid="home-screen"]') > 0,
      workspaceVisible: countVisible('[data-testid="workspace-chrome"]') === 1,
      canvasVisible: visible(canvas),
      onboardingVisible: countVisible('[data-testid="onboarding"]') > 0,
      modalCount: countVisible('[role="dialog"]'),
      modalOverlayCount: countVisible('[data-radix-dialog-overlay]'),
      nativeBodies: snapshot?.bodies?.length ?? null,
    };
  }), 6000, "sanitized real CAD workspace/modal state");
}
async function ensureClearWorkspace(page, requiredBodies, result) {
  const state = await uiState(page);
  result.lastUiState = state;
  assert(!state.homeVisible && state.workspaceVisible && state.canvasVisible &&
    !state.onboardingVisible && state.modalCount === 0 &&
    state.modalOverlayCount === 0 && state.nativeBodies === requiredBodies,
  "CAD workspace not settled/empty of onboarding and modal overlays");
  return state;
}
function sourceStatus() {
  const script = fileURLToPath(import.meta.url);
  const runGit = args => {
    const response = spawnSync("git.exe", ["-C", root, ...args],
      { encoding: "utf8", windowsHide: true, timeout: 7000, maxBuffer: 4096 });
    return !response.error && response.status === 0 ? response.stdout.trim() : null;
  };
  return { smokeScriptSha256: sha256(script), gitHead: runGit(["rev-parse", "HEAD"]),
    scriptWorkingTreeStatus: runGit(["status", "--short", "--",
      "scripts/ci/candidate-visual-render-smoke.mjs"]) };
}
function stableCompositor(previous, current) {
  const comparable = previous.image.width === current.image.width &&
    previous.image.height === current.image.height &&
    previous.dom.backingWidth === current.dom.backingWidth &&
    previous.dom.backingHeight === current.dom.backingHeight &&
    previous.dom.renderer === current.dom.renderer &&
    previous.dom.x === current.dom.x && previous.dom.y === current.dom.y;
  if (!comparable) return { comparable: false, stable: false };
  const full = rasterDifference(previous.image, current.image);
  const center = rasterDifference(previous.image, current.image, centralRoi(current.image));
  // This is a MAXIMUM permitted baseline/settling drift, not a relaxed
  // detection threshold. Evidence of a new BRep still requires >0.4%.
  const stable = full.changedFraction <= 0.001 && center.changedFraction <= 0.001 &&
    full.meanRgbAbsoluteDelta <= 0.35 && center.meanRgbAbsoluteDelta <= 0.35;
  return { comparable, stable, full, center };
}
async function settledCanvasPair(app, page, proofDir, result, stage, bodies) {
  const records = [];
  const limit = Date.now() + 45_000;
  result.settlement ??= {};
  result.settlement[stage] = { stable: false, attempts: [] };
  for (let attempt = 1; attempt <= 8 && Date.now() < limit; attempt++) {
    await ensureClearWorkspace(page, bodies, result);
    const file = path.join(proofDir, `${stage}-probe-${String(attempt).padStart(2, "0")}.png`);
    const frame = await captureActualCanvas(app, page, file);
    result.files.push({ name: frame.file, pngSha256: frame.pngSha256, bytes: frame.bytes });
    await ensureClearWorkspace(page, bodies, result);
    const emptyGridValid = stage !== "baseline" ||
      (frame.stats.opaquePixelFraction >= 0.99 &&
        frame.stats.quantizedColors >= 4 &&
        frame.stats.nonDominantPixelFraction >= 0.008);
    const comparison = records.length ? stableCompositor(records.at(-1), frame) : null;
    const event = { attempt, filename: frame.file, width: frame.image.width,
      height: frame.image.height, sha256: frame.pngSha256,
      gridNonempty: emptyGridValid, comparison };
    result.settlement[stage].attempts.push(event);
    records.push(frame);
    if (comparison?.stable && emptyGridValid) {
      result.settlement[stage].stable = true;
      result.settlement[stage].consecutiveStableScreenshots = 2;
      result.settlement[stage].finalDrift = comparison;
      return records.slice(-2);
    }
    await delay(350);
  }
  fail(`bounded ${stage} viewport never produced two consecutive stable non-overlaid real canvas PNGs`);
}
function copyEvidence(source, file, result) {
  // The source is already a real PNG saved by webContents.capturePage.
  fs.copyFileSync(source.path, file, fs.constants.COPYFILE_EXCL);
  result.files.push({ name: path.basename(file), pngSha256: source.pngSha256,
    bytes: source.bytes });
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
      separatelyPublishedBridgeSha256: SHA.bridge }, sourceStatus: sourceStatus(),
    stage: "prelaunch", files: [], checks: [] };
  let app, page, failure, nativePid = null;
  try {
    const require = createRequire(path.join(root, "apps", "desktop", "package.json"));
    const { _electron: electron } = require("@playwright/test");
    const launchStartedAt = Date.now();
    app = await bounded(electron.launch({
      executablePath: gate.exe, args: ["--no-sandbox", "--lang=en-US", "--start-hidden",
        `--user-data-dir=${profile}`], env, timeout: 40_000,
    }), 50_000, "launch ORIGINAL hidden packaged Kreoda.exe");
    const launcherPid = app.process()?.pid;
    const identity = await bounded(app.evaluate(({ app, BrowserWindow }) => ({
      isPackaged: app.isPackaged, executable: process.execPath, appPath: app.getAppPath(),
      resources: process.resourcesPath, userData: app.getPath("userData"),
      mainPid: process.pid,
      visibleWindows: BrowserWindow.getAllWindows().filter(w => w.isVisible()).length,
    })), 10_000, "exact executable/resources/profile inspection");
    // The real Electron main PID is read inside its main process, and must be
    // descended from Playwright's launched PID AND this smoke's Node process.
    result.ownedElectron = ownProcess(identity.mainPid, gate.exe, SHA.exe,
      [launcherPid, process.pid], result, "electron", launchStartedAt);
    const appPid = identity.mainPid;
    assert(identity.isPackaged && samePath(identity.executable, gate.exe) &&
      samePath(identity.appPath, gate.appAsar) &&
      samePath(identity.resources, path.join(gate.portable, "resources")) &&
      (samePath(identity.userData, profile) || within(identity.userData, profile)),
    "wrong executable/resources or non-isolated Electron profile");
    assert(identity.visibleWindows === 0, "window exposed before viewport capture");
    result.checks.push({ name: "packaged-hidden-provenance", pass: true });
    result.stage = "enter-cad-workspace";
    page = await bounded(app.firstWindow({ timeout: 30_000 }), 35_000, "hidden packaged renderer");
    await page.getByTestId("home-screen").waitFor({ state: "visible", timeout: 25_000 });
    await page.getByTestId("home-new-project").click({ timeout: 12_000 });
    await page.getByTestId("workspace-chrome").waitFor({ state: "visible", timeout: 20_000 });
    await page.getByTestId("home-screen").waitFor({ state: "hidden", timeout: 20_000 });
    await page.getByText(/core 0\.1\.0(?!-stub)/i).waitFor({ state: "visible", timeout: 20_000 });
    await page.getByTestId("viewport").locator("canvas").waitFor({ state: "visible", timeout: 20_000 });
    // Fresh isolated profiles can display the first-run onboarding OVER the
    // live viewport. Dismiss it with the actual button (never mutate DOM,
    // localStorage, native scene or screenshot data).
    const onboarding = page.getByTestId("onboarding");
    try { await onboarding.waitFor({ state: "visible", timeout: 5000 }); }
    catch { /* A previously dismissed onboarding is also permitted. */ }
    if (await onboarding.isVisible()) {
      await onboarding.getByRole("button", { name: "Dismiss", exact: true })
        .click({ timeout: 8000 });
      await onboarding.waitFor({ state: "hidden", timeout: 12_000 });
      result.onboarding = "dismissed-through-real-ui";
    } else {
      result.onboarding = "not-shown";
    }
    const core = await until(async () => {
      const info = await bounded(page.evaluate(() => window.kreoda.coreInfo()),
        4000, "native coreInfo");
      return info?.running && Number.isInteger(info.pid) && info.pid > 0 ? info : null;
    }, "real packaged native core");
    result.ownedNative = ownProcess(core.pid, gate.coreExe, SHA.core,
      [appPid, process.pid], result, "native", launchStartedAt, appPid);
    nativePid = core.pid;
    result.checks.push({ name: "actual-packaged-OCCT-child", pass: true });
    result.stage = "stable-empty-cad-baseline";
    await until(async () => {
      const state = await uiState(page);
      result.lastUiState = state;
      return !state.homeVisible && state.workspaceVisible && state.canvasVisible &&
        !state.onboardingVisible && state.modalCount === 0 &&
        state.modalOverlayCount === 0 && state.nativeBodies === 0;
    }, "fully rendered empty CAD workspace without HOME/onboarding/modal", 20_000);
    const [a, b] = await settledCanvasPair(app, page, proofDir, result, "baseline", 0);
    copyEvidence(a, path.join(proofDir, "before-a.png"), result);
    copyEvidence(b, path.join(proofDir, "before-b.png"), result);
    result.before = { ...b.stats, dom: b.dom };
    result.checks.push({ name: "stable-real-grid-baseline-without-home-onboarding-modal", pass: true });
    // Real UI operations, identical to existing packaged smoke and E2E helpers.
    result.stage = "create-real-native-box-and-close-entire-dialog";
    await page.getByRole("button", { name: "Add", exact: true }).click({ timeout: 8000 });
    await page.getByRole("button", { name: /Add box/ }).click({ timeout: 8000 });
    // The button changes its label from Create to Building... during native
    // work; waiting for the Create *button* to disappear was a false success.
    const addBoxDialog = page.getByRole("dialog", { name: /Add box/i });
    await addBoxDialog.waitFor({ state: "visible", timeout: 10_000 });
    await addBoxDialog.getByRole("button", { name: "Create", exact: true })
      .click({ timeout: 10_000 });
    await addBoxDialog.waitFor({ state: "hidden", timeout: 45_000 });
    result.addBoxDialog = "entire-radix-dialog-closed-after-native-submit";
    await until(async () => {
      const status = await uiState(page);
      result.lastUiState = status;
      return status.workspaceVisible && !status.homeVisible &&
        !status.onboardingVisible && status.modalCount === 0 &&
        status.modalOverlayCount === 0 && status.nativeBodies === 1;
    }, "box dialog fully gone and exactly one CAD body present", 20_000);
    await ensureClearWorkspace(page, 1, result);
    result.stage = "verify-real-native-brep";
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
    result.stage = "stable-post-box-compositor";
    const [, after] = await settledCanvasPair(app, page, proofDir, result, "post-box", 1);
    copyEvidence(after, path.join(proofDir, "after.png"), result);
    result.after = { ...after.stats, dom: after.dom };
    result.geometry = { bodyId: body.id, triangles: body.triangles, volumeMm3: body.volumeMm3,
      dimensionsMm: body.paramsMm, revision: snapshot.revision, geometryCurrent: body.geometryCurrent ?? null };
    result.stage = "pixel-delta-and-central-roi";
    result.raster = evidenceOfPixels(a, b, after, result);
    result.raster.postBoxSettlement = result.settlement["post-box"].finalDrift;
    result.checks.push({ name: "real-native-OCCT-box-triangles-volume", pass: true },
      { name: "actual-webgl2-compositor-before-after-pixels", pass: true });
    result.stage = "passed-all-real-geometry-and-raster-gates";
    result.status = "PASS_PACKAGED_REAL_OCCT_VISIBLE_CANVAS_PIXELS_HIDDEN_WINDOW";
  } catch (error) {
    failure = error;
    result.error = { kind: error?.name ?? "Error",
      message: String(error?.message ?? error).slice(0, 600) };
    if (page) {
      try { result.failureUiState = await uiState(page); }
      catch { result.failureUiState = { available: false }; }
    }
  } finally {
    if (app) {
      try { await bounded(app.close(), 15_000, "close exact owned Electron"); }
      catch (error) {
        result.shutdownError = String(error?.message ?? error).slice(0, 250);
        terminateAttestedElectronIfUnchanged(result.ownedElectron, gate.exe, result);
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
