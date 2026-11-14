// GitHub-hosted Stage D + official HTTP MCP for IMMUTABLE z40 *packaged*
// candidate. This is NOT a source/Dev Electron test. No CI or app modifications.
// Required: KREODA_Z40_EXTRACTED_ROOT = absolute RELEASE directory containing
//   Kreoda-win32-x64, release-manifest.json, KreodaQuest.apk.
// Required: KREODA_Z40_CANDIDATE_ZIP = exact 156-entry ZIP, next to its
// immutable candidate-zip-verification.json (both SHA-pinned).
// node scripts/ci/candidate-z40-stage-d-bridge-packaged-smoke.mjs \
//   --prime-z40-stage-d-bridge-grant=PRIME_APPROVED_GITHUB_HOSTED_Z40_STAGE_D_BRIDGE
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const releaseId = "0.1.0-integrated-renderer-z40-9d11ef58-225199551549";
const zipName = "Kreoda-" + releaseId + "-Desktop-Bridge-Quest.zip";
const probeDll = path.join(checkout,"clients","session-dotnet","probes","Kreoda.McpProbe","bin","Release","net8.0","Kreoda.McpProbe.dll");
const SHA = Object.freeze({
  probeSource: "7acefde7ed025ea0ca0bfa70cadf37ac4b52ed0fe1d99e7d34a12aa2a8bb7b9a",
  probeProject: "c98422cbe006543703c440ce4addc8f25bcc7befbbcacdb8e8c250b6d0368f6d",
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
const assert = check;
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
    process.argv[2] === "--prime-z40-stage-d-bridge-grant=PRIME_APPROVED_GITHUB_HOSTED_Z40_STAGE_D_BRIDGE",
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
  const zip = process.env.KREODA_Z40_CANDIDATE_ZIP;
  check(typeof zip === "string" && path.isAbsolute(zip) &&
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
  check(fs.readdirSync(resources).filter(name => name.toLowerCase().endsWith(".dll")).length === 45,
    "NEW z40 candidate does not contain exactly 45 original native DLLs");
  const bridgeFiles = [];
  const collectBridge = folder => {
    for (const node of fs.readdirSync(folder, { withFileTypes: true })) {
      const next = path.join(folder, node.name);
      if (node.isDirectory()) collectBridge(next);
      else { regular(next); bridgeFiles.push(next); }
    }
  };
  collectBridge(path.join(release, "Kreoda.HermesBridge-net8.0"));
  check(bridgeFiles.length === 35, "NEW candidate Bridge published inventory is not 35");
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
    "KREODA_MCP_PROBE_SCENARIO", "ELECTRON_RUN_AS_NODE", "GH_TOKEN", "GITHUB_TOKEN",
    "ACTIONS_RUNTIME_TOKEN", "NODE_AUTH_TOKEN", "NPM_TOKEN"]) delete env[key];
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
async function stageSnapshot(page) {
  return bounded(page.evaluate(() => window.__kreoda_test.snapshot()), 10_000,
    "real Renderer/CAD snapshot");
}
async function checkVolume(page, featureId, expectedVolume) {
  const snap = await until(async () => {
    const value = await stageSnapshot(page);
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

async function editDistance(page, sketchId, from, to, label) {
  await bounded(page.evaluate(id => window.__kreoda_test.openSketch(id), sketchId),
    10_000, "open solver-backed native sketch");
  const input = page.getByLabel(label, { exact: true });
  await input.waitFor({ state: "visible", timeout: 10_000 });
  assert((await input.inputValue()).trim() === String(from), "wrong current dimension " + label);
  await input.fill(String(to));
  await input.press("Enter");
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
    let diagnostics = "", diagnosticsBytes = 0;
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
      diagnostics += String(bytes);
      if (diagnosticsBytes > 128 * 1024) { run.kill(); finish(false, Error("probe stderr limit")); }
    });
    run.once("error", () => finish(false, Error("Release MCP probe spawn failed")));
    run.once("exit", (code, signal) => {
      if (expectFailure) {
        // Official .NET SDK probe throws on an actual MCP tool IsError result.
        // An arbitrary nonzero code (crash, transport failure, missing DLL)
        // is NOT evidence of device revocation. Do not log raw stderr/secrets.
        const marker = diagnostics.match(/kreoda_(?:query|describe_model) returned a tool error:\s*(\{[^\r\n]{1,4096}\})/);
        let denial;
        try { denial = marker ? JSON.parse(marker[1]) : null; } catch { denial = null; }
        if (code !== null && code !== 0 && signal === null && !output.trim() &&
          diagnostics.includes("System.InvalidOperationException:") &&
          denial?.status === "error" &&
          ["UNAUTHORIZED", "NOT_CONNECTED"].includes(denial.errorCode))
          finish(true, { expectedDenial: true, denialCode: denial.errorCode, nonzeroExitCode: code });
        else finish(false, Error("revocation lacked official SDK MCP authenticated-denial marker"));
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


function sourcePin(file, checksum) {
  check(within(file, checkout), "forbidden untrusted source provenance location");
  pin(file, checksum);
}
function freshProbeBuild(receipt) {
  const source = path.join(checkout, "clients", "session-dotnet", "probes", "Kreoda.McpProbe", "Program.cs");
  const project = path.join(checkout, "clients", "session-dotnet", "probes", "Kreoda.McpProbe", "Kreoda.McpProbe.csproj");
  sourcePin(source, SHA.probeSource);
  sourcePin(project, SHA.probeProject);
  const dotnetExe = powershell("(Get-Command dotnet.exe -ErrorAction Stop).Source");
  check(path.isAbsolute(dotnetExe) && path.win32.basename(dotnetExe).toLowerCase() === "dotnet.exe",
    "real .NET SDK executable unavailable");
  const run = spawnSync(dotnetExe,
    ["build", project, "-c", "Release", "--no-incremental", "--nologo", "--verbosity", "quiet",
      "-p:ContinuousIntegrationBuild=true"],
    { cwd: checkout, encoding: "utf8", windowsHide: true, timeout: 180_000,
      maxBuffer: 256 * 1024, env: {
        ...process.env, DOTNET_NOLOGO: "true", DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
        DOTNET_CLI_TELEMETRY_OPTOUT: "1",
      } });
  check(!run.error && run.status === 0 && !run.signal,
    "official .NET8 MCP probe Release build did not complete successfully");
  sourcePin(source, SHA.probeSource);
  sourcePin(project, SHA.probeProject);
  const probeHash = sha256(probeDll);
  for (const file of ["Kreoda.ModelingAgent.dll", "Kreoda.HermesBridge.dll",
    "Kreoda.SessionClient.dll", "ModelContextProtocol.Core.dll"]) {
    const dependency = path.join(path.dirname(probeDll), file);
    check(regular(dependency).size > 0, "published Release probe dependency missing");
  }
  receipt.probe = { programSha256: SHA.probeSource, projectSha256: SHA.probeProject,
    releaseDllSha256: probeHash, tfm: "net8.0", sdkBuild: "fresh-Release-on-hosted" };
  receipt.tests.push({ name: "fresh-official-dotnet8-release-mcpprobe-source-pinned", pass: true });
  return { dotnetExe, probeHash };
}
function cleanDisposableProfile(profile) {
  check(typeof profile === "string" &&
    within(profile, path.join(checkout, ".codex", "tmp")) &&
    path.basename(profile).startsWith("z40-stage-bridge-") &&
    !fs.lstatSync(profile).isSymbolicLink(), "profile cleanup path not trusted");
  fs.rmSync(profile, { recursive: true, force: true });
  check(!fs.existsSync(profile), "disposable profile still exists after teardown");
}
async function bootLifecycle(candidate, receipt, tag) {
  foreignOwnerGuard(); // no old/foreign native or Bridge image on the fresh runner
  const temp = path.join(checkout, ".codex", "tmp");
  fs.mkdirSync(temp, { recursive: true });
  const profile = fs.mkdtempSync(path.join(temp, "z40-stage-bridge-" + tag + "-"));
  const env = profileEnvironment(profile);
  const state = { tag, profile, env, app: null, main: null, core: null,
    children: [], childOwners: [], stage: "launch-exact-packaged-Electron" };
  try {
    const requireDesktop = createRequire(path.join(checkout, "apps", "desktop", "package.json"));
    const { _electron: electron } = requireDesktop("@playwright/test");
    const started = Date.now();
    state.app = await bounded(electron.launch({
      executablePath: candidate.exe,
      args: ["--no-sandbox", "--lang=en-US", "--start-hidden", "--user-data-dir=" + profile],
      env, timeout: 40_000,
    }), 50_000, "launch NEW z40 candidate packaged Electron " + tag);
    const launcherPid = state.app.process()?.pid;
    state.stage = "attest-actual-NEW-Electron-main-Node-cmd-ancestry";
    const mainPid = await bounded(state.app.evaluate(() => process.pid), 10_000,
      "actual packaged Electron main PID " + tag);
    state.main = packagedElectron(launcherPid, mainPid, candidate, profile, started);
    const identity = await bounded(state.app.evaluate(({ app, BrowserWindow }) => ({
      isPackaged: app.isPackaged, exe: process.execPath,
      appPath: app.getAppPath(), resources: process.resourcesPath,
      profile: app.getPath("userData"),
      hidden: BrowserWindow.getAllWindows().length === 1 &&
        BrowserWindow.getAllWindows().every(win => !win.isVisible()),
    })), 10_000, "prove actual NEW packaged Electron identity");
    check(identity.isPackaged && identity.hidden && same(identity.exe, candidate.exe) &&
      same(identity.appPath, candidate.asar) && same(identity.resources, candidate.resources) &&
      (same(identity.profile, profile) || within(identity.profile, profile)),
    "NEW candidate packaged Electron profile/ASAR/executable not authentic");
    state.page = await bounded(state.app.firstWindow({ timeout: 30_000 }), 35_000,
      "real packaged UI " + tag);
    state.stage = "attest-direct-child-OCCT-8.0.1";
    const core = await until(async () => {
      const info = await bounded(state.page.evaluate(() => window.kreoda.coreInfo()),
        5_000, "native coreInfo");
      return info?.running && Number.isInteger(info.pid) && info.pid > 0 ? info : null;
    }, "native OCCT core direct child " + tag, 30_000);
    state.core = nativeSidecar(core.pid, state.main, candidate, started);
    const version = await nativeCall(state.page, 1);
    check(version.occtVersion === "8.0.1-native", "OCCT 8.0.1 actual native core unavailable");
    receipt.lifecycle.push({ scenario: tag, process: {
      mainPid: state.main.pid, playwrightLauncherPid: launcherPid,
      corePid: state.core.pid, nativeDirectMainChild: state.core.parentPid === mainPid,
      ancestry: state.main.ancestry,
      newExeSha256: SHA.exe, newAsarSha256: SHA.asar, coreSha256: SHA.core,
    }, occtVersion: version.occtVersion });
    receipt.tests.push({ name: tag + "-actual-new-z40-packaged-native-OCCT-PID-proof", pass: true });
    return state;
  } catch (error) {
    state.failure = error;
    await shutdownLifecycle(state, receipt).catch(() => {});
    throw error;
  }
}
function aliveOwnChild(child) {
  return child && child.pid > 0 && child.exitCode === null &&
    child.signalCode === null;
}
function verifiedChild(child, file, parentPid, expectedHash = null) {
  check(aliveOwnChild(child) && typeof file === "string",
    "owned child process did not start");
  const live = win32Process(child.pid);
  check(live.ParentProcessId === parentPid && same(live.ExecutablePath, file),
    "hosted helper not exact direct child of test runner");
  if (expectedHash) pin(file, expectedHash);
  else check(regular(file).size > 0 && sha256(file) === sha256(live.ExecutablePath),
    "native hosted helper executable cannot be authenticated");
  return { pid: child.pid, parentPid: live.ParentProcessId, executable: live.ExecutablePath,
    created: live.CreationUtc };
}
async function releaseChild(child, owner, receipt) {
  if (!child) return true;
  if (aliveOwnChild(child)) {
    const live = maybeWin32Process(child.pid);
    if (!sameProcess(live, owner)) {
      receipt.cleanupIssue = "refused to terminate child PID with changed/unknown identity";
      return false;
    }
    // Only the actual Node-spawned apphost with previously attested Win32 PID,
    // exact executable and CreationUtc may be terminated, never by image census.
    child.kill();
  }
  try {
    await until(() => {
      const live = owner ? maybeWin32Process(owner.pid) : null;
      return (child.exitCode !== null || child.signalCode !== null) &&
        !sameProcess(live, owner) ? true : null;
    }, "attested helper PID exited", 10_000);
    return true;
  } catch { return false; }
}
async function shutdownLifecycle(state, receipt) {
  if (!state || state.shutdownDone) return state?.shutdownDone === true;
  const children = [...state.children].reverse();
  let clean = true;
  for (const entry of children) {
    const done = await releaseChild(entry.child, entry.owner, receipt).catch(() => false);
    if (!done) clean = false;
  }
  // The original proven z40 shutdown checks actual Electron+native+cmd wrapper,
  // never terminates Playwright's cmd.exe launcher directly.
  const desktop = await cleanShutdown(state.app, state.main, state.core, receipt)
    .catch(() => false);
  if (!desktop) clean = false;
  try {
    for (const [file, expected] of [[state.candidate?.exe, SHA.exe],
      [state.candidate?.asar, SHA.asar], [state.candidate?.core, SHA.core],
      [state.candidate?.bridgeExe, SHA.bridge]]) {
      if (file) pin(file, expected);
    }
  } catch { clean = false; receipt.postflightError = "NEW packaged executable SHA changed"; }
  if (clean) {
    try { cleanDisposableProfile(state.profile); }
    catch { clean = false; receipt.cleanupIssue = "ephemeral isolated profile cleanup failed"; }
  }
  if (!clean) receipt.cleanupFailures = (receipt.cleanupFailures ?? 0) + 1;
  state.shutdownDone = clean;
  return clean;
}
async function activatePrivateSession(state, candidate, receipt, label) {
  state.stage = label + "-private-WS-listener-and-pair";
  const listener = await bounded(state.page.evaluate(() =>
    window.kreoda.sessionEnable("127.0.0.1", 0)), 10_000, "private CAD WS listener");
  const sessionPort = listener?.listener?.port;
  check(Number.isInteger(sessionPort) && sessionPort > 0 && sessionPort <= 65535,
    "genuine private CAD WS endpoint absent");
  const pair = await bounded(state.page.evaluate(() => window.kreoda.sessionPair()), 10_000,
    "real CAD session pair");
  check(typeof pair?.token === "string" && pair.token.length >= 16,
    "genuine CAD pair token missing");
  const bridgePort = await unusedLoopbackPort();
  const url = "http://127.0.0.1:" + bridgePort;
  const deviceFile = path.join(state.profile, label + "-bridge-device.json");
  const bridgeEnv = { ...state.env, KREODA_HERMES_CONFIG: "",
    KREODA_CAD_SESSION_URL: "ws://127.0.0.1:" + sessionPort + "/",
    KREODA_CAD_PAIR: pair.token, KREODA_HERMES_BRIDGE_URL: url,
    KREODA_CAD_DEVICE_FILE: deviceFile, KREODA_MCP_PROBE_URL: url + "/mcp" };
  state.stage = label + "-published-Bridge-direct-child-and-health";
  const bridge = spawn(candidate.bridgeExe, [], {
    cwd: candidate.bridgeDir, env: bridgeEnv, windowsHide: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  state.children.push({ child: bridge, owner: null });
  let spawnError = false;
  bridge.once("error", () => { spawnError = true; });
  check(Number.isInteger(bridge.pid) && bridge.pid > 0,
    "unchanged published HermesBridge did not launch");
  const owner = verifiedChild(bridge, candidate.bridgeExe, process.pid, SHA.bridge);
  state.children.at(-1).owner = owner;
  await until(async () => {
    check(!spawnError && aliveOwnChild(bridge), "Bridge apphost exited before /health");
    const response = await fetch(url + "/health", { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return null;
    const health = await response.json();
    return health?.service === "kreoda-hermes-bridge" &&
      health.mcp === true && health.voiceConfigured === false ? health : null;
  }, "unchanged published .NET Bridge /health", 30_000);
  receipt.tests.push({ name: label + "-real-published-Bridge-HTTP-health",
    pass: true, bridgeSha256: SHA.bridge, port: bridgePort, voiceConfigured: false,
    nativeBridgePid: owner.pid, directTestNodeParent: owner.parentPid === process.pid,
    bridgeCreationUtc: owner.created });
  return { url, sessionPort, bridgePort, deviceFile, env: bridgeEnv };
}
async function runOfficialProbe(state, bridge, build, scenario = "", expectsDenial = false) {
  state.stage = (state.tag ?? "unknown") + "-official-dotnet8-" +
    (scenario || "mcp-createbox") + (expectsDenial ? "-revocation" : "");
  const env = { ...bridge.env, KREODA_MCP_PROBE_URL: bridge.url + "/mcp",
    KREODA_MCP_PROBE_SCENARIO: scenario,
    KREODA_CAD_DEVICE_FILE: path.join(state.profile,
      "probe-" + (scenario || "createbox") + ".json") };
  const { child, outcome } = probeRun(env, scenario, build.dotnetExe,
    [], expectsDenial);
  // Register official probe with its own exact identity/cleanup record.
  // prior to waiting so teardown remains deterministic on failure.
  const entry = { child, owner: null };
  state.children.push(entry);
  check(Number.isInteger(child.pid) && child.pid > 0, "official SDK probe never spawned");
  try { entry.owner = verifiedChild(child, build.dotnetExe, process.pid); }
  catch {
    // Exact .NET probe can finish synchronously before CIM sees the child.
    // Only an ALREADY EXITED child with no living Win32 PID is accepted.
    // A still-live or unknown child remains a strict fail-closed condition.
    check((child.exitCode !== null || child.signalCode !== null) &&
      !maybeWin32Process(child.pid), "live official probe PID was not authenticated");
    entry.owner = null;
  }
  return outcome;
}

async function verifyRealStageD(state, candidate, build, receipt) {
  const page = state.page;
  state.stage = "stage-d-native-occt-identity";
  const info = await nativeCall(page, 1);
  check(info.occtVersion === "8.0.1-native", "Stage D requires genuine OCCT 8.0.1");
  const bridge = await activatePrivateSession(state, candidate, receipt, "stage-d");
  state.stage = "stage-d-official-privatecadconnection-200x100px";
  const proof = await runOfficialProbe(state, bridge, build, "native-reference-reconstruction");
  check(proof?.scenario === "native-reference-reconstruction" &&
    proof.status === "committed" && proof.sourceId === "calibrated-source-01" &&
    proof.calibrationMmPerPixel === 0.5 && proof.rollbackVerified === true &&
    typeof proof.featureId === "string" && proof.featureId.length > 0 &&
    Number.isInteger(proof.revision) && proof.revision > 0,
  "genuine 200x100px .5mm/px Stage D calibration/rollback/commit absent");
  near(proof.volumeMm3, 25_600, 0.01);
  const at80x40 = await checkVolume(page, proof.featureId, 25_600);
  check(at80x40.revision === proof.revision,
    "Stage D real Bridge PrivateCadConnection/renderer revisions disagree");
  const initial = await stageSnapshot(page);
  check(initial.sketches?.length === 1 && initial.bodies?.length === 1,
    "Stage D must leave exactly one real editable OCCT sketch and solid");
  const sketchId = initial.sketches[0].id;
  const model = await checkNativeSketch(page, sketchId, 80, 40);
  receipt.tests.push({ name: "stage-d-privatecadconnection-real-200x100px-calibration-rollback-six-constraints",
    pass: true, probeSha256: build.probeHash, featureId: proof.featureId,
    calibrationMmPerPixel: 0.5, sourceId: proof.sourceId,
    rollbackVerified: true, sketchId, solver: model, ...at80x40 });
  state.stage = "stage-d-native-sketch-width-80-to-90";
  const home = page.getByTestId("home-new-project");
  if (await home.isVisible()) await home.click({ timeout: 12_000 });
  await page.getByTestId("workspace-chrome").waitFor({ state: "visible", timeout: 15_000 });
  await page.getByTestId("home-screen").waitFor({ state: "hidden", timeout: 12_000 });
  await editDistance(page, sketchId, 80, 90, "dist p0–p1");
  const at90x40 = await checkVolume(page, proof.featureId, 28_800);
  await checkNativeSketch(page, sketchId, 90, 40);
  await page.getByRole("button", { name: "Done", exact: true }).click({ timeout: 12_000 });
  receipt.tests.push({ name: "stage-d-actual-native-width-90-height-40-volume28800",
    pass: true, sketchId, ...at90x40 });
  state.stage = "stage-d-real-ICAD-save-open-roundtrip";
  const icad = path.join(state.profile, "stage-d-solver-native.icad");
  await bounded(page.evaluate(file => window.__kreoda_test.saveIcad(file), icad), 35_000,
    "real packaged Stage D ICAD save");
  check(regular(icad).size > 100 &&
    fs.readFileSync(icad).readUInt32LE(0) === 0x04034b50,
  "Stage D real solver ICAD file absent or not ZIP");
  const icadSha = sha256(icad);
  await bounded(page.evaluate(file => window.__kreoda_test.openIcad(file), icad), 35_000,
    "real packaged Stage D ICAD reopen");
  const reopened = await checkVolume(page, proof.featureId, 28_800);
  await checkNativeSketch(page, sketchId, 90, 40);
  check(sha256(icad) === icadSha, "Stage D saved ICAD modified by reopen");
  receipt.stageD = { icadSha256: icadSha, icadBytes: regular(icad).size,
    sketchId, sourceId: proof.sourceId, createdFeatureId: proof.featureId,
    calibrationMmPerPixel: 0.5, nativeConstraints: 6 };
  receipt.tests.push({ name: "stage-d-genuine-ICAD-save-reopen-six-constraints",
    pass: true, icadSha256: icadSha, ...reopened });
  state.stage = "stage-d-native-height-40-to-50";
  await editDistance(page, sketchId, 40, 50, "dist p1–p2");
  const at90x50 = await checkVolume(page, proof.featureId, 36_000);
  await checkNativeSketch(page, sketchId, 90, 50);
  await page.getByRole("button", { name: "Done", exact: true }).click({ timeout: 12_000 });
  receipt.tests.push({ name: "stage-d-actual-native-height-50-volume36000",
    pass: true, ...at90x50 });
  state.stage = "stage-d-real-Desktop-Undo-restores-90x40";
  await runBar(page, "undo");
  const undone = await checkVolume(page, proof.featureId, 28_800);
  await checkNativeSketch(page, sketchId, 90, 40);
  check(undone.revision > at90x50.revision &&
    undone.revision > at90x40.revision,
  "Stage D Undo did not advance genuine native revision");
  receipt.tests.push({ name: "stage-d-packaged-Desktop-Undo-restores-28800-six-constraints",
    pass: true, sketchId, ...undone });
  state.stage = "stage-d-private-session-disable";
  await bounded(page.evaluate(() => window.kreoda.sessionDisable()), 10_000,
    "stop disposable Stage D private CAD listener");
}
async function settleMcpWorkspace(page) {
  const home = page.getByTestId("home-new-project");
  await home.waitFor({ state: "visible", timeout: 15_000 });
  await home.click({ timeout: 12_000 });
  await page.getByTestId("workspace-chrome").waitFor({ state: "visible", timeout: 15_000 });
  await page.getByTestId("home-screen").waitFor({ state: "hidden", timeout: 12_000 });
  const onboarding = page.getByTestId("onboarding");
  if (await onboarding.isVisible()) {
    await onboarding.getByRole("button", { name: "Dismiss", exact: true })
      .click({ timeout: 8_000 });
  }
  await onboarding.waitFor({ state: "hidden", timeout: 12_000 });
  await until(async () => {
    const flags = await bounded(page.evaluate(() => {
      const visible = element => !!element &&
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== "hidden";
      const count = selector => [...document.querySelectorAll(selector)].filter(visible).length;
      return { home: count('[data-testid="home-screen"]'),
        workspace: count('[data-testid="workspace-chrome"]'),
        onboarding: count('[data-testid="onboarding"]'),
        dialogs: count('[role="dialog"]'), bodies:
          window.__kreoda_test?.snapshot?.().bodies?.length ?? -1 };
    }), 5_000, "actual modal-free packaged workspace");
    return flags.home === 0 && flags.workspace === 1 &&
      flags.onboarding === 0 && flags.dialogs === 0 && flags.bodies === 1;
  }, "actual modal-free packaged workspace has one new OCCT body", 15_000);
  await page.getByTestId("command-input").waitFor({ state: "visible", timeout: 8_000 });
}
async function verifyRealHttpMcp(state, candidate, build, receipt) {
  state.stage = "http-mcp-NEW-executable-empty-baseline";
  const initial = await stageSnapshot(state.page);
  check(Array.isArray(initial.bodies) && initial.bodies.length === 0 &&
    Array.isArray(initial.sketches) && initial.sketches.length === 0,
  "NEW HTTP MCP scenario is not a fresh isolated empty native document");
  const bridge = await activatePrivateSession(state, candidate, receipt, "http-mcp");
  state.stage = "http-mcp-official-eight-tools-resource-schema-empty";
  const before = await runOfficialProbe(state, bridge, build, "mcp-inspect");
  check(before?.scenario === "mcp-inspect" && before.status === "inspected" &&
    before.requestActive === false && before.features === 0 &&
    before.bodies === 0 && before.sketches === 0,
  "official HTTP SDK 8 tools/resources/describe_model could not inspect empty model");
  check(fs.existsSync(bridge.deviceFile), "published HermesBridge paired device not persisted");
  const device = readJson(bridge.deviceFile);
  check(typeof device.deviceId === "string" &&
    /^device-[0-9a-f-]{36}$/i.test(device.deviceId) &&
    device.sessionUrl === bridge.env.KREODA_CAD_SESSION_URL,
  "official private WS device identity was not actually paired");
  receipt.tests.push({ name: "http-mcp-official-eight-tools-resources-schema-empty-description",
    pass: true, baseline: { features: 0, bodies: 0, sketches: 0 },
    persistedActualDeviceBinding: true });
  state.stage = "http-mcp-real-CreateBox-OCCT-volume100000";
  const created = await runOfficialProbe(state, bridge, build, "");
  check(created && Array.isArray(created.passed) && created.passed.length === 3 &&
    created.passed.includes("native-canonical-checked-transaction") &&
    typeof created.featureId === "string" && created.featureId.length > 0 &&
    Number.isInteger(created.finalRevision) && created.finalRevision > 0 &&
    Number.isFinite(created.measuredVolumeMm3) &&
    Math.abs(created.measuredVolumeMm3 - 100_000) <= 0.01 &&
    created.solidCount === 1,
  "real HTTP MCP SDK CreateBox/commit/native BRep measuredVolume did not pass");
  const afterInspect = await runOfficialProbe(state, bridge, build, "mcp-inspect");
  check(afterInspect.status === "inspected" &&
    afterInspect.features === 1 && afterInspect.bodies === 1 &&
    afterInspect.requestActive === false,
  "actual HTTP MCP describe_model did not observe committed native solid");
  const actual = await until(async () => {
    const doc = await stageSnapshot(state.page);
    const body = doc?.bodies?.find(item => item.id === created.featureId);
    return doc?.revision === created.finalRevision &&
      body?.triangles === 12 &&
      body.geometryCurrent !== false &&
      Math.abs(body.volumeMm3 - 100_000) <= 0.01 ? doc : null;
  }, "new packaged renderer shares genuine HTTP MCP OCCT 12 triangle solid", 25_000);
  receipt.tests.push({ name: "http-mcp-native-CreateBox-volume100000-12triangles-shared-renderer",
    pass: true, featureId: created.featureId,
    revision: actual.revision, volumeMm3: created.measuredVolumeMm3, triangles: 12 });
  state.stage = "http-mcp-packaged-Desktop-real-Undo";
  await settleMcpWorkspace(state.page);
  await runBar(state.page, "undo");
  const undone = await until(async () => {
    const snapshotValue = await stageSnapshot(state.page);
    return snapshotValue?.bodies?.length === 0 &&
      snapshotValue?.revision > created.finalRevision ? snapshotValue : null;
  }, "NEW packaged Desktop Undo clears official MCP-created OCCT body", 25_000);
  const afterUndo = await runOfficialProbe(state, bridge, build, "mcp-inspect");
  check(afterUndo.status === "inspected" && afterUndo.features === 0 &&
    afterUndo.bodies === 0 && afterUndo.requestActive === false,
  "official MCP query not observing genuine Desktop Undo");
  receipt.tests.push({ name: "http-mcp-Desktop-Undo-shares-one-native-document",
    pass: true, beforeRevision: created.finalRevision,
    afterUndoRevision: undone.revision, nativeBodies: 0 });
  state.stage = "http-mcp-device-revocation-UNAUTHORIZED";
  await bounded(state.page.evaluate(id => window.kreoda.sessionRevoke(id), device.deviceId),
    10_000, "real user revokes paired HermesBridge device");
  const denied = await runOfficialProbe(state, bridge, build, "mcp-inspect", true);
  check(denied?.expectedDenial === true && denied.denialCode === "UNAUTHORIZED",
  "device revocation lacks official SDK structured UNAUTHORIZED proof");
  const response = await bounded(fetch(bridge.url + "/health", {
    signal: AbortSignal.timeout(2000),
  }), 5_000, "Bridge remains live after real authentication revoke");
  check(response.ok && (await response.json())?.mcp === true,
  "Bridge stopped; cannot attribute SDK MCP error to auth revocation");
  receipt.tests.push({ name: "http-mcp-authenticated-UNAUTHORIZED-after-Desktop-device-revoke",
    pass: true, authenticatedDenialCode: "UNAUTHORIZED", stillLiveHttpMcp: true });
  state.stage = "http-mcp-private-session-disable";
  await bounded(state.page.evaluate(() => window.kreoda.sessionDisable()), 10_000,
    "disable disposable HTTP MCP private CAD listener");
}
async function main() {
  // NONE of these candidate paths refer to the earlier ASAR or previous
  // hosted Stage D / Bridge result. Every receipt is generated afresh.
  const candidate = preflight();
  candidate.bridgeDir = path.join(candidate.release, "Kreoda.HermesBridge-net8.0");
  candidate.bridgeExe = path.join(candidate.bridgeDir, "Kreoda.HermesBridge.exe");
  pin(candidate.bridgeExe, SHA.bridge);
  const dest = path.join(checkout, ".artifacts", "kreoda-z40-stage-bridge");
  fs.mkdirSync(dest, { recursive: true });
  const receiptDir = fs.mkdtempSync(path.join(dest, "hosted-"));
  const receipt = { status: "FAIL_OR_BLOCKED",
    scenario: "actual-NEW-z40-packaged-StageD-PrivateCadConnection-and-official-HTTP-MCP",
    releaseId, startedAtUtc: new Date().toISOString(),
    runner: "github-hosted-windows-x64", manifestSha256: SHA.manifest,
    zipSha256: SHA.zip, zipReceiptSha256: SHA.zipReceipt,
    exeSha256: SHA.exe, asarSha256: SHA.asar, coreSha256: SHA.core,
    bridgeSha256: SHA.bridge, originalBundleSha256: SHA.originalBundle,
    originalAsarSha256: SHA.originalAsar, sourceUiSha256: SHA.sourceUi,
    tests: [], lifecycle: [], probes: [] };
  let error = null, stage = "fresh-official-dotnet8-MCP-probe-build";
  let state = null;
  try {
    const build = freshProbeBuild(receipt);
    for (const tag of ["stage-d", "http-mcp"]) {
      stage = tag + "-actual-packaged-Electron";
      state = await bootLifecycle(candidate, receipt, tag);
      state.candidate = candidate;
      try {
        if (tag === "stage-d") await bounded(verifyRealStageD(state, candidate, build, receipt),
          240_000, "full genuine packaged Stage D native reference solver roundtrip");
        else await bounded(verifyRealHttpMcp(state, candidate, build, receipt),
          210_000, "full official HTTP MCP pairing/commit/Undo/revocation");
      } finally {
        stage = tag + "-authenticated-owned-PID-clean-shutdown";
        const clean = await shutdownLifecycle(state, receipt).catch(() => false);
        check(clean, "authentic NEW z40 " + tag + " process cleanup incomplete");
        state = null;
      }
    }
    stage = "full-postflight-package-source-and-probe-identity";
    for (const [file, expected] of [
      [candidate.exe, SHA.exe], [candidate.asar, SHA.asar],
      [candidate.core, SHA.core], [candidate.bridgeExe, SHA.bridge],
      [path.join(candidate.release, "release-manifest.json"), SHA.manifest],
    ]) pin(file, expected);
    sourcePin(path.join(checkout, "clients", "session-dotnet", "probes",
      "Kreoda.McpProbe", "Program.cs"), SHA.probeSource);
    pin(probeDll, receipt.probe.releaseDllSha256);
    foreignOwnerGuard();
    check(receipt.tests.length === 14 &&
      receipt.tests.every(test => test.pass === true) &&
      receipt.lifecycle.length === 2 &&
      receipt.stageD?.nativeConstraints === 6 &&
      hex(receipt.stageD?.icadSha256) &&
      receipt.cleanupFailures === undefined,
    "both new package lifecycle acceptance scenarios did not complete");
    receipt.status = "PASS_Z40_PACKAGED_STAGE_D_BRIDGE";
  } catch (failure) {
    error = failure;
    receipt.failure = { stage: state?.stage ?? stage, reason: safeFailure(failure) };
  } finally {
    if (state) {
      try {
        const stopped = await shutdownLifecycle(state, receipt);
        if (!stopped) error ??= Error("z40 StageD/MCP owned process cleanup failed");
      } catch { error ??= Error("z40 StageD/MCP cleanup exception"); }
    }
    if (error) receipt.status = "FAIL_OR_BLOCKED";
    receipt.finishedAtUtc = new Date().toISOString();
    fs.writeFileSync(path.join(receiptDir, "receipt.json"),
      JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ status: receipt.status,
      receipt: path.join(receiptDir, "receipt.json"),
      checked: receipt.tests.length, lifecycles: receipt.lifecycle.length }));
  }
  if (error || receipt.status !== "PASS_Z40_PACKAGED_STAGE_D_BRIDGE")
    throw Error("z40 packaged Stage D/Bridge acceptance FAILED; inspect new sanitized hosted receipt");
}
main().catch(() => {
  console.error("new z40 packaged StageD+HTTP-MCP smoke FAILED; see hosted receipt");
  process.exitCode = 1;
});
