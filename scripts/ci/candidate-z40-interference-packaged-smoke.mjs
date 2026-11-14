// GitHub-hosted Windows x64 acceptance for the IMMUTABLE new z40 *packaged*
// candidate. This is NOT a source/Dev Electron test. No CI or app modifications.
// Required: KREODA_Z40_EXTRACTED_ROOT = absolute RELEASE directory containing
//   Kreoda-win32-x64, release-manifest.json, KreodaQuest.apk.
// Candidate ZIP: KREODA_Z40_CANDIDATE_ZIP, or the fixed workspace artifact path.
// node scripts/ci/candidate-z40-interference-packaged-smoke.mjs \
//   --prime-z40-interference-grant=PRIME_APPROVED_GITHUB_HOSTED_Z40_INTERFERENCE
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const releaseId = "0.1.0-integrated-renderer-z40-9d11ef58-225199551549";
const zipName = "Kreoda-" + releaseId + "-Desktop-Bridge-Quest.zip";
const SHA = Object.freeze({
  zip: "1cca3180578c35d3a5f81f0405d931eea66de63df50d0727d4bc76ccfb57a8b4",
  zipReceipt: "a89c263a88acbb3ec2145fda313c312afcb3803012be8949e1e8efd8bfb4985b",
  manifest: "fc62d7e8bad7ebdebd37e15c226ef13dc5467118d39e27cf4fc35a4a7374119e",
  exe: "f273568c294ace3dee30b15df9fc514999bfec309c2b9987f4a7f92888963e23",
  asar: "121b8083d3dec16f0cfa3343ff0b0b31753813c1451f14ade266d31782998f5e",
  core: "f003945f69bdf04e7ab66ea1319b50e22723b5e716047e8dbb2f4e21dc3710b4",
  originalBundle: "036cff37ed0b5850926224cb0afc75a159a558897d77ffc1f74e314bccf85b1d",
  originalAsar: "e22221c092c28f1c1ce9115c3e3ac883ea37fa1c903ef14cde55ff09ee01fdae",
  sourceUi: "225199551549cebe7a35ee5a02f71bbda743a80dd0e9a99d34941871a408a993",
  bridge: "e1d9cbe0a91480f1b1f608e499ede409ef5a97daa8e38ca30eb27817415f6af0",
  quest: "827ed6025777c3b1538ce01610984d61300cd4fbcced9d641f66dbc1915dd7bb",
});
const fail = reason => { throw Error("Z40_BLOCKED: " + reason); };
const check = (condition, reason) => { if (!condition) fail(reason); };
const hex = value => typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
const same = (a, b) => typeof a === "string" && typeof b === "string" &&
  a.length > 0 && b.length > 0 &&
  path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const within = (child, parent) => {
  if (!child || !parent) return false;
  const relative = path.relative(parent, child);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative);
};
function regular(file) {
  const stat = fs.lstatSync(file);
  check(stat.isFile() && !stat.isSymbolicLink(), "release contains nonordinary file");
  return stat;
}
function sha256(file) {
  regular(file);
  const digest = createHash("sha256");
  const handle = fs.openSync(file, "r");
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = fs.readSync(handle, chunk, 0, chunk.length, null);
      if (!count) break;
      digest.update(chunk.subarray(0, count));
    }
  } finally { fs.closeSync(handle); }
  return digest.digest("hex");
}
function pin(file, expected) {
  check(hex(expected) && sha256(file) === expected.toLowerCase(), "release hash mismatch");
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
const quotePs = value => "'" + String(value).replaceAll("'", "''") + "'";
function powershell(command, timeout = 15_000, maxBuffer = 2 * 1024 * 1024) {
  const result = spawnSync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command,
  ], { encoding: "utf8", windowsHide: true, timeout, maxBuffer });
  check(!result.error && result.status === 0, "bounded Win32 or ZIP provenance query failed");
  return result.stdout.trim();
}
function foreignOwnerGuard() {
  powershell("$ErrorActionPreference='Stop'; $p=@(Get-CimInstance Win32_Process | Where-Object { " +
    "$_.Name -in @('Kreoda.exe','kreoda-core.exe','Kreoda.HermesBridge.exe') }); " +
    "if($p.Count -gt 0){exit 73};'OWNERS_CLEAR'");
}
function zipEntries(zip) {
  // SHA every real ZIP entry *inside the pinned archive*, independently of
  // the external verification receipt; compare all 156 to extracted files.
  const command = "$ErrorActionPreference='Stop'; " +
    "Add-Type -AssemblyName System.IO.Compression.FileSystem; " +
    "$z=[IO.Compression.ZipFile]::OpenRead(" + quotePs(zip) + "); " +
    "$rows=New-Object 'System.Collections.Generic.List[object]'; try {" +
    "foreach($e in $z.Entries){" +
    "if($e.Name.Length -eq 0){continue}; " +
    "$stream=$e.Open(); $h=[Security.Cryptography.SHA256]::Create(); " +
    "try{$digest=[BitConverter]::ToString($h.ComputeHash($stream)).Replace('-','').ToLowerInvariant()} " +
    "finally{$h.Dispose();$stream.Dispose()}; " +
    "$rows.Add([pscustomobject]@{name=$e.FullName;size=$e.Length;sha256=$digest})" +
    "}} finally {$z.Dispose()}; ConvertTo-Json -Compress -InputObject ($rows.ToArray()) -Depth 4";
  const inventory = JSON.parse(powershell(command, 120_000, 4 * 1024 * 1024));
  check(Array.isArray(inventory) && inventory.length === 156,
    "candidate ZIP does not contain exactly 156 ordinary files");
  return inventory;
}
function safeZipEntry(entry) {
  check(entry && typeof entry.name === "string" && typeof entry.size === "number" &&
    Number.isSafeInteger(entry.size) && entry.size >= 0 && hex(entry.sha256),
  "candidate ZIP entry shape differs");
  const prefix = releaseId + "/";
  check(entry.name.startsWith(prefix) && !entry.name.includes("\\") &&
    !entry.name.includes(":") && !/[\x00-\x1f*?"<>|]/.test(entry.name),
  "unsafe ZIP entry name");
  const parts = entry.name.slice(prefix.length).split("/");
  check(parts.length > 0 && parts.every(part =>
    part.length > 0 && part !== "." && part !== ".." && !/[. ]$/.test(part) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)),
  "ZIP contains unsafe path segment");
  return parts;
}
function physicalInventory(dir) {
  const found = [];
  const visit = (folder, base) => {
    check(fs.lstatSync(folder).isDirectory() && !fs.lstatSync(folder).isSymbolicLink(),
      "linked package folder");
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const target = path.join(folder, entry.name);
      const name = [...base, entry.name];
      if (entry.isDirectory()) visit(target, name);
      else { regular(target); found.push(name.join("/").toLowerCase()); }
    }
  };
  visit(dir, []);
  return found;
}
function preflight() {
  check(process.platform === "win32" && process.arch === "x64" &&
    process.env.GITHUB_ACTIONS === "true" &&
    process.env.RUNNER_ENVIRONMENT === "github-hosted" &&
    process.env.RUNNER_OS === "Windows" &&
    same(process.env.GITHUB_WORKSPACE ?? "", checkout),
  "only exact checked-out GitHub-hosted Windows x64 runner permitted");
  check(process.argv.length === 3 &&
    process.argv[2] === "--prime-z40-interference-grant=PRIME_APPROVED_GITHUB_HOSTED_Z40_INTERFERENCE",
  "dedicated prime z40 hosted grant required");
  const raw = process.env.KREODA_Z40_EXTRACTED_ROOT;
  check(typeof raw === "string" && path.isAbsolute(raw) && path.basename(raw) === releaseId,
    "KREODA_Z40_EXTRACTED_ROOT must be the exact candidate RELEASE directory");
  const release = path.resolve(raw);
  const runnerTemp = process.env.RUNNER_TEMP;
  check(within(release, checkout) ||
    (runnerTemp && path.isAbsolute(runnerTemp) && within(release, runnerTemp)),
  "candidate release root must be inside trusted hosted workspace or runner temp");
  check(same(fs.realpathSync.native(release), release) &&
    fs.lstatSync(release).isDirectory() && !fs.lstatSync(release).isSymbolicLink(),
  "candidate release root is not canonical and ordinary");
  const zip = process.env.KREODA_Z40_CANDIDATE_ZIP ??
    path.join(checkout, ".artifacts", "kreoda-ui-z40-candidate-20261114", zipName);
  check(path.isAbsolute(zip) &&
    (within(zip, checkout) || (runnerTemp && within(zip, runnerTemp))) &&
    path.basename(zip) === zipName,
  "candidate ZIP must be an exact named hosted workspace/runner-temp file");
  foreignOwnerGuard(); // no foreign process is touched, including known owner PID
  pin(zip, SHA.zip);
  const zipProofFile = path.join(path.dirname(zip), "candidate-zip-verification.json");
  pin(zipProofFile, SHA.zipReceipt);
  const zipProof = readJson(zipProofFile);
  check(zipProof.status === "DRAFT_UNVERIFIED" && zipProof.releaseId === releaseId &&
    zipProof.sourceBaseCommit === "9d11ef58c7cd5af97cd7b580f40aaf98f002ff38" &&
    zipProof.zipSha256?.toLowerCase() === SHA.zip && zipProof.zipBytes === 400539445 &&
    zipProof.fileCount === 156 && zipProof.entriesUseForwardSlashes === true &&
    zipProof.everyEntryHashVerified === true && zipProof.packagedSmokeExecuted === false &&
    Array.isArray(zipProof.entries) && zipProof.entries.length === 156,
  "original 156-entry z40 ZIP verification receipt not pinned");
  const manifestPath = path.join(release, "release-manifest.json");
  pin(manifestPath, SHA.manifest);
  const manifest = readJson(manifestPath);
  check(manifest.releaseId === releaseId && manifest.status === "DRAFT_UNVERIFIED" &&
    manifest.sourceBaseCommit === "9d11ef58c7cd5af97cd7b580f40aaf98f002ff38" &&
    manifest.sourceUiSha256?.toLowerCase() === SHA.sourceUi &&
    manifest.originalBundleSha256?.toLowerCase() === SHA.originalBundle &&
    manifest.originalAsarSha256?.toLowerCase() === SHA.originalAsar &&
    manifest.newExeSha256?.toLowerCase() === SHA.exe &&
    manifest.newAsarSha256?.toLowerCase() === SHA.asar &&
    manifest.nativeCoreSha256?.toLowerCase() === SHA.core &&
    manifest.bridgeExeSha256?.toLowerCase() === SHA.bridge &&
    manifest.questApkSha256?.toLowerCase() === SHA.quest &&
    manifest.nativeDllCountReused === 45 &&
    manifest.bridgePublishedFilesReused === 35 &&
    manifest.packagedSmokeExecuted === false && manifest.acceptedRelease === false,
  "candidate manifest source/product identity not pinned to z40 draft");
  const portable = path.join(release, "Kreoda-win32-x64");
  const resources = path.join(portable, "resources");
  const exe = path.join(portable, "Kreoda.exe");
  const asar = path.join(resources, "app.asar");
  const core = path.join(resources, "kreoda-core.exe");
  const bridge = path.join(release, "Kreoda.HermesBridge-net8.0", "Kreoda.HermesBridge.exe");
  const apk = path.join(release, "KreodaQuest.apk");
  for (const [file, checksum] of [[exe, SHA.exe], [asar, SHA.asar],
    [core, SHA.core], [bridge, SHA.bridge], [apk, SHA.quest]]) pin(file, checksum);
  const entries = zipEntries(zip);
  const proofMap = new Map(zipProof.entries.map(entry =>
    [String(entry.path).toLowerCase(), entry]));
  check(proofMap.size === 156, "original pinned ZIP receipt contains duplicated paths");
  const seen = new Set();
  for (const entry of entries) {
    const receiptEntry = proofMap.get(entry.name.toLowerCase());
    check(receiptEntry && receiptEntry.path === entry.name &&
      receiptEntry.size === entry.size &&
      String(receiptEntry.sha256).toLowerCase() === entry.sha256,
    "untrusted ZIP entry differs from SHA-pinned verification receipt");
    const pieces = safeZipEntry(entry);
    const key = pieces.join("/").toLowerCase();
    check(!seen.has(key), "case-insensitive duplicate ZIP path");
    seen.add(key);
    const target = path.resolve(release, ...pieces);
    check(within(target, release), "ZIP path escaped extracted release");
    let dir = release;
    for (const piece of pieces.slice(0, -1)) {
      dir = path.join(dir, piece);
      check(fs.lstatSync(dir).isDirectory() && !fs.lstatSync(dir).isSymbolicLink(),
        "ZIP package path traverses a linked directory");
    }
    check(regular(target).size === entry.size, "extracted ZIP entry has wrong size");
    pin(target, entry.sha256);
  }
  const actual = physicalInventory(release);
  check(actual.length === 156 && actual.every(entry => seen.has(entry)),
    "extracted release differs from exact ZIP file inventory");
  return { release, exe, asar, core, portable, resources };
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Pinned to the observed GH43585030962 compositor geometry (1008x655).
// The translated +5mm native box exposes its right face in this strip. The
// dimension chip ends above y=316; drawer starts beyond x=708; dock is below
// y=561. A separate unchanged grid patch detects camera/frame drift. This is
// a narrow source-correlated claim, not a general visual-quality assertion.
const raster = Object.freeze({
  width: 1008, height: 655,
  translatedFace: Object.freeze({ left: 546, top: 316, right: 569, bottom: 350 }),
  gridControl: Object.freeze({ left: 375, top: 290, right: 470, bottom: 370 }),
});
const bitmapBytes = raster.width * raster.height * 4;
function pixelStats(a, b, roi) {
  check(Buffer.isBuffer(a) && Buffer.isBuffer(b) &&
    a.length === bitmapBytes && b.length === bitmapBytes,
  "invalid 1008x655 BGRA native compositor bitmap");
  const result = { pixels: 0, blueA: 0, blueB: 0, blueGone: 0,
    blueAdded: 0, strongDelta: 0 };
  // Electron/Windows nativeImage.toBitmap() uses BGRA bytes.
  const blue = (v, offset) => v[offset] >= 70 &&
    v[offset] >= v[offset + 1] + 15 &&
    v[offset] >= v[offset + 2] + 30;
  for (let y = roi.top; y < roi.bottom; y++) {
    for (let x = roi.left; x < roi.right; x++) {
      const offset = (y * raster.width + x) * 4;
      const aBlue = blue(a, offset), bBlue = blue(b, offset);
      const sum = Math.abs(a[offset] - b[offset]) +
        Math.abs(a[offset + 1] - b[offset + 1]) +
        Math.abs(a[offset + 2] - b[offset + 2]);
      result.pixels++;
      result.blueA += Number(aBlue);
      result.blueB += Number(bBlue);
      result.blueGone += Number(aBlue && !bBlue);
      result.blueAdded += Number(!aBlue && bBlue);
      result.strongDelta += Number(sum >= 60);
    }
  }
  return result;
}
function proveRaster(before, undone, restored, scene) {
  const ids = bodies => bodies?.map(body => body.id).sort();
  const sameIds = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check(scene && scene.sourceId && scene.partId &&
    scene.sourceId !== scene.partId &&
    sameIds(ids(scene.before?.bodies), [scene.sourceId, scene.partId].sort()) &&
    sameIds(ids(scene.undone?.bodies), [scene.sourceId]) &&
    sameIds(ids(scene.redone?.bodies), [scene.sourceId, scene.partId].sort()) &&
    sameIds(ids(scene.restored?.bodies), [scene.sourceId, scene.partId].sort()) &&
    scene.before.revision < scene.undone.revision &&
    scene.undone.revision < scene.redone.revision &&
    Number.isInteger(scene.restored.revision) && scene.restored.revision >= 0 &&
    sameIds([...scene.restored.selectedIds].sort(), [scene.sourceId, scene.partId].sort()),
  "native A/B/A geometry or restored real UI selection does not match compositor phases");
  const lost = pixelStats(before, undone, raster.translatedFace);
  const regained = pixelStats(undone, restored, raster.translatedFace);
  const returned = pixelStats(before, restored, raster.translatedFace);
  const controlUndo = pixelStats(before, undone, raster.gridControl);
  const controlRedo = pixelStats(undone, restored, raster.gridControl);
  const controlReturn = pixelStats(before, restored, raster.gridControl);
  check(lost.blueA >= 150 && lost.blueB <= 35 &&
    lost.blueGone >= 140 && lost.strongDelta >= 140 &&
    regained.blueA <= 35 && regained.blueB >= 150 &&
    regained.blueAdded >= 140 && regained.strongDelta >= 140 &&
    returned.strongDelta <= 24 && returned.blueGone <= 20 &&
    returned.blueAdded <= 20 &&
    [controlUndo, controlRedo, controlReturn].every(value => value.strongDelta <= 16),
  "native +5mm solid must disappear on Undo and return on Redo in stable compositor pixels; camera/grid must remain fixed");
  return { materialPixelDeltaVerified: true,
    method: "three-stable-packaged-compositor-BGRA-native-geometry-A-B-A",
    translatedFaceRoi: raster.translatedFace, gridControlRoi: raster.gridControl,
    blueChannel: "BGRA[0]>=70, BGRA[0]>=G+15 and >=R+30",
    strongDeltaThresholdL1: 60,
    lost, regained, returned, controlUndo, controlRedo, controlReturn,
    nativeBodyCounts: [2, 1, 2],
    nativeRevisions: { before: scene.before.revision, undo: scene.undone.revision,
      redo: scene.redone.revision },
    restoredRealUiSelection: true };
}

// Opt-in CPU-only negative suite: synthetic bytes NEVER become evidence or PNGs.
// Production continues to require the hosted runner and the exact SHA-pinned ZIP.
function rasterNegativeSelftest() {
  const blank = () => Buffer.alloc(bitmapBytes);
  const filled = blank();
  for (let y = 318; y < 340; y++)
    for (let x = 548; x < 560; x++) {
      const i = (y * raster.width + x) * 4;
      filled[i] = 140; filled[i + 1] = 90; filled[i + 2] = 60; filled[i + 3] = 255;
    }
  const scene = { sourceId: "box", partId: "part",
    before: { revision: 2, bodies: [{id:"box"}, {id:"part"}] },
    undone: { revision: 3, bodies: [{id:"box"}] },
    redone: { revision: 4, bodies: [{id:"box"}, {id:"part"}] },
    restored: { revision: 0, bodies: [{id:"box"}, {id:"part"}],
      selectedIds: ["box", "part"] } };
  const rejects = (name, a, b, c, source = scene) => {
    let rejected = false;
    try { proveRaster(a, b, c, source); } catch { rejected = true; }
    check(rejected, "negative selftest accepted " + name);
  };
  check(proveRaster(filled, blank(), filled, scene).materialPixelDeltaVerified,
    "CPU comparator sentinel failed (not a real compositor capture)");
  rejects("false all-black frames", blank(), blank(), blank());
  rejects("zero delta", filled, filled, filled);
  rejects("no restored geometry", filled, blank(), blank());
  const noise = blank();
  for (let y = raster.gridControl.top; y < raster.gridControl.top + 40; y++)
    for (let x = raster.gridControl.left; x < raster.gridControl.left + 12; x++) {
      const i = (y * raster.width + x) * 4;
      noise[i] = 255; noise[i + 1] = 255; noise[i + 2] = 255;
    }
  rejects("noise/camera change in control ROI", filled, noise, filled);
  rejects("false native scene correlation", filled, blank(), filled,
    { ...scene, restored: { ...scene.restored, bodies: [{ id: "box" }] } });
  const unstable = Buffer.from(filled);
  for (let y = 318; y < 328; y++)
    for (let x = 548; x < 552; x++)
      unstable[(y * raster.width + x) * 4] = 0;
  check(pixelStats(filled, unstable, raster.translatedFace).strongDelta > 8,
    "unstable compositor pair was not rejected by the eight-pixel noise budget");
  console.log("PASS: CPU-only raster comparator negatives and sentinel; NO packaged acceptance claimed");
}
async function bounded(task, ms, label) {
  let timer;
  try {
    return await Promise.race([Promise.resolve(task), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error("TIMEOUT: " + label)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
async function until(checker, name, ms = 20_000) {
  const end = Date.now() + ms;
  do {
    try {
      const result = await bounded(Promise.resolve().then(checker), 5_000, name + " poll");
      if (result) return result;
    } catch { /* never promote transient observations to evidence */ }
    await delay(180);
  } while (Date.now() < end);
  fail("timed out at stage " + name);
}
function win32Process(pid) {
  check(Number.isInteger(pid) && pid > 0, "Win32 PID is not valid");
  const json = powershell("$ErrorActionPreference='Stop'; " +
    "$p=Get-CimInstance Win32_Process -Filter 'ProcessId = " + pid + "'; " +
    "if(-not $p){exit 43}; " +
    "$p|Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine," +
    "@{Name='CreationUtc';Expression={$_.CreationDate.ToUniversalTime().ToString('o')}}|ConvertTo-Json -Compress");
  const p = JSON.parse(json);
  check(p?.ProcessId === pid && Number.isInteger(p.ParentProcessId) &&
    typeof p.ExecutablePath === "string" && p.ExecutablePath.length > 0 &&
    typeof p.CreationUtc === "string" && Number.isFinite(Date.parse(p.CreationUtc)),
  "Win32 process identity or creation timestamp absent");
  return p;
}
function maybeWin32Process(pid) {
  try { return win32Process(pid); } catch { return null; }
}
function sameProcess(live, identity) {
  return live && identity && live.ProcessId === identity.pid &&
    live.CreationUtc === identity.created && live.ParentProcessId === identity.parentPid &&
    same(live.ExecutablePath, identity.executable);
}
function packagedElectron(launcherPid, actualPid, provenance, profile, launchedAt) {
  check(Number.isInteger(launcherPid) && launcherPid > 0 &&
    Number.isInteger(actualPid) && actualPid > 0 && actualPid !== process.pid,
  "Playwright launcher or actual Electron main PID absent");
  const windows = process.env.SystemRoot ?? process.env.WINDIR;
  check(typeof windows === "string" && path.win32.isAbsolute(windows),
    "trusted Windows shell path unavailable");
  const shells = [path.win32.join(windows, "System32", "cmd.exe"),
    path.win32.join(windows, "SysWOW64", "cmd.exe")];
  const main = win32Process(actualPid);
  check(main.Name?.toLowerCase() === "kreoda.exe" &&
    same(main.ExecutablePath, provenance.exe),
  "actual main PID not original candidate Kreoda.exe");
  pin(main.ExecutablePath, SHA.exe);
  check(Date.parse(main.CreationUtc) >= launchedAt - 8_000 &&
    Date.parse(main.CreationUtc) <= Date.now() + 2_000,
  "main PID not created for this bounded launch");
  const ancestry = [{ pid: actualPid, image: "Kreoda.exe", parentPid: main.ParentProcessId }];
  const visited = new Set([actualPid]);
  let current = main, launcherFound = actualPid === launcherPid, shellCommandVerified = false;
  let launcherIdentity = null;
  for (let depth = 0; current.ProcessId !== process.pid && depth < 4; depth++) {
    const pid = current.ParentProcessId;
    check(Number.isInteger(pid) && pid > 0 && !visited.has(pid),
      "missing or cyclic Playwright process ancestor");
    const parent = win32Process(pid);
    visited.add(pid);
    if (pid === process.pid) {
      check(parent.Name?.toLowerCase() === path.win32.basename(process.execPath).toLowerCase() &&
        same(parent.ExecutablePath, process.execPath),
      "Electron ancestry does not terminate at this exact test Node process");
    } else {
      check(parent.Name?.toLowerCase() === "cmd.exe" &&
        shells.some(shell => same(parent.ExecutablePath, shell)),
      "foreign Win32 executable in Electron ancestry");
      const command = String(parent.CommandLine ?? "").toLowerCase();
      if (command.includes(provenance.exe.toLowerCase()) &&
        command.includes(profile.toLowerCase()) && command.includes("--user-data-dir="))
        shellCommandVerified = true;
    }
    if (pid === launcherPid) {
      launcherFound = true;
      if (pid !== process.pid) launcherIdentity = {
        pid, parentPid: parent.ParentProcessId, executable: parent.ExecutablePath,
        created: parent.CreationUtc,
      };
    }
    if (pid !== process.pid)
      check(Date.parse(parent.CreationUtc) <= Date.parse(current.CreationUtc) + 2_000 &&
        Date.parse(parent.CreationUtc) >= launchedAt - 8_000,
      "Win32 ancestry creation time differs from this launch");
    ancestry.push({ pid, image: pid === process.pid ? "test-node" : "cmd.exe",
      parentPid: parent.ParentProcessId });
    current = parent;
  }
  check(current.ProcessId === process.pid && launcherFound &&
    ((ancestry.length === 2 && launcherPid === actualPid) || shellCommandVerified),
  "actual main does not descend from bounded trusted Playwright launcher");
  return { pid: actualPid, parentPid: main.ParentProcessId,
    executable: main.ExecutablePath, created: main.CreationUtc,
    launcherIdentity, ancestry };
}
function nativeSidecar(corePid, owner, provenance, launchedAt) {
  const core = win32Process(corePid);
  check(core.ParentProcessId === owner.pid && same(core.ExecutablePath, provenance.core) &&
    core.Name?.toLowerCase() === "kreoda-core.exe",
  "native OCCT core is not an exact direct child of real packaged Electron");
  pin(core.ExecutablePath, SHA.core);
  check(Date.parse(core.CreationUtc) >= launchedAt - 8_000 &&
    Date.parse(core.CreationUtc) <= Date.now() + 2_000 &&
    Date.parse(core.CreationUtc) >= Date.parse(owner.created) - 2_000,
  "native sidecar creation time is outside authenticated Electron lifecycle");
  return { pid: corePid, parentPid: core.ParentProcessId,
    executable: core.ExecutablePath, created: core.CreationUtc };
}
function authenticatedKill(identity, expectedSha) {
  // Never kill Playwright app.process()?.pid: on Windows it may be cmd.exe.
  check(identity?.pid > 0 && typeof identity.created === "string" &&
    typeof identity.executable === "string",
  "no attested exact PID for emergency cleanup");
  const now = win32Process(identity.pid);
  check(sameProcess(now, identity), "PID reused, different ancestry, or changed image: no kill");
  pin(now.ExecutablePath, expectedSha);
  const script = "$ErrorActionPreference='Stop'; " +
    "$p=[System.Diagnostics.Process]::GetProcessById(" + identity.pid + "); " +
    "if($p.StartTime.ToUniversalTime().ToString('o') -ne " + quotePs(identity.created) +
    "){exit 78}; if(-not [String]::Equals($p.MainModule.FileName," +
    quotePs(identity.executable) + ",[StringComparison]::OrdinalIgnoreCase)){exit 79}; " +
    "if((Get-FileHash -LiteralPath $p.MainModule.FileName -Algorithm SHA256).Hash.ToLowerInvariant() -ne " +
    quotePs(expectedSha) + "){exit 80}; $p.Kill(); 'EXACT_PROCESS_TERMINATED'";
  powershell(script);
}
function safeFailure(error) {
  const message = String(error?.message ?? "");
  if (message.startsWith("Z40_BLOCKED: ")) return message.slice(13, 180).replace(/[\r\n\\]/g, "_");
  if (/^TIMEOUT: [\w ./-]{1,110}$/.test(message)) return message;
  return "unclassified runtime exception (secrets and paths redacted)";
}
function profileEnvironment(profile) {
  const env = { ...process.env, KREODA_BACKGROUND_TEST: "1",
    KREODA_RECOVERY_DIR: path.join(profile, "recovery"),
    KREODA_PLUGINS_DIR: path.join(profile, "plugins"),
    TEMP: profile, TMP: profile, TMPDIR: profile,
    APPDATA: path.join(profile, "roaming"),
    LOCALAPPDATA: path.join(profile, "local"),
    KREODA_HERMES_CONFIG: "", KREODA_VOICE_TOKEN: "",
    KREODA_UPDATE_FEED: "", KREODA_UPDATE_PUBKEY: "" };
  for (const key of ["KREODA_SESSION_HOST", "KREODA_SESSION_PORT", "KREODA_SESSION_TOKEN",
    "KREODA_AUTOMATIC_LOOPBACK_TEST", "KREODA_CAD_SESSION_URL", "KREODA_CAD_PAIR",
    "KREODA_MCP_PROBE_SCENARIO", "ELECTRON_RUN_AS_NODE"]) delete env[key];
  for (const dir of [env.APPDATA, env.LOCALAPPDATA]) fs.mkdirSync(dir, { recursive: true });
  return env;
}
async function snapshot(page) {
  return bounded(page.evaluate(() => window.__kreoda_test.snapshot()), 8_000,
    "actual packaged native CAD snapshot");
}
function solid(body, expectedId) {
  check(body && body.id === expectedId &&
    Number.isFinite(body.volumeMm3) && Math.abs(body.volumeMm3 - 1000) <= 0.01 &&
    Number.isInteger(body.triangles) && body.triangles > 0 &&
    body.geometryCurrent !== false && body.status !== "blocked",
  "missing exact 1000mm3 triangulated OCCT solid");
}
async function bodiesAre(page, ids) {
  return until(async () => {
    const state = await snapshot(page);
    if (!Number.isInteger(state?.revision) || state.revision < 0 ||
        !Array.isArray(state.bodies) || state.bodies.length !== ids.length) return null;
    const actual = state.bodies.map(body => body.id).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...ids].sort())) return null;
    try { for (const id of ids) solid(state.bodies.find(body => body.id === id), id); }
    catch { return null; }
    return state;
  }, "exact nonstub OCCT native bodies", 25_000);
}
async function runBar(page, command) {
  const input = page.getByTestId("command-input");
  await input.fill(command, { timeout: 8_000 });
  await input.press("Enter", { timeout: 8_000 });
  const preview = page.getByTestId("plan-preview");
  await preview.waitFor({ state: "visible", timeout: 10_000 });
  await preview.getByRole("button", { name: /Run 1 step/ }).click({ timeout: 10_000 });
  await preview.waitFor({ state: "hidden", timeout: 40_000 });
  const errors = await page.getByText(/Stopped after|planning failed|execution failed/).allTextContents();
  check(errors.length === 0, "real Desktop command failed");
}
async function workspace(page, app) {
  await bounded(app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length !== 1 || windows.some(win => win.isVisible()))
      throw Error("expected exactly one hidden original packaged BrowserWindow");
    windows[0].webContents.setBackgroundThrottling(false);
    windows[0].setContentSize(1008, 655);
    return windows[0].getContentSize();
  }), 10_000, "set real hidden 1008x655 Electron content size");
  await until(async () => {
    const dimensions = await page.evaluate(() =>
      ({ width: innerWidth, height: innerHeight }));
    return dimensions.width === 1008 && dimensions.height === 655;
  }, "real Chromium innerWidth1008 height655", 12_000);
  await page.getByTestId("home-screen").waitFor({ state: "visible", timeout: 20_000 });
  await page.getByTestId("home-new-project").click({ timeout: 8_000 });
  await page.getByTestId("workspace-chrome").waitFor({ state: "visible", timeout: 20_000 });
  await page.getByTestId("home-screen").waitFor({ state: "hidden", timeout: 12_000 });
  await page.getByText(/core 0\.1\.0(?!-stub)/i).waitFor({ state: "visible", timeout: 20_000 });
  await page.getByTestId("viewport").locator("canvas").waitFor({
    state: "visible", timeout: 20_000,
  });
  const onboarding = page.getByTestId("onboarding");
  try { await onboarding.waitFor({ state: "visible", timeout: 5000 }); }
  catch { /* not shown in the actual packaged profile */ }
  let dismissed = false;
  if (await onboarding.isVisible()) {
    await onboarding.getByRole("button", { name: "Dismiss", exact: true })
      .click({ timeout: 8_000 }); // actual UI, never storage/DOM mutation
    dismissed = true;
  }
  await onboarding.waitFor({ state: "hidden", timeout: 12_000 });
  await until(async () => {
    const result = await page.evaluate(() => {
      const isVisible = e => !!e && e.getClientRects().length > 0 &&
        getComputedStyle(e).visibility !== "hidden";
      const count = selector =>
        [...document.querySelectorAll(selector)].filter(isVisible).length;
      return { home: count('[data-testid="home-screen"]'),
        workspace: count('[data-testid="workspace-chrome"]'),
        dialog: count('[role="dialog"]'),
        onboarding: count('[data-testid="onboarding"]') };
    });
    return result.home === 0 && result.workspace === 1 &&
      result.dialog === 0 && result.onboarding === 0;
  }, "home/onboarding/modal-free real CAD workspace", 15_000);
  return { width: 1008, height: 655, onboardingDismissedThroughUi: dismissed };
}
async function openProperties(page) {
  await page.getByTestId("workspace-topdock")
    .getByRole("button", { name: "More" }).click({ timeout: 8_000 });
  await page.getByTestId("more-menu").waitFor({ state: "visible", timeout: 8_000 });
  await page.getByTestId("more-menu")
    .getByRole("button", { name: "Properties" }).click({ timeout: 8_000 });
  await page.getByTestId("properties-drawer").waitFor({
    state: "visible", timeout: 8_000,
  });
  await page.getByTestId("interference-analysis-panel").waitFor({
    state: "visible", timeout: 8_000,
  });
}
async function stackingAndHitTest(page, phase) {
  return bounded(page.evaluate(() => {
    const drawer = document.querySelector('[data-testid="properties-drawer"]');
    const dock = document.querySelector('[data-testid="command-dock"]');
    const panel = document.querySelector('[data-testid="interference-analysis-panel"]');
    const scroller = drawer?.querySelector('.overflow-auto');
    const button = [...(panel?.querySelectorAll("button") ?? [])]
      .find(item => item.textContent?.trim() === "Controlla interferenze");
    if (!drawer || !dock || !button || !scroller) return null;
    const dockLayer = dock.parentElement;
    if (!dockLayer) return null;
    const a = button.getBoundingClientRect(), b = dock.getBoundingClientRect();
    const c = scroller.getBoundingClientRect();
    const left = Math.max(a.left, b.left, c.left),
      right = Math.min(a.right, b.right, c.right);
    const top = Math.max(a.top, b.top, c.top),
      bottom = Math.min(a.bottom, b.bottom, c.bottom);
    const overlapsInteractiveDock = right - left >= 8 && bottom - top >= 8;
    const x = overlapsInteractiveDock ? (left + right) / 2 : (a.left + a.right) / 2;
    const y = overlapsInteractiveDock ? (top + bottom) / 2 : (a.top + a.bottom) / 2;
    const topElement = document.elementFromPoint(x, y);
    return {
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      drawerZ: getComputedStyle(drawer).zIndex,
      dockZ: getComputedStyle(dockLayer).zIndex,
      dockPointerEvents: getComputedStyle(dock).pointerEvents,
      drawerWidth: Math.round(drawer.getBoundingClientRect().width),
      overlapWidth: Math.max(0, Math.round(right - left)),
      overlapHeight: Math.max(0, Math.round(bottom - top)),
      overlapsInteractiveDock,
      hitTestIsActualButton: topElement === button || button.contains(topElement),
      hitX: Math.round(x), hitY: Math.round(y),
      clickOffsetX: x - a.left, clickOffsetY: y - a.top,
      buttonCenterY: Math.round((a.top + a.bottom) / 2),
      dockTop: Math.round(b.top), dockBottom: Math.round(b.bottom),
      scrollViewportTop: Math.round(c.top), scrollViewportBottom: Math.round(c.bottom),
      scrollTop: Math.round(scroller.scrollTop),
      maxScrollTop: Math.round(scroller.scrollHeight - scroller.clientHeight),
    };
  }), 8_000, "sanitized z-index and real Chromium pointer hit test " + phase);
}
async function positionActualButtonIntoDockOverlap(page) {
  // Preserve the failing phase15 setup, then use the genuine drawer's scroll
  // position to put the ACTUAL button in the physical interactive dock region.
  // This scrolls the UI only; it neither fires a synthetic click nor alters
  // element styles, stacking order, handlers, geometry or document state.
  return bounded(page.evaluate(() => {
    const drawer = document.querySelector('[data-testid="properties-drawer"]');
    const dock = document.querySelector('[data-testid="command-dock"]');
    const panel = document.querySelector('[data-testid="interference-analysis-panel"]');
    const scroller = drawer?.querySelector('.overflow-auto');
    const button = [...(panel?.querySelectorAll('button') ?? [])]
      .find(element => element.textContent?.trim() === 'Controlla interferenze');
    if (!drawer || !dock || !scroller || !button) return null;
    const d = dock.getBoundingClientRect(), s = scroller.getBoundingClientRect();
    const initial = button.getBoundingClientRect();
    const half = initial.height / 2;
    const viableTop = Math.max(d.top + half + 3, s.top + half + 3);
    const viableBottom = Math.min(d.bottom - half - 3, s.bottom - half - 3);
    if (viableBottom < viableTop) return {
      positioned: false, reason: 'no vertical area for entire button in actual dock and drawer',
      dockTop: Math.round(d.top), dockBottom: Math.round(d.bottom),
      scrollerTop: Math.round(s.top), scrollerBottom: Math.round(s.bottom),
      buttonHeight: Math.round(initial.height),
    };
    const desiredCenterY = Math.min(viableBottom,
      Math.max(viableTop, d.top + Math.min(40, d.height / 2)));
    const before = scroller.scrollTop;
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const requested = before + (initial.top + half - desiredCenterY);
    scroller.scrollTop = Math.min(max, Math.max(0, requested));
    return { positioned: true, scrollBefore: Math.round(before),
      scrollRequested: Math.round(requested), scrollActual: Math.round(scroller.scrollTop),
      maxScroll: Math.round(max), targetButtonCenterY: Math.round(desiredCenterY),
      originalButtonCenterY: Math.round(initial.top + half),
      dockTop: Math.round(d.top), dockBottom: Math.round(d.bottom),
      scrollerTop: Math.round(s.top), scrollerBottom: Math.round(s.bottom) };
  }), 8_000, 'scroll actual interference button into interactive dock overlap');
}
async function inspectInterferences(page, expected, phase, receipt, requireDockOverlap) {
  const panel = page.getByTestId("interference-analysis-panel");
  const button = panel.getByRole("button", { name: "Controlla interferenze", exact: true });
  await panel.waitFor({ state: "visible", timeout: 8_000 });
  // Mirrors the real failing phase15 E2E: no force, no DOM click, no event
  // dispatch, and scrollIntoView(block:start) was insufficient on old z30.
  await button.evaluate(element => element.scrollIntoView({
    block: "start", behavior: "auto",
  }));
  if (requireDockOverlap) {
    const positioning = await positionActualButtonIntoDockOverlap(page);
    receipt.overlapPositioning = positioning;
    check(positioning?.positioned === true,
      "no achievable physical button-dock overlap at 1008px; inspect receipt geometry");
  }
  const geometry = await stackingAndHitTest(page, phase);
  if (requireDockOverlap) receipt.overlapHitTest = geometry;
  check(geometry && geometry.viewportWidth === 1008 &&
    geometry.viewportHeight === 655 && geometry.drawerZ === "40" &&
    geometry.dockZ === "30" && geometry.dockPointerEvents === "auto",
  "new packaged renderer is not actual z40 drawer over z30 interactive dock");
  if (requireDockOverlap) {
    check(geometry.overlapsInteractiveDock && geometry.hitTestIsActualButton,
      "real drawer scroll could not establish hit-tested dock collision; inspect receipt geometry");
  }
  // In the regression, the actual pointer lands WITHIN the dock intersection;
  // Playwright still performs a genuine actionability-checked mouse click.
  await button.click({ timeout: 15_000,
    ...(requireDockOverlap ? { position: {
      x: geometry.clickOffsetX, y: geometry.clickOffsetY,
    } } : {}),
  }); // NO force, dispatchEvent, DOM .click() or bypass
  if (expected === 500) {
    await panel.getByText("500 mm³", { exact: true })
      .waitFor({ state: "visible", timeout: 20_000 });
    await panel.getByText("2 componenti solidi analizzati.", { exact: true })
      .waitFor({ state: "visible", timeout: 12_000 });
  } else {
    await panel.getByText("Nessuna interferenza volumetrica.", { exact: true })
      .waitFor({ state: "visible", timeout: 20_000 });
    await panel.getByText("500 mm³", { exact: true })
      .waitFor({ state: "hidden", timeout: 12_000 });
  }
  check(await panel.getByRole("alert").count() === 0,
    "read-only interference native analysis reported an error");
  receipt.tests.push({ name: "real-UI-interference-" + phase,
    pass: true, measuredOverlapMm3: expected, pointer: geometry,
    click: "Playwright role-button click without force" });
}
async function screenshot(app, page, dest, receipt, phase) {
  const target = await bounded(page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="viewport"] canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      face: document.elementFromPoint(555, 330) === canvas,
      control: document.elementFromPoint(400, 330) === canvas };
  }), 8_000, "unoccluded native mesh and grid compositor ROIs");
  check(target && target.face && target.control &&
    target.left <= raster.gridControl.left &&
    target.top <= raster.gridControl.top &&
    target.right >= raster.translatedFace.right &&
    target.bottom >= raster.gridControl.bottom,
  "actual native viewport raster regions are covered by UI or outside canvas");
  let stable = null;
  for (let attempt = 0; attempt < 4 && !stable; attempt++) {
    const pair = await bounded(app.evaluate(async ({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length !== 1 || windows[0].isVisible())
        throw Error("unexpected visible window");
      // GH43586421382/43586999803: hidden webContents.capturePage can hang.
      // Phase15's real packaged BrowserWindow.capturePage path succeeds. Bound
      // EACH native capture in the Electron main process so a stalled capture
      // cannot consume the whole hosted job or silently become raster proof.
      const captureFrame = async () => {
        let timer;
        try {
          return await Promise.race([
            windows[0].capturePage(undefined, { stayHidden: true }),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(Error(
                "hidden BrowserWindow compositor capture stalled")), 10_000);
            }),
          ]);
        } finally { clearTimeout(timer); }
      };
      const first = await captureFrame();
      await new Promise(resolve => setTimeout(resolve, 150));
      const second = await captureFrame();
      if (first.isEmpty() || second.isEmpty() || windows[0].isVisible())
        throw Error("no valid hidden compositor frames");
      const sizeA = first.getSize(), sizeB = second.getSize();
      if (sizeA.width !== 1008 || sizeA.height !== 655 ||
          sizeB.width !== 1008 || sizeB.height !== 655)
        throw Error("capturePage not exact 1008x655");
      return { first: first.toBitmap().toString("base64"),
        second: second.toBitmap().toString("base64"),
        png: second.toPNG().toString("base64") };
    }), 25_000, "two bounded real packaged hidden Electron compositor frames " + phase);
    check(typeof pair.first === "string" && typeof pair.second === "string" &&
      typeof pair.png === "string", "captured Electron pixel payload absent");
    const a = Buffer.from(pair.first, "base64");
    const b = Buffer.from(pair.second, "base64");
    const face = pixelStats(a, b, raster.translatedFace);
    const grid = pixelStats(a, b, raster.gridControl);
    if (face.strongDelta <= 8 && grid.strongDelta <= 8) {
      stable = { bitmap: b, png: Buffer.from(pair.png, "base64"),
        stablePair: { translatedFaceStrongDelta: face.strongDelta,
          gridControlStrongDelta: grid.strongDelta, attempt: attempt + 1 } };
    } else {
      await delay(180);
    }
  }
  check(stable, "four bounded pairs could not establish stable real compositor frames");
  const png = stable.png;
  check(png.length >= 1000 &&
    png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) &&
    png.readUInt32BE(16) === 1008 && png.readUInt32BE(20) === 655,
  "real screenshot PNG must show exact 1008x655 compositor frame");
  const filename = "actual-packaged-" + phase + "-1008x655.png";
  fs.writeFileSync(path.join(dest, filename), png, { flag: "wx" });
  const checksum = createHash("sha256").update(png).digest("hex");
  receipt.screenshots.push({ filename, sha256: checksum, bytes: png.length,
    width: 1008, height: 655, evidence: "stable-hidden-packaged-native-BGRA-and-PNG",
    stablePair: stable.stablePair, materialPixelDeltaVerified: false });
  return stable.bitmap;
}
async function cleanShutdown(app, mainOwner, coreOwner, receipt) {
  let appCloseClean = true;
  if (app) {
    try { await bounded(app.close(), 15_000, "graceful real Electron shutdown"); }
    catch {
      appCloseClean = false;
      receipt.cleanupIssue = "graceful app.close failed; safe PID-specific fallback only";
      if (mainOwner && sameProcess(maybeWin32Process(mainOwner.pid), mainOwner)) {
        try { authenticatedKill(mainOwner, SHA.exe); }
        catch { receipt.terminationFallback = "BLOCKED: no unchanged live owner proof"; }
      }
    }
  }
  let allExited = true;
  if (mainOwner || coreOwner) {
    try {
      await until(() => {
        const main = mainOwner ? maybeWin32Process(mainOwner.pid) : null;
        const core = coreOwner ? maybeWin32Process(coreOwner.pid) : null;
        const wrapper = mainOwner?.launcherIdentity
          ? maybeWin32Process(mainOwner.launcherIdentity.pid) : null;
        return (!sameProcess(main, mainOwner) && !sameProcess(core, coreOwner) &&
          !sameProcess(wrapper, mainOwner?.launcherIdentity))
          ? true : null;
      }, "all authenticated packaged Electron and OCCT processes exited", 18_000);
    } catch {
      allExited = false;
      receipt.cleanupIssue = "one or more exactly owned main/native processes survived";
      // The earlier ancestry, exact path and creation time must still match.
      // The Playwright cmd.exe wrapper must also exit, but NEVER kill it:
      // only the previously authenticated packaged EXE and OCCT may be killed.
      for (const [owner, hash] of [[coreOwner, SHA.core], [mainOwner, SHA.exe]]) {
        if (owner && sameProcess(maybeWin32Process(owner.pid), owner)) {
          try { authenticatedKill(owner, hash); }
          catch { receipt.terminationFallback = "BLOCKED: surviving PID identity unproved"; }
        }
      }
    }
  }
  let noForeign = true;
  try { foreignOwnerGuard(); }
  catch { noForeign = false; receipt.cleanupIssue = "packaged or foreign processes remain"; }
  return appCloseClean && allExited && noForeign;
}
async function main() {
  const candidate = preflight(); // fail closed before creating evidence/profile
  const destination = path.join(checkout, ".artifacts", "kreoda-z40-packaged-smoke");
  fs.mkdirSync(destination, { recursive: true });
  const receiptDir = fs.mkdtempSync(path.join(destination, "hosted-"));
  const tmpRoot = path.join(checkout, ".codex", "tmp");
  fs.mkdirSync(tmpRoot, { recursive: true });
  const profile = fs.mkdtempSync(path.join(tmpRoot, "z40-interference-"));
  const icad = path.join(profile, "interference-z40.icad");
  const receipt = { status: "FAIL_OR_BLOCKED",
    scenario: "actual-1008px-packaged-z40-drawer-dock-native-OCCT-after-Undo",
    releaseId, zipSha256: SHA.zip, manifestSha256: SHA.manifest,
    exeSha256: SHA.exe, asarSha256: SHA.asar, coreSha256: SHA.core,
    sourceUiSha256: SHA.sourceUi,
    runner: "github-hosted-windows-x64", startedAtUtc: new Date().toISOString(),
    tests: [], screenshots: [] };
  let app, mainOwner, coreOwner, error;
  let stage = "launch-exact-packaged-candidate";
  let cleaned = false;
  try {
    const requireDesktop = createRequire(path.join(checkout, "apps", "desktop", "package.json"));
    const { _electron: electron } = requireDesktop("@playwright/test");
    const launchAt = Date.now();
    app = await bounded(electron.launch({ executablePath: candidate.exe,
      args: ["--no-sandbox", "--lang=en-US", "--start-hidden", "--user-data-dir=" + profile],
      env: profileEnvironment(profile), timeout: 40_000 }), 50_000,
    "launch exact z40 packaged Electron");
    stage = "exact-electron-node-cmd-main-identity";
    const launcherPid = app.process()?.pid;
    const mainPid = await bounded(app.evaluate(() => process.pid), 10_000,
      "read actual Electron main process PID");
    mainOwner = packagedElectron(launcherPid, mainPid, candidate, profile, launchAt);
    const packageIdentity = await bounded(app.evaluate(({ app, BrowserWindow }) => ({
      packaged: app.isPackaged, executable: process.execPath,
      appPath: app.getAppPath(), resources: process.resourcesPath,
      profile: app.getPath("userData"),
      hidden: BrowserWindow.getAllWindows().length === 1 &&
        BrowserWindow.getAllWindows().every(win => !win.isVisible()),
    })), 10_000, "actual packaged main app identity");
    check(packageIdentity.packaged && packageIdentity.hidden &&
      same(packageIdentity.executable, candidate.exe) &&
      same(packageIdentity.appPath, candidate.asar) &&
      same(packageIdentity.resources, candidate.resources) &&
      (same(packageIdentity.profile, profile) ||
        within(packageIdentity.profile, profile)),
    "app.isPackaged, resources, or isolated hidden profile mismatch");
    stage = "real-native-OCCT-direct-child";
    const page = await bounded(app.firstWindow({ timeout: 30_000 }), 35_000,
      "actual packaged BrowserWindow");
    const core = await until(async () => {
      const info = await bounded(page.evaluate(() => window.kreoda.coreInfo()),
        4_000, "real packaged coreInfo");
      return info?.running && Number.isInteger(info.pid) && info.pid > 0 ? info : null;
    }, "genuine packaged nonstub native OCCT sidecar", 30_000);
    coreOwner = nativeSidecar(core.pid, mainOwner, candidate, launchAt);
    receipt.processProof = { electronMainPid: mainOwner.pid,
      playwrightLauncherPid: launcherPid, nativeCorePid: coreOwner.pid,
      mainAncestry: mainOwner.ancestry,
      directNativeParent: coreOwner.parentPid === mainOwner.pid,
      launcherIdentityAttested: mainOwner.launcherIdentity !== null ||
        launcherPid === mainOwner.pid };
    receipt.tests.push({ name: "actual-packaged-z40-exe-asar-native-ownership",
      pass: true, mainPid, corePid: coreOwner.pid });
    stage = "real-1008px-home-workspace-onboarding";
    receipt.window = await workspace(page, app);
    receipt.tests.push({ name: "real-1008x655-hidden-workspace-no-onboarding", pass: true });
    stage = "real-commandbar-native-10mm-box";
    await runBar(page, "box 10 10 10");
    const sourceState = await until(async () => {
      const snap = await snapshot(page);
      if (snap?.bodies?.length !== 1) return null;
      const body = snap.bodies[0];
      try { solid(body, body.id); }
      catch { return null; }
      if (body.type !== "Box" || JSON.stringify(body.paramsMm) !== JSON.stringify([10,10,10]))
        return null;
      return snap;
    }, "real typed Box10 native volume1000 BRep", 25_000);
    const sourceId = sourceState.bodies[0].id;
    receipt.tests.push({ name: "real-native-Box10-vol1000", pass: true,
      featureId: sourceId, volumeMm3: sourceState.bodies[0].volumeMm3,
      triangles: sourceState.bodies[0].triangles });
    stage = "real-native-assembly-instance-translation-5mm";
    const partId = await bounded(page.evaluate(id =>
      window.__kreoda_test.assemblyMateE2E.instance(id, 5, 0, 0), sourceId),
    25_000, "real native OCCT translated instance");
    check(typeof partId === "string" && partId.length > 0 && partId !== sourceId,
      "real translated instance feature ID missing");
    const before = await bodiesAre(page, [sourceId, partId]);
    check(before.revision > sourceState.revision,
      "native instance did not commit a new document revision");
    receipt.tests.push({ name: "real-native-instance-plus5-1000mm3", pass: true,
      featureId: partId, translationMm: [5,0,0],
      nativeBodies: before.bodies.length, revision: before.revision });
    stage = "real-properties-drawer-initial-volume500";
    await openProperties(page);
    await inspectInterferences(page, 500, "before-Undo-overlap-500", receipt, false);
    const readonlyFirst = await snapshot(page);
    check(readonlyFirst.revision === before.revision &&
      JSON.stringify(readonlyFirst.bodies) === JSON.stringify(before.bodies),
    "reading real OCCT interferences changed the native CAD document");
    stage = "real-select-interference-components";
    const panel = page.getByTestId("interference-analysis-panel");
    await panel.getByRole("button", { name: "Seleziona componenti", exact: true })
      .click({ timeout: 12_000 });
    const selection = await snapshot(page);
    check(JSON.stringify([...selection.selectedIds].sort()) ===
      JSON.stringify([sourceId, partId].sort()) &&
      selection.revision === before.revision &&
      JSON.stringify(selection.bodies) === JSON.stringify(before.bodies),
    "real selection changed OCCT topology or missed two components");
    receipt.tests.push({ name: "real-UI-select-two-OCCT-components", pass: true });
    const beforePixels = await screenshot(app, page, receiptDir, receipt, "before-Undo-overlap500");
    stage = "real-Desktop-commandbar-Undo";
    await runBar(page, "undo");
    const undone = await bodiesAre(page, [sourceId]);
    check(undone.revision > before.revision &&
      undone.bodies.every(body => body.id !== partId),
    "Undo did not remove exactly native instance while preserving Box1000");
    receipt.tests.push({ name: "real-commandbar-Undo-removes-translated-OCCT-instance",
      pass: true, revision: undone.revision, remainingVolumeMm3: 1000 });
    stage = "regression-1008px-dock-overlap-real-role-button-after-Undo";
    await inspectInterferences(page, 0, "after-Undo-overlap-0", receipt, true);
    const readonlyUndone = await snapshot(page);
    check(readonlyUndone.revision === undone.revision &&
      JSON.stringify(readonlyUndone.bodies) === JSON.stringify(undone.bodies),
    "post-Undo interference analysis is not genuinely read-only");
    const undonePixels = await screenshot(app, page, receiptDir, receipt, "after-Undo-zero");
    stage = "real-native-Redo-ICAD-save-open";
    await runBar(page, "redo");
    const redone = await bodiesAre(page, [sourceId, partId]);
    stage = "real-UI-restore-two-body-selection-for-native-geometry-raster-proof";
    // Repeat the same real Properties button used before Undo. Capture A'
    // before ICAD reopen, which is permitted to reset the document epoch and
    // camera. This isolates Undo/Redo native mesh changes from camera resets.
    await panel.getByRole("button", { name: "Controlla interferenze", exact: true })
      .click({ timeout: 15_000 });
    await panel.getByText("500 mm³", { exact: true })
      .waitFor({ state: "visible", timeout: 20_000 });
    await panel.getByRole("button", { name: "Seleziona componenti", exact: true })
      .click({ timeout: 12_000 });
    const restored = await snapshot(page);
    check(restored.revision === redone.revision &&
      JSON.stringify([...restored.selectedIds].sort()) ===
        JSON.stringify([sourceId, partId].sort()) &&
      JSON.stringify(restored.bodies) === JSON.stringify(redone.bodies),
    "actual packaged UI selection failed to restore identical native A/B/A geometry");
    const restoredPixels = await screenshot(app, page, receiptDir, receipt,
      "after-Redo-restored");
    stage = "source-native-A-B-A-compositor-material-pixel-proof";
    receipt.pixelProof = proveRaster(beforePixels, undonePixels, restoredPixels,
      { sourceId, partId, before, undone, redone, restored });
    for (const entry of receipt.screenshots) entry.materialPixelDeltaVerified = true;
    stage = "real-native-ICAD-save-open-after-pixel-restoration";
    await bounded(page.evaluate(file => window.__kreoda_test.saveIcad(file), icad),
      35_000, "real packaged native ICAD save");
    check(regular(icad).size > 100 &&
      fs.readFileSync(icad).readUInt32LE(0) === 0x04034b50,
    "genuine native ICAD ZIP project not saved");
    const icadSha = sha256(icad);
    await bounded(page.evaluate(file => window.__kreoda_test.openIcad(file), icad),
      35_000, "real packaged native ICAD reopen");
    await bodiesAre(page, [sourceId, partId]);
    check(sha256(icad) === icadSha, "ICAD was mutated by actual reopen");
    await inspectInterferences(page, 500, "after-Redo-and-ICAD-open-500", receipt, false);
    receipt.tests.push({ name: "real-Redo-ICAD-save-open-restores-overlap-500",
      pass: true, icadSha256: icadSha, redoneRevision: redone.revision });
    stage = "clean-authenticated-main-core-shutdown";
  } catch (failure) {
    error = failure;
    receipt.failure = { stage, reason: safeFailure(failure) };
  } finally {
    const clean = await cleanShutdown(app, mainOwner, coreOwner, receipt)
      .catch(() => false);
    if (!clean) {
      error ??= Error("Z40_BLOCKED: hosted exact packaged shutdown did not finish cleanly");
      receipt.failure ??= { stage: "clean-authenticated-main-core-shutdown",
        reason: "verified main/native process exit not complete" };
    }
    try {
      for (const [file, checksum] of [[candidate.exe, SHA.exe],
        [candidate.asar, SHA.asar], [candidate.core, SHA.core]]) pin(file, checksum);
    } catch {
      error ??= Error("Z40_BLOCKED: candidate package mutated after test");
      receipt.failure ??= { stage: "postflight-source-immutability",
        reason: "exact candidate packaged executable, ASAR or OCCT SHA changed" };
    }
    cleaned = clean && !error;
    if (clean) {
      try { fs.rmSync(profile, { recursive: true, force: true }); }
      catch {
        cleaned = false;
        error ??= Error("Z40_BLOCKED: isolated profile cleanup failed");
        receipt.failure ??= { stage: "disposable-profile-cleanup",
          reason: "profile could not be removed after authenticated process exit" };
      }
    }
    if (cleaned) receipt.status = "PASS_PACKAGED_Z40_INTERFERENCE";
    receipt.finishedAtUtc = new Date().toISOString();
    fs.writeFileSync(path.join(receiptDir, "receipt.json"),
      JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ status: receipt.status,
      receipt: path.join(receiptDir, "receipt.json"), testsPassed: receipt.tests.length,
      screenshots: receipt.screenshots.length }));
  }
  if (error) throw Error("Z40 packaged acceptance failed closed; inspect sanitized hosted receipt");
  check(receipt.status === "PASS_PACKAGED_Z40_INTERFERENCE",
    "packaged z40 interference smoke was not fully accepted");
}
if (process.argv.length === 3 && process.argv[2] === "--pixel-negative-selftest") {
  try { rasterNegativeSelftest(); }
  catch (error) {
    console.error("z40 CPU raster negative selftest FAILED:", safeFailure(error));
    process.exitCode = 1;
  }
} else {
  main().catch(() => {
    console.error("z40 packaged smoke FAILED; inspect hosted receipt.json");
    process.exitCode = 1;
  });
}
