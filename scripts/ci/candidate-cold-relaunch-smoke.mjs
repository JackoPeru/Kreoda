// GitHub-hosted Windows x64 only. ORIGINAL SHA-pinned release, two complete
// packaged Electron + native OCCT lifecycles, one persistent isolated profile.
// This source is a candidate: no workflow changes, no local Kreoda launch.
// After the already-proven original bundle staging helper:
// node scripts/ci/candidate-cold-relaunch-smoke.mjs \
//   --prime-cold-relaunch-grant=PRIME_APPROVED_GITHUB_HOSTED_COLD_RELAUNCH
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packageRoot = path.join(root, '.artifacts', 'kreoda-integrated-package-20261113');
const acceptanceRoot = path.join(root, '.artifacts', 'kreoda-integrated-acceptance-20261114', 'cold-relaunch-smoke');
const releaseId = '0.1.0-integrated-20261113-c211b2e01fb7-f003945f69bd-476eccda';
const extracted = path.join(packageRoot, 'output', releaseId);
const portable = path.join(extracted, 'Kreoda-win32-x64');
const resources = path.join(portable, 'resources');
const bridgeDir = path.join(extracted, 'Kreoda.HermesBridge-net8.0');
const exe = path.join(portable, 'Kreoda.exe');
const coreExe = path.join(resources, 'kreoda-core.exe');
const appAsar = path.join(resources, 'app.asar');
const bridgeExe = path.join(bridgeDir, 'Kreoda.HermesBridge.exe');
const originalManifest = path.join(extracted, 'release-manifest.json');
const hostedManifest = path.join(packageRoot, 'hosted-smoke-manifest.json');
const pins = Object.freeze({
  originalManifest: '2064d409a22f1e0020e90ac194e7d8ebb5813550316e5ced69b5dc72b8d88a66',
  hostedReceipt: 'b7520dcddb43e98eb82f147beec8f22279678e3e39c000cba70a1fbd887f8f7a',
  bundle: '036cff37ed0b5850926224cb0afc75a159a558897d77ffc1f74e314bccf85b1d',
  exe: 'a09ee422ccf2c678db1b41ed3d2dbbcf987be1585e0a7cdbbc858321778a35b4',
  core: 'f003945f69bdf04e7ab66ea1319b50e22723b5e716047e8dbb2f4e21dc3710b4',
  asar: 'e22221c092c28f1c1ce9115c3e3ac883ea37fa1c903ef14cde55ff09ee01fdae',
  bridge: 'e1d9cbe0a91480f1b1f608e499ede409ef5a97daa8e38ca30eb27817415f6af0',
});
const fail = message => { throw Error('COLD_RELAUNCH_BLOCKED: ' + message); };
const assert = (condition, message) => { if (!condition) fail(message); };
const same = (a, b) => typeof a === 'string' && a.length > 0 &&
  path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const within = (file, dir) => {
  const relative = path.relative(dir, file);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) &&
    !path.isAbsolute(relative);
};
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const ordinary = file => {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink(), 'not an ordinary original-release file: ' + file);
  return stat;
};
function hash(file) {
  ordinary(file);
  const sha = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const n = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (n === 0) break;
      sha.update(buffer.subarray(0, n));
    }
  } finally { fs.closeSync(fd); }
  return sha.digest('hex');
}
function exact(file, expected) {
  assert(/^[0-9a-f]{64}$/i.test(expected) && hash(file) === expected.toLowerCase(),
    'original release SHA-256 mismatch: ' + file);
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(operation, timeout, description) {
  let timer;
  try {
    return await Promise.race([Promise.resolve(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('TIMEOUT: ' + description)), timeout);
    })]);
  } finally { clearTimeout(timer); }
}
async function until(fn, description, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    try {
      const result = await bounded(Promise.resolve().then(fn), 5_000, description + ' poll');
      if (result) return result;
    } catch (error) { last = error; }
    await delay(180);
  } while (Date.now() < deadline);
  fail('timed out waiting for ' + description + (last ? ': ' + last.message : ''));
}
function powershell(script, stage = 'win32-provenance') {
  const started = Date.now();
  const call = spawnSync('powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 2 * 1024 * 1024 });
  // Never include the script, stdout, stderr, command line, or process paths in
  // the receipt. Expose only bounded error class, exit code and elapsed time.
  const errorClass = call.error?.code === 'ETIMEDOUT' ? 'timeout' :
    call.error?.code === 'ENOENT' ? 'shell-unavailable' :
    call.error?.code === 'ENOBUFS' ? 'output-limit' :
    call.error ? 'spawn-error' : 'none';
  const exit = Number.isInteger(call.status) ? call.status : 'null';
  const signaturePhase = stage === 'native-conhost-targeted-signature' ? ({
    43: 'target-pid-absent', 61: 'cim-query-error', 62: 'windows-system-folder-error',
    63: 'signature-query-error', 64: 'creation-or-proof-format-error',
    65: 'json-serialization-error', 66: 'other-script-runtime-error',
  })[call.status] ?? 'unclassified-exit' : 'not-applicable';
  const elapsedBucketMs = Math.round((Date.now() - started) / 100) * 100;
  assert(!call.error && call.status === 0,
    'Windows process provenance query failed [stage=' + stage +
    ',exit=' + exit + ',cause=' + signaturePhase +
    ',error=' + errorClass + ',elapsedBucketMs=' + elapsedBucketMs + ']');
  return call.stdout.trim();
}
function processes() {
  const json = powershell("$ErrorActionPreference='Stop'; $all=@(Get-CimInstance Win32_Process | " +
    "Select-Object ProcessId,ParentProcessId,ExecutablePath,Name,@{Name='CreationDate';Expression={if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')}else{''}}}); " +
    'ConvertTo-Json -Compress -InputObject $all');
  const parsed = JSON.parse(json);
  assert(Array.isArray(parsed), 'Win32 process inventory is not an array');
  return new Map(parsed.filter(p => Number.isInteger(p.ProcessId)).map(p => [p.ProcessId, p]));
}
function noForeignOwners(records) {
  for (const item of records.values()) {
    assert(!['kreoda.exe', 'kreoda-core.exe', 'kreoda.hermesbridge.exe'].includes(
        String(item.Name || '').toLowerCase()),
    'foreign Kreoda/OCCT/Bridge process exists on this hosted runner');
  }
}
// The broad Win32_Process census can omit ExecutablePath for the host Node
// on one query and include it on the next. Verify the exact *current* Node
// identity through a separate PID-filtered CIM query, as the passing Bridge
// smoke does. Never infer host identity from parent PID alone.
function attestHostNode(records, rootPid, firstLaunchMs, diagnostics) {
  assert(Number.isSafeInteger(rootPid) && rootPid > 0 && rootPid === process.pid,
    'host root PID is not this test process');
  const census = records.get(rootPid);
  const status = {
    pid: rootPid, censusPresent: Boolean(census),
    censusImage: census ? path.win32.basename(census.ExecutablePath || '') : null,
    censusPathAvailable: Boolean(census?.ExecutablePath),
    censusPathMatches: Boolean(census && same(census.ExecutablePath, process.execPath)),
    queriedByPid: false, queriedImage: null, queriedPathMatches: false,
    queriedCreationValid: false, createdBeforeLaunch: false,
  };
  if (diagnostics) diagnostics.push(status);
  const raw = powershell(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${rootPid}'; if (-not $p) { '{}' } else { $p | Select-Object ProcessId,ParentProcessId,ExecutablePath,Name,@{Name='CreationDate';Expression={if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')}else{''}}} | ConvertTo-Json -Compress }`);
  const actual = JSON.parse(raw);
  status.queriedByPid = actual?.ProcessId === rootPid;
  status.queriedImage = typeof actual?.ExecutablePath === 'string'
    ? path.win32.basename(actual.ExecutablePath) : null;
  status.queriedPathMatches = same(actual?.ExecutablePath, process.execPath);
  const created = Date.parse(actual?.CreationDate || '');
  status.queriedCreationValid = Number.isFinite(created);
  status.createdBeforeLaunch = status.queriedCreationValid &&
    created <= firstLaunchMs + 2_000;
  assert(status.queriedByPid && status.queriedPathMatches &&
    status.createdBeforeLaunch && Number.isInteger(actual.ParentProcessId),
  'host Node exact PID/executable/creation failed targeted Win32 attestation');
  // A populated but conflicting census entry could indicate PID reuse.
  // Only an omitted/empty census image can be superseded by the strict query.
  assert(!census?.ExecutablePath || status.censusPathMatches,
    'host Node census image conflicts with targeted process identity');
  assert(!census?.CreationDate || census.CreationDate === actual.CreationDate,
    'host Node census creation time conflicts with targeted process identity');
  return actual;
}
// A Playwright launch can have an intermediate Node/cmd or another same-package
// Electron process. Prove a bounded, unbroken ancestor chain to THIS Node PID;
// every intermediate executable must be an exact whitelisted binary.
function ancestry(records, childPid, expectedExecutable, rootPid, expectedRootExecutable,
  intermediaryPaths, firstLaunchMs, limit = 7, rootDiagnostics = null) {
  // Two legitimate rooted trees use this verifier:
  // Electron -> trusted cmd.exe -> THIS Node; native OCCT -> Electron main.
  // The second root is the pinned Electron image, never process.execPath.
  let rootNode;
  if (same(expectedRootExecutable, process.execPath)) {
    assert(rootPid === process.pid, 'host root PID is not the running test Node');
    rootNode = attestHostNode(records, rootPid, firstLaunchMs, rootDiagnostics);
  } else {
    assert(same(expectedRootExecutable, exe) && rootPid !== process.pid,
      'native core root must be the expected pinned Electron image');
    rootNode = records.get(rootPid);
    const rootCreated = Date.parse(rootNode?.CreationDate || '');
    const status = { pid: rootPid, role: 'electron-parent-of-native-core',
      censusPresent: Boolean(rootNode),
      censusImage: rootNode ? path.win32.basename(rootNode.ExecutablePath || '') : null,
      exactPinnedElectron: Boolean(rootNode && same(rootNode.ExecutablePath, exe)),
      creationValid: Number.isFinite(rootCreated) &&
        rootCreated >= firstLaunchMs - 8_000 && rootCreated <= Date.now() + 2_000 };
    if (rootDiagnostics) rootDiagnostics.push(status);
    assert(status.exactPinnedElectron && status.creationValid && hash(exe) === pins.exe,
      'native OCCT parent PID/executable/creation differs from pinned Electron main');
  }
  const first = records.get(childPid);
  assert(first && same(first.ExecutablePath, expectedExecutable),
    'owned process PID/executable path mismatch: ' + childPid);
  const spawnedAt = Date.parse(first.CreationDate || '');
  assert(Number.isFinite(spawnedAt) && spawnedAt >= firstLaunchMs - 8_000 &&
    spawnedAt <= Date.now() + 2_000, 'owned process was not created for this Playwright launch');
  const chain = [{ pid: childPid, parentPid: first.ParentProcessId }];
  const visited = new Set([childPid]);
  let current = first;
  for (let hop = 0; hop < limit; ++hop) {
    if (current.ParentProcessId === rootPid) {
      assert(Date.parse(rootNode.CreationDate) <=
        Date.parse(current.CreationDate || '') + 2_000,
      'host Node process creation time contradicts verified ancestry');
      return chain;
    }
    const parent = records.get(current.ParentProcessId);
    assert(parent && !visited.has(parent.ProcessId),
      'missing/cyclic Playwright process parent for PID ' + childPid);
    assert(intermediaryPaths.some(expected => same(parent.ExecutablePath, expected)),
      'unrecognized Playwright process ancestor for PID ' + childPid);
    const parentCreated = Date.parse(parent.CreationDate || '');
    const childCreated = Date.parse(current.CreationDate || '');
    assert(Number.isFinite(parentCreated) && Number.isFinite(childCreated) &&
      parentCreated <= childCreated + 2_000, 'Playwright ancestry violates process creation order');
    visited.add(parent.ProcessId);
    chain.push({ pid: parent.ProcessId, parentPid: parent.ParentProcessId });
    current = parent;
  }
  fail('Playwright ancestry exceeded bounded depth for PID ' + childPid);
}
function descendants(records, parentPid, maxDepth = 8) {
  const owned = [];
  for (const candidate of records.values()) {
    if (candidate.ProcessId === parentPid) continue;
    let next = candidate;
    const visited = new Set([next.ProcessId]);
    for (let depth = 0; depth < maxDepth; depth++) {
      if (next.ParentProcessId === parentPid) {
        owned.push(candidate);
        break;
      }
      next = records.get(next.ParentProcessId);
      if (!next || visited.has(next.ProcessId)) break;
      visited.add(next.ProcessId);
    }
  }
  return owned;
}
function identityOf(p) {
  return { pid: p.ProcessId, parentPid: p.ParentProcessId,
    path: p.ExecutablePath, created: p.CreationDate };
}
function stillSame(records, record) {
  const current = records.get(record.pid);
  return current && current.CreationDate === record.created &&
    same(current.ExecutablePath, record.path);
}
// Windows may launch an authentic Console Host for our native console-subsystem
// OCCT executable. This is NOT a basename whitelist: its sole permitted parent
// is the already authenticated, unmodified native core in THIS Electron tree.
// All other process descendants must still be original Kreoda.exe/OCCT images.
function consoleHostShape(records, member, state, now = Date.now()) {
  const windows = process.env.SystemRoot || process.env.WINDIR;
  if (!windows || !path.win32.isAbsolute(windows) ||
      !state?.coreIdentity || !state.main || !state.coreChain) return false;
  const expected = path.win32.join(windows, 'System32', 'conhost.exe');
  const host = records.get(member.pid);
  const core = records.get(state.coreIdentity.pid);
  const main = records.get(state.main.pid);
  const hostCreated = Date.parse(member.created || '');
  const coreCreated = Date.parse(state.coreIdentity.created || '');
  return Boolean(host && core && main &&
    host.Name?.toLowerCase() === 'conhost.exe' &&
    same(member.path, expected) && same(host.ExecutablePath, expected) &&
    host.ProcessId === member.pid && host.ParentProcessId === member.parentPid &&
    host.CreationDate === member.created && member.parentPid === state.coreIdentity.pid &&
    stillSame(records, state.coreIdentity) && stillSame(records, state.main) &&
    core.ParentProcessId === state.main.pid && same(core.ExecutablePath, coreExe) &&
    main.ParentProcessId === state.main.parentPid &&
    Number.isFinite(hostCreated) && Number.isFinite(coreCreated) &&
    coreCreated >= state.launchStartedMs - 8_000 &&
    hostCreated >= coreCreated - 2_000 && hostCreated >= state.launchStartedMs - 8_000 &&
    hostCreated <= now + 2_000);
}
function authenticNativeConsoleHost(records, member, state) {
  if (!consoleHostShape(records, member, state)) return false;
  // Check the signed *OS* binary, not any same-named executable shipped by an
  // application. Target the already observed PID and recheck exact creation,
  // path and native parent to protect against a reused process ID.
  // Fixed exit codes identify a hosted PowerShell failure class without
  // exposing stderr, command text, local paths or pairing credentials.
  // A disappeared PID stays BLOCKED (43); do not infer its exit from a stale
  // process census or treat a failed identity query as proof of termination.
  const script = "$ErrorActionPreference='Stop'; try{ " +
    "try{$p=Get-CimInstance Win32_Process -Filter 'ProcessId = " + member.pid + "' -ErrorAction Stop}catch{exit 61}; " +
    "if(-not $p){exit 43}; " +
    "try{$os=[Environment]::GetFolderPath('Windows'); " +
    "if([string]::IsNullOrWhiteSpace($os) -or -not [IO.Path]::IsPathRooted($os)){exit 62}; " +
    "$trusted=[IO.Path]::Combine($os,'System32','conhost.exe')}catch{exit 62}; " +
    "try{$signature=Get-AuthenticodeSignature -LiteralPath $trusted -ErrorAction Stop; " +
    "$cert=$signature.SignerCertificate; " +
    "$microsoft=($signature.Status -eq 'Valid' -and $null -ne $cert -and " +
    "$cert.Subject -match '(?:^|,\\s*)CN=Microsoft Windows(?:,|$)' -and " +
    "$cert.Subject -match '(?:^|,\\s*)O=Microsoft Corporation(?:,|$)')}catch{exit 63}; " +
    "try{$created=if($p.CreationDate){$p.CreationDate.ToUniversalTime().ToString('o')}else{''}; " +
    "$proof=[pscustomobject]@{ProcessId=[int]$p.ProcessId;ParentProcessId=[int]$p.ParentProcessId;" +
    "Name=[string]$p.Name;ExecutablePath=[string]$p.ExecutablePath;" +
    "CreationDate=$created;TrustedPath=$trusted;MicrosoftSignatureValid=[bool]$microsoft}}catch{exit 64}; " +
    "try{$proof|ConvertTo-Json -Compress -ErrorAction Stop}catch{exit 65}" +
    "}catch{exit 66}";
  let proof;
  try { proof = JSON.parse(powershell(script, 'native-conhost-targeted-signature')); }
  catch (error) {
    if (error instanceof SyntaxError)
      fail('native conhost targeted signature query returned invalid JSON');
    throw error;
  }
  const verified = proof.ProcessId === member.pid &&
    proof.ParentProcessId === state.coreIdentity.pid &&
    proof.Name?.toLowerCase() === 'conhost.exe' &&
    same(proof.TrustedPath, member.path) && same(proof.ExecutablePath, proof.TrustedPath) &&
    proof.CreationDate === member.created && proof.MicrosoftSignatureValid === true &&
    hash(coreExe) === pins.core;
  if (verified) {
    state.pidDiagnostics ??= {};
    state.pidDiagnostics.verifiedNativeConsoleHosts ??= [];
    if (!state.pidDiagnostics.verifiedNativeConsoleHosts.some(p =>
      p.pid === member.pid && p.created === member.created)) {
      state.pidDiagnostics.verifiedNativeConsoleHosts.push({
        pid: member.pid, parentPid: member.parentPid, created: member.created,
        image: 'conhost.exe', trustedSystem32: true, validMicrosoftSignature: true,
        exactNativeParent: true,
      });
    }
  }
  return verified;
}
function preflight() {
  assert(process.platform === 'win32' && process.arch === 'x64' &&
    process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted' &&
    process.env.RUNNER_OS === 'Windows' && typeof process.env.GITHUB_WORKSPACE === 'string' &&
    path.isAbsolute(process.env.GITHUB_WORKSPACE) && same(process.env.GITHUB_WORKSPACE, root),
  'GitHub-hosted Windows x64 exact workspace is required');
  assert(process.argv.length === 3 &&
    process.argv[2] === '--prime-cold-relaunch-grant=PRIME_APPROVED_GITHUB_HOSTED_COLD_RELAUNCH',
  'separate prime hosted cold-relaunch grant is required');
  noForeignOwners(processes());
  exact(originalManifest, pins.originalManifest);
  const original = readJson(originalManifest);
  const hosted = readJson(hostedManifest);
  assert(original.status === 'PACKAGED_UNSMOKED_NOT_PROMOTED' &&
    original.smokeRequired === true && original.releaseId === releaseId &&
    hosted.releaseId === releaseId && hosted.hostedRunner === true &&
    hosted.hostedOriginalManifestSha256?.toLowerCase() === pins.originalManifest &&
    hosted.hostedReceiptSha256?.toLowerCase() === pins.hostedReceipt &&
    hosted.zipSha256?.toLowerCase() === pins.bundle &&
    same(hosted.portable, portable) && same(hosted.bridgePublished, bridgeDir) &&
    typeof hosted.zipPath === 'string' && path.isAbsolute(hosted.zipPath) &&
    within(path.resolve(hosted.zipPath), root),
  'hosted staging manifest does not identify the ORIGINAL tested release');
  assert(original.nativeCore?.sha256?.toLowerCase() === pins.core &&
    original.packagedResources?.appAsarSha256?.toLowerCase() === pins.asar &&
    original.bridge?.selfContained === false &&
    Array.isArray(original.bridge?.publishedFiles) && original.bridge.publishedFiles.length === 35,
  'original native OCCT/ASAR/Bridge manifest is incomplete');
  for (const [file, sha] of [[exe, pins.exe], [coreExe, pins.core], [appAsar, pins.asar],
    [bridgeExe, pins.bridge], [hosted.zipPath, pins.bundle]]) exact(file, sha);
  const seen = new Set();
  for (const entry of original.bridge.publishedFiles) {
    assert(typeof entry.name === 'string' && entry.name.length > 0 &&
      !path.win32.isAbsolute(entry.name) && !path.posix.isAbsolute(entry.name) &&
      !/[\0-\x1f:*?"<>|]/.test(entry.name) && /^[0-9a-f]{64}$/i.test(entry.sha256) &&
      Number.isSafeInteger(entry.size) && entry.size >= 0,
    'unsafe original Bridge manifest entry');
    const parts = entry.name.split(/[\\/]/);
    assert(parts.every(s => s && s !== '.' && s !== '..' && !/[. ]$/.test(s) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(s)),
    'Bridge manifest path component is not safe');
    const name = parts.join('/').toLowerCase();
    const file = path.resolve(bridgeDir, ...parts);
    assert(within(file, bridgeDir) && !seen.has(name), 'Bridge manifest path escaped or duplicated');
    seen.add(name);
    let folder = bridgeDir;
    for (const part of parts.slice(0, -1)) {
      folder = path.join(folder, part);
      const stat = fs.lstatSync(folder);
      assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Bridge dependency traverses a link');
    }
    assert(ordinary(file).size === entry.size, 'Bridge published entry size mismatch');
    exact(file, entry.sha256);
  }
  return { original, hosted };
}
function envFor(profile) {
  const env = { ...process.env, KREODA_BACKGROUND_TEST: '1',
    KREODA_RECOVERY_DIR: path.join(profile, 'recovery'),
    KREODA_PLUGINS_DIR: path.join(profile, 'plugins'),
    TEMP: profile, TMP: profile, TMPDIR: profile,
    APPDATA: path.join(profile, 'roaming'), LOCALAPPDATA: path.join(profile, 'local'),
    KREODA_HERMES_CONFIG: '', KREODA_VOICE_TOKEN: '',
    KREODA_UPDATE_FEED: '', KREODA_UPDATE_PUBKEY: '' };
  for (const key of ['KREODA_SESSION_HOST', 'KREODA_SESSION_PORT', 'KREODA_SESSION_TOKEN',
    'KREODA_AUTOMATIC_LOOPBACK_TEST', 'KREODA_CAD_SESSION_URL', 'KREODA_CAD_PAIR',
    'KREODA_MCP_PROBE_SCENARIO', 'ELECTRON_RUN_AS_NODE']) delete env[key];
  fs.mkdirSync(env.APPDATA, { recursive: true });
  fs.mkdirSync(env.LOCALAPPDATA, { recursive: true });
  return env;
}
async function start(electron, profile, cycle) {
  const launchStartedMs = Date.now();
  exact(exe, pins.exe);
  exact(coreExe, pins.core);
  const app = await bounded(electron.launch({ executablePath: exe,
    args: ['--no-sandbox', '--lang=en-US', '--start-hidden', '--user-data-dir=' + profile],
    env: envFor(profile), timeout: 40_000 }), 50_000, 'cycle ' + cycle + ' Electron launch');
  const state = { app, main: null, tracked: [], corePid: null,
    launchStartedMs, phase: cycle };
  try {
    // On hosted Windows, Playwright can report the PID of a cmd.exe launcher.
    // Electron's own main process reports its PID from app.evaluate().
    const playwrightPid = app.process()?.pid;
    state.pidDiagnostics = { playwrightPid: playwrightPid ?? null,
      electronMainPid: null, launcherInMainAncestry: false };
    assert(Number.isSafeInteger(playwrightPid) && playwrightPid > 0,
      'Playwright did not return a launcher PID');
    const actual = await bounded(app.evaluate(({ app: packaged, BrowserWindow }) => ({
      mainPid: process.pid,
      isPackaged: packaged.isPackaged, exe: process.execPath,
      appPath: packaged.getAppPath(), resources: process.resourcesPath,
      userData: packaged.getPath('userData'),
      visibleWindows: BrowserWindow.getAllWindows().filter(w => w.isVisible()).length,
    })), 10_000, 'cycle ' + cycle + ' packaged identity');
    const pid = actual.mainPid;
    const records = processes();
    const trustedCmd = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
    const intermediary = [exe, process.execPath, trustedCmd];
    const launcher = records.get(playwrightPid);
    const mainRecord = records.get(pid);
    // Keep the failure receipt diagnostic limited to PIDs, image basenames
    // and booleans: Win32 command lines and environment can contain secrets.
    state.pidDiagnostics = {
      playwrightPid, electronMainPid: Number.isSafeInteger(pid) ? pid : null,
      playwrightImage: launcher ? path.win32.basename(launcher.ExecutablePath || '') : null,
      electronMainImage: mainRecord ? path.win32.basename(mainRecord.ExecutablePath || '') : null,
      playwrightPathTrusted: Boolean(launcher &&
        (same(launcher.ExecutablePath, trustedCmd) || same(launcher.ExecutablePath, exe))),
      electronMainPathPinned: Boolean(mainRecord && same(mainRecord.ExecutablePath, exe)),
      launcherInMainAncestry: false,
      sameProcess: playwrightPid === pid,
    };
    assert(Number.isSafeInteger(pid) && pid > 0,
      'Electron main process did not provide a valid PID');
    assert(state.pidDiagnostics.playwrightPathTrusted,
      'Playwright-reported PID does not identify trusted cmd.exe or the original Electron executable');
    const launcherCreated = Date.parse(launcher.CreationDate || '');
    assert(Number.isFinite(launcherCreated) &&
      launcherCreated >= launchStartedMs - 8_000 && launcherCreated <= Date.now() + 2_000,
    'Playwright launcher PID does not match this launch time');
    state.pidDiagnostics.hostRootChecks = [];
    const chain = ancestry(records, pid, exe, process.pid, process.execPath, intermediary,
      launchStartedMs, 7, state.pidDiagnostics.hostRootChecks);
    state.pidDiagnostics.ancestry = chain.map(entry => ({
      pid: entry.pid, parentPid: entry.parentPid,
      image: path.win32.basename(records.get(entry.pid)?.ExecutablePath || ''),
    }));
    state.pidDiagnostics.launcherInMainAncestry =
      chain.some(entry => entry.pid === playwrightPid);
    assert(state.pidDiagnostics.launcherInMainAncestry,
      'Electron main process does not descend from this Playwright launcher PID');
    state.main = identityOf(records.get(pid));
    state.launcher = identityOf(launcher);
    state.mainChain = chain;
    assert(actual.isPackaged && same(actual.exe, exe) && same(actual.appPath, appAsar) &&
      same(actual.resources, resources) && actual.visibleWindows === 0 &&
      (same(actual.userData, profile) || within(actual.userData, profile)),
    'wrong packaged Electron executable, resources or isolated user profile');
    state.page = await bounded(app.firstWindow({ timeout: 30_000 }), 35_000,
      'cycle ' + cycle + ' hidden packaged BrowserWindow');
    const core = await until(async () => {
      const info = await state.page.evaluate(() => window.kreoda.coreInfo());
      return info?.running && Number.isInteger(info.pid) && info.pid > 0 ? info : null;
    }, 'cycle ' + cycle + ' real OCCT sidecar', 30_000);
    const live = processes();
    state.pidDiagnostics.nativeParentChecks = [];
    const coreChain = ancestry(live, core.pid, coreExe, pid, exe, [exe],
      launchStartedMs, 7, state.pidDiagnostics.nativeParentChecks);
    state.corePid = core.pid;
    state.coreChain = coreChain;
    state.coreIdentity = identityOf(live.get(core.pid));
    // The verified Playwright cmd.exe is part of our launched lifecycle too.
    // Keep its exact PID/image/creation identity for the shutdown check.
    state.tracked = [state.main, ...descendants(live, pid).map(identityOf)];
    if (state.launcher.pid !== pid) state.tracked.push(state.launcher);
    assert(state.tracked.some(p => p.pid === core.pid), 'sidecar not descendant of packaged Electron');
    for (const member of state.tracked) {
      const trusted = same(member.path, exe) || same(member.path, coreExe) ||
        (member.pid === playwrightPid && same(member.path, trustedCmd)) ||
        authenticNativeConsoleHost(live, member, state);
      if (!trusted) {
        state.pidDiagnostics.rejectedDescendants ??= [];
        state.pidDiagnostics.rejectedDescendants.push({
          pid: member.pid, parentPid: member.parentPid,
          image: path.win32.basename(member.path || ''),
        });
      }
      assert(trusted,
        'foreign executable descended from original packaged Electron');
    }
    state.identity = { playwrightPid, electronPid: pid, corePid: core.pid,
      electronAncestry: chain, coreAncestry: coreChain,
      initialOwnedChildren: state.tracked.length - 1,
      userDataIsolated: true, packaged: true,
      electronCreationDate: state.main.created,
      coreCreationDate: identityOf(live.get(core.pid)).created };
    return state;
  } catch (error) {
    // Return app handle to the caller's shutdown path, even when attestation
    // fails. No process may be killed unless its PID/path were verified.
    error.lifecycle = state;
    throw error;
  }
}
function captureOwned(state) {
  const live = processes();
  if (state.main && stillSame(live, state.main)) {
    const related = descendants(live, state.main.pid).map(identityOf);
    for (const item of related) {
      const trusted = same(item.path, exe) || same(item.path, coreExe) ||
        authenticNativeConsoleHost(live, item, state);
      if (!trusted) {
        state.pidDiagnostics ??= {};
        state.pidDiagnostics.rejectedDescendants ??= [];
        state.pidDiagnostics.rejectedDescendants.push({
          pid: item.pid, parentPid: item.parentPid,
          image: path.win32.basename(item.path || ''),
        });
      }
      assert(trusted,
        'foreign subprocess in owned Electron process tree');
    }
    const byPid = new Map([...state.tracked, ...related].map(p => [p.pid, p]));
    state.tracked = [...byPid.values()];
  }
}
async function shutdown(state) {
  if (!state?.app) return;
  let error;
  try {
    if (state.main) captureOwned(state);
    await bounded(state.app.close(), 15_000, 'cycle ' + state.phase + ' Electron close');
  } catch (cause) {
    error = cause;
    // Playwright's process handle may point to cmd.exe, not Electron main.
    // Terminate only the PID whose *Electron image and creation* were attested.
    // Never kill by basename or a PID that has been reused or changed path.
    try {
      if (state.main && stillSame(processes(), state.main)) process.kill(state.main.pid);
    } catch { /* original failure is retained */ }
  }
  if (state.main) {
    try {
      await until(() => {
        const live = processes();
        const lingering = state.tracked.filter(p => stillSame(live, p));
        if (lingering.length > 0) return false;
        noForeignOwners(live); // after this cycle no packaged binaries may remain
        return true;
      }, 'cycle ' + state.phase + ' all Electron/OCCT child processes exited', 22_000);
    } catch (cause) { error ??= cause; }
  } else {
    error ??= Error('Electron could not be ownership-attested before shutdown');
  }
  if (error) throw error;
  return { verifiedTerminatedPids: state.tracked.map(p => p.pid),
    verifiedCoreTerminated: state.tracked.some(p => p.pid === state.corePid) };
}
async function ensureWorkspace(page) {
  await until(async () =>
    await page.getByTestId('home-screen').isVisible() ||
    await page.getByTestId('workspace-chrome').isVisible(),
  'home or existing workspace after launch', 25_000);
  if (await page.getByTestId('home-screen').isVisible())
    await page.getByTestId('home-new-project').click();
  await page.getByTestId('workspace-chrome').waitFor({ state: 'visible', timeout: 25_000 });
  await page.getByText(/core 0\.1\.0(?!-stub)/i).waitFor({ state: 'visible', timeout: 25_000 });
  // Fresh isolated profiles show onboarding over the CAD canvas. Use its real
  // dismiss control; do not bypass the UI through DOM or storage mutations.
  const onboarding = page.getByTestId('onboarding');
  try { await onboarding.waitFor({ state: 'visible', timeout: 5_000 }); }
  catch { /* Already dismissed in this profile. */ }
  if (await onboarding.isVisible())
    await onboarding.getByRole('button', { name: 'Dismiss', exact: true })
      .click({ timeout: 8_000 });
  await onboarding.waitFor({ state: 'hidden', timeout: 12_000 });
}
async function snap(page) {
  return bounded(page.evaluate(() => window.__kreoda_test.snapshot()), 8_000, 'real CAD UI snapshot');
}
async function authoritative(page) {
  const state = await bounded(page.evaluate(async () => ({
    ui: window.__kreoda_test.snapshot(), relay: await window.kreoda.sessionSnapshot(),
  })), 8_000, 'real core/session revision');
  assert(Number.isInteger(state.ui?.revision) && state.ui.revision >= 0 &&
    Number.isInteger(state.relay?.revision) && state.relay.revision === state.ui.revision &&
    typeof state.relay?.documentId === 'string' && state.relay.documentId.length > 0,
  'UI revision does not match native CAD SessionRelay revision');
  return state;
}
function verifiedSolids(state, expected) {
  const bodies = state.ui.bodies;
  assert(Array.isArray(bodies) && bodies.length === 2 && expected.length === 2,
    'expected two actual OCCT BRep solids');
  const actualIds = bodies.map(b => b.id).sort();
  const expectedIds = expected.map(b => b.id).sort();
  assert(JSON.stringify(actualIds) === JSON.stringify(expectedIds),
    'saved feature identities do not match reopened feature identities');
  for (const body of bodies) {
    const goal = expected.find(b => b.id === body.id);
    assert(body.type === 'Box' && Array.isArray(body.paramsMm) && body.paramsMm.length === 3 &&
      body.paramsMm.every((n, i) => Number.isFinite(n) && Math.abs(n - goal.mm[i]) <= 1e-5),
    'persisted native Box dimensions differ: ' + body.id);
    const volume = goal.mm.reduce((a, b) => a * b, 1);
    assert(volume > 0 && Number.isFinite(body.volumeMm3) &&
      Math.abs(body.volumeMm3 - volume) <= Math.max(0.01, volume * 1e-6) &&
      Number.isInteger(body.triangles) && body.triangles > 0 &&
      body.geometryCurrent !== false && body.status !== 'blocked',
    'actual OCCT triangle/volume is invalid for Box ' + body.id);
  }
  return bodies.map(b => ({ id: b.id, dimensionsMm: b.paramsMm, triangles: b.triangles,
    volumeMm3: b.volumeMm3 }));
}
async function addBox(page, expectedCount) {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: /Add box/ }).click();
  const dialog = page.getByRole('dialog', { name: /Add box/i });
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  // The button relabels to Building... before native execution finishes.
  // A native body can already be visible while the dialog remains open.
  await dialog.waitFor({ state: 'hidden', timeout: 45_000 });
  return until(async () => {
    const state = await snap(page);
    return state?.bodies?.length === expectedCount &&
      state.bodies.every(b => b.triangles > 0 && b.volumeMm3 > 0) ? state : null;
  }, 'real native creation of box ' + expectedCount, 30_000);
}
async function runCommand(page, text) {
  const input = page.getByTestId('command-input');
  await input.fill(text, { timeout: 8_000 });
  await input.press('Enter', { timeout: 8_000 });
  const plan = page.getByTestId('plan-preview');
  await plan.waitFor({ state: 'visible', timeout: 10_000 });
  await plan.getByRole('button', { name: /Run 1 step/ }).click({ timeout: 10_000 });
  await plan.waitFor({ state: 'hidden', timeout: 40_000 });
  const errors = await page.getByText(/Stopped after|planning failed|execution failed/).allTextContents();
  assert(errors.length === 0, 'real Desktop command failed: ' + text);
}
async function selectFeature(page, id) {
  await page.getByRole('button', { name: 'Project' }).click();
  await page.getByTestId('object-tree-' + id).click({ timeout: 10_000 });
}
async function check(page, expected) {
  return until(async () => {
    const state = await authoritative(page);
    try { verifiedSolids(state, expected); return state; }
    catch { return null; }
  }, 'native features/volumes/revision to match', 30_000);
}
async function runFirst(page, file, receipt) {
  await ensureWorkspace(page);
  await addBox(page, 1);
  await addBox(page, 2);
  const first = await until(() => authoritative(page),
    'initial two OCCT box revisions agree with SessionRelay', 20_000);
  const initial = first.ui.bodies.map(b => ({ id: b.id, mm: [...b.paramsMm] }));
  assert(initial.length === 2 && initial[0].id !== initial[1].id &&
    initial.every(b => b.mm.length === 3 && b.mm.every(n => n > 0)),
  'original two distinct Boxes were not created');
  verifiedSolids(first, initial);
  const changedWidth = initial[0].mm[0] + 30;
  await selectFeature(page, initial[0].id);
  await runCommand(page, 'set widthMm ' + changedWidth);
  const saved = initial.map((entry, i) => ({ id: entry.id,
    mm: i === 0 ? [changedWidth, entry.mm[1], entry.mm[2]] : entry.mm }));
  const afterManual = await check(page, saved);
  assert(afterManual.ui.revision > first.ui.revision, 'manual UI edit did not advance native revision');
  await bounded(page.evaluate(target => window.__kreoda_test.saveIcad(target), file),
    35_000, 'write genuine ICAD from packaged native core');
  assert(ordinary(file).size > 100 && fs.readFileSync(file).readUInt32LE(0) === 0x04034b50,
    'saved ICAD is missing or not a genuine ZIP-backed project');
  const sha = hash(file);
  const atSave = await until(() => authoritative(page),
    'native revision immediately after ICAD write', 12_000);
  receipt.run1 = { ...receipt.run1, revisionAtCreation: first.ui.revision,
    revisionAtManualEdit: afterManual.ui.revision,
    revisionAtSave: atSave.ui.revision, documentId: atSave.relay.documentId,
    boxes: verifiedSolids(atSave, saved), icadSha256: sha, icadBytes: ordinary(file).size };
  return saved;
}
async function runSecond(page, file, persisted, receipt) {
  await ensureWorkspace(page);
  // Explicitly reopen exactly the file written by lifecycle #1. Never depend
  // on last-project state or automatic recovery across launches.
  const fileHashBeforeOpen = hash(file);
  assert(fileHashBeforeOpen === receipt.run1.icadSha256, 'ICAD bytes changed between full launches');
  await bounded(page.evaluate(target => window.__kreoda_test.openIcad(target), file),
    35_000, 'explicit open of lifecycle #1 ICAD');
  const reopened = await check(page, persisted);
  receipt.run2 = { ...receipt.run2, revisionAfterOpen: reopened.ui.revision,
    documentId: reopened.relay.documentId,
    boxesAfterOpen: verifiedSolids(reopened, persisted) };
  const targetHeight = persisted[0].mm[1] + 20;
  await selectFeature(page, persisted[0].id);
  await runCommand(page, 'set heightMm ' + targetHeight);
  const changed = persisted.map((b, i) => ({ id: b.id,
    mm: i === 0 ? [b.mm[0], targetHeight, b.mm[2]] : b.mm }));
  const edited = await check(page, changed);
  assert(edited.ui.revision > reopened.ui.revision,
    'manual edit after cold relaunch did not advance real native revision');
  await runCommand(page, 'undo');
  const undone = await check(page, persisted);
  await runCommand(page, 'redo');
  const redone = await check(page, changed);
  assert([edited, undone, redone].every(s => Number.isInteger(s.ui.revision) &&
    s.ui.revision >= 0), 'native Undo/Redo revision invalid');
  assert(hash(file) === fileHashBeforeOpen, 'opening/editing changed saved ICAD on disk');
  receipt.run2 = { ...receipt.run2,
    revisionAfterManualEdit: edited.ui.revision, revisionAfterUndo: undone.ui.revision,
    revisionAfterRedo: redone.ui.revision, boxesAfterRedo: verifiedSolids(redone, changed),
    sameIcadSha256: fileHashBeforeOpen, manualHeightMm: targetHeight,
    undoRestoredSavedDimensions: true, redoRestoredManualEdit: true };
}
async function main() {
  const baseline = preflight(); // fail closed BEFORE any evidence/profile side effects
  fs.mkdirSync(acceptanceRoot, { recursive: true });
  const receiptDir = fs.mkdtempSync(path.join(acceptanceRoot, 'hosted-'));
  const tmpRoot = path.join(root, '.codex', 'tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  const profile = fs.mkdtempSync(path.join(tmpRoot, 'candidate-cold-relaunch-'));
  const project = path.join(profile, 'cold-relaunch.icad');
  const receipt = { status: 'FAIL_OR_BLOCKED',
    scenario: 'original-packaged-electron-native-occt-cold-relaunch-icad-persistence',
    releaseId, startedAtUtc: new Date().toISOString(),
    isolatedRunner: 'github-hosted-windows',
    sourceCandidateCommit: baseline.original.gitHead ?? null,
    originalManifestSha256: pins.originalManifest, bundleSha256: pins.bundle,
    originalExeSha256: pins.exe, originalCoreSha256: pins.core,
    originalAsarSha256: pins.asar, originalBridgeSha256: pins.bridge,
    icadSha256: null, run1: {}, run2: {} };
  let current = null;
  let error = null;
  let safeToDelete = false;
  try {
    const requireDesktop = createRequire(path.join(root, 'apps', 'desktop', 'package.json'));
    const { _electron: electron } = requireDesktop('@playwright/test');
    current = await start(electron, profile, 1);
    receipt.run1.identity = current.identity;
    receipt.run1.pidDiagnostics = current.pidDiagnostics;
    const saved = await bounded(runFirst(current.page, project, receipt),
      165_000, 'lifecycle #1 native create/edit/save');
    receipt.icadSha256 = receipt.run1.icadSha256;
    receipt.run1.shutdown = await shutdown(current);
    current = null;
    noForeignOwners(processes()); // verify all old native processes truly stopped
    exact(exe, pins.exe);
    exact(coreExe, pins.core);
    exact(appAsar, pins.asar);
    current = await start(electron, profile, 2);
    receipt.run2.identity = current.identity;
    receipt.run2.pidDiagnostics = current.pidDiagnostics;
    assert(current.identity.electronPid !== receipt.run1.identity.electronPid ||
      current.identity.electronCreationDate !== receipt.run1.identity.electronCreationDate,
    'second launch did not establish an independent Electron lifecycle');
    assert(current.identity.corePid !== receipt.run1.identity.corePid ||
      current.identity.coreCreationDate !== receipt.run1.identity.coreCreationDate,
    'second launch reused the first native OCCT process');
    await bounded(runSecond(current.page, project, saved, receipt),
      160_000, 'lifecycle #2 actual ICAD reopen/edit/Undo/Redo');
    receipt.run2.shutdown = await shutdown(current);
    current = null;
    noForeignOwners(processes());
    for (const [file, sha] of [[exe, pins.exe], [coreExe, pins.core],
      [appAsar, pins.asar], [bridgeExe, pins.bridge], [originalManifest, pins.originalManifest]])
      exact(file, sha);
    assert(hash(project) === receipt.icadSha256,
      'genuine ICAD SHA changed unexpectedly after second full lifecycle');
    safeToDelete = true;
    receipt.status = 'PASS_ORIGINAL_PACKAGED_TWO_LIFECYCLES_NATIVE_OCCT';
  } catch (cause) {
    error = cause;
    if (cause?.lifecycle) {
      current = cause.lifecycle;
      const key = current.phase === 2 ? 'run2' : 'run1';
      receipt[key].pidDiagnostics = current.pidDiagnostics ?? {
        playwrightPid: current.app?.process()?.pid ?? null, electronMainPid: null };
    }
    receipt.failure = { kind: cause?.name || 'Error',
      message: String(cause?.message ?? cause).slice(0, 450) };
  } finally {
    if (current) {
      try { receipt.cleanupShutdown = await shutdown(current); safeToDelete = true; }
      catch (cause) {
        receipt.cleanupFailure = String(cause?.message ?? cause).slice(0, 450);
        error ??= cause;
      }
    }
    try {
      noForeignOwners(processes());
    } catch (cause) {
      receipt.status = 'FAIL_OR_BLOCKED';
      receipt.postflightFailure = String(cause?.message ?? cause).slice(0, 450);
      error ??= cause;
      safeToDelete = false;
    }
    receipt.finishedAtUtc = new Date().toISOString();
    fs.writeFileSync(path.join(receiptDir, 'receipt.json'),
      JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    if (safeToDelete) {
      try { fs.rmSync(profile, { recursive: true, force: true }); }
      catch { console.error('Isolated cold relaunch profile cleanup failed'); }
    }
    console.log(JSON.stringify({ status: receipt.status,
      receipt: path.join(receiptDir, 'receipt.json'),
      icadSha256: receipt.icadSha256 }));
  }
  if (error) throw error;
  assert(receipt.status === 'PASS_ORIGINAL_PACKAGED_TWO_LIFECYCLES_NATIVE_OCCT',
    'no successful two-cycle cold relaunch receipt');
}
main().catch(error => {
  console.error('Cold relaunch failed closed: ' + String(error?.message ?? error).slice(0, 450));
  process.exitCode = 1;
});
