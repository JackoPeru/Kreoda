// Prepare an isolated Windows-hosted smoke of the ORIGINAL byte-pinned package.
// This script does not launch Kreoda and never rewrites the package or its manifest.
// Usage: node scripts/ci/prepare-integrated-candidate-smoke.mjs <bundle.zip> <verification.json>
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const CANDIDATE_SHA = "036cff37ed0b5850926224cb0afc75a159a558897d77ffc1f74e314bccf85b1d";
const RECEIPT_SHA = "b7520dcddb43e98eb82f147beec8f22279678e3e39c000cba70a1fbd887f8f7a";
const SMOKE_SHA = "378a20e9f5eaef6cd2a3de845995ea0c05b26389c877719e853ca957d85c5355";
const RELEASE_ID = "0.1.0-integrated-20261113-c211b2e01fb7-f003945f69bd-476eccda";
const ORIGINAL_CORE_SHA = "f003945f69bdf04e7ab66ea1319b50e22723b5e716047e8dbb2f4e21dc3710b4";
const ORIGINAL_ASAR_SHA = "e22221c092c28f1c1ce9115c3e3ac883ea37fa1c903ef14cde55ff09ee01fdae";

const assert = (ok, reason) => { if (!ok) throw Error(`CANDIDATE BLOCKED: ${reason}`); };

async function sha256(file) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}

function inside(file, dir) {
  const relative = path.relative(dir, file);
  return relative.length > 0 && relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function main() {
  assert(process.platform === "win32" && process.arch === "x64", "requires disposable Windows x64 runner");
  assert(process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_ENVIRONMENT === "github-hosted",
    "must run only in a GitHub-hosted isolated runner");
  assert(process.argv.length === 4, "requires exactly ZIP and SHA verification receipt");
  const [zip, receiptFile] = process.argv.slice(2).map(p => path.resolve(p));
  assert((await sha256(zip)) === CANDIDATE_SHA, "original candidate ZIP hash differs");
  assert((await sha256(receiptFile)) === RECEIPT_SHA, "original 159-entry receipt hash differs");
  // Windows PowerShell 5.1 Set-Content -Encoding UTF8 writes a BOM. Keep the
  // source file byte-for-byte intact (the SHA above covers the BOM).
  const receipt = JSON.parse((await readFile(receiptFile, "utf8")).replace(/^\uFEFF/, ""));
  assert(receipt.status === "CANDIDATE_TRANSPORT_SHA256_VERIFIED_UNSMOKED_NOT_PROMOTED" &&
    receipt.sha256.toLowerCase() === CANDIDATE_SHA && receipt.entriesVerified === 159 &&
    receipt.allEntriesVerified === true && receipt.uncompressedBytes === 767386464,
    "source receipt status/count/size/identity invalid");
  const entries = receipt.entries;
  assert(Array.isArray(entries) && entries.length === 159, "missing file receipts");

  const root = process.cwd();
  const evidence = path.join(root, ".artifacts", "kreoda-integrated-package-20261113");
  const output = path.join(evidence, "output");
  const release = path.join(output, RELEASE_ID);
  let totalBytes = 0;
  const unique = new Set();
  for (const entry of entries) {
    const name = entry.path;
    assert(typeof name === "string" && name.startsWith(`${RELEASE_ID}/`) &&
      !name.includes("\\") && !name.split("/").includes("..") &&
      !unique.has(name) && entry.verified === true &&
      typeof entry.sha256 === "string" && /^[0-9a-f]{64}$/i.test(entry.sha256) &&
      Number.isSafeInteger(entry.size) && entry.size >= 0,
    `unsafe/duplicate/invalid receipt path: ${name}`);
    unique.add(name);
    const file = path.resolve(output, ...name.split("/"));
    assert(inside(file, output), `extraction escaped isolated output: ${name}`);
    const stat = await lstat(file);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.size === entry.size &&
      (await sha256(file)) === entry.sha256.toLowerCase(), `extracted bytes differ: ${name}`);
    totalBytes += stat.size;
  }
  assert(totalBytes === receipt.uncompressedBytes, "extracted total bytes differ");

  const originalPath = path.join(release, "release-manifest.json");
  assert(unique.has(`${RELEASE_ID}/release-manifest.json`), "original manifest absent from bundle");
  const original = JSON.parse((await readFile(originalPath, "utf8")).replace(/^\uFEFF/, ""));
  assert(original.releaseId === RELEASE_ID && original.status === "PACKAGED_UNSMOKED_NOT_PROMOTED" &&
    original.smokeRequired === true && original.nativeCore.sha256.toLowerCase() === ORIGINAL_CORE_SHA &&
    original.packagedResources.appAsarSha256.toLowerCase() === ORIGINAL_ASAR_SHA &&
    original.bridge?.publishedFiles?.length === 35 && original.bridge?.selfContained === false,
    "original desktop/OCCT/Bridge provenance invalid");
  const portable = path.join(release, "Kreoda-win32-x64");
  const bridgePublished = path.join(release, "Kreoda.HermesBridge-net8.0");
  assert((await sha256(path.join(portable, "resources", "kreoda-core.exe"))) === ORIGINAL_CORE_SHA &&
    (await sha256(path.join(portable, "resources", "app.asar"))) === ORIGINAL_ASAR_SHA,
    "packaged native core or ASAR changed");

  // Git for Windows may translate LF to CRLF on checkout. Do not accept an
  // arbitrary on-disk copy: restore the ORIGINAL byte-pinned Git blob instead.
  const smokeBlob = execFileSync("git", ["show", "HEAD:scripts/ci/candidate-portable-smoke.mjs"],
    { cwd: root, encoding: "buffer", maxBuffer: 2_000_000 });
  assert(createHash("sha256").update(smokeBlob).digest("hex") === SMOKE_SHA,
    "original committed smoke test script SHA changed");
  const smokeLocation = path.join(evidence, "scripts", "smoke-portable.mjs");
  const smokeManifestPath = path.join(evidence, "hosted-smoke-manifest.json");
  const pathsJson = path.join(root, ".codex", "paths.json");
  await mkdir(path.dirname(smokeLocation), { recursive: true });
  await mkdir(path.dirname(pathsJson), { recursive: true });
  await mkdir(path.join(root, ".codex", "tmp"), { recursive: true });
  await writeFile(smokeLocation, smokeBlob, { flag: "wx" });
  assert((await sha256(smokeLocation)) === SMOKE_SHA, "staged smoke script changed");

  // New *host-only* manifest points to the unchanged extracted files. Never modify
  // release-manifest.json, release Git heads or user-machine rollback baselines.
  const staged = {
    ...original, portable, bridgePublished, zipPath: zip,
    zipSha256: CANDIDATE_SHA,
    installedRollbackBaseline: [], installedBaselineAfter: [],
    hostedOriginalManifestSha256: await sha256(originalPath),
    hostedReceiptSha256: RECEIPT_SHA,
    hostedRunner: true,
  };
  await writeFile(smokeManifestPath, `${JSON.stringify(staged, null, 2)}\n`, { flag: "wx" });
  await writeFile(pathsJson, JSON.stringify({
    workspaceRoot: root, primaryCheckout: root, activeImplementationWorktree: root,
    tempDirectory: path.join(root, ".codex", "tmp"),
  }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({
    status: "EXACT_CANDIDATE_STAGED_ONLY_NOT_SMOKED",
    releaseId: RELEASE_ID, filesVerified: unique.size, bytesVerified: totalBytes,
    sha256: CANDIDATE_SHA, originalManifestSha256: staged.hostedOriginalManifestSha256,
    smokeScriptSha256: SMOKE_SHA, smokeManifestPath,
  }));
}

main().catch(error => { console.error(error?.stack || String(error)); process.exitCode = 1; });
