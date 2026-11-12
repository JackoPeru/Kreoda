import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(import.meta.dirname, "..");
const transientPaths = [
  "clients/quest-unity/Assets/Resources/DevAgentSettings.asset",
  "clients/quest-unity/ProjectSettings/ProjectSettings.asset",
  "clients/quest-unity/Assets/StreamingAssets/RuntimeActionBindings.json",
  "clients/quest-unity/Assets/StreamingAssets/RuntimeActionBindings.json.meta",
];
const option = name => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sha256 = file => hash(readFileSync(file));

function within(base, target) {
  const path = relative(resolve(base), resolve(target));
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function assertWithin(base, target, label) {
  if (!within(base, target)) throw new Error(`${label} escapes its allowed directory`);
}

function entry(path) {
  try { return lstatSync(path); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function assertNoSymlinkPath(path) {
  const full = resolve(path);
  const root = parse(full).root;
  let cursor = root;
  for (const part of relative(root, full).split(sep)) {
    if (!part) continue;
    cursor = join(cursor, part);
    const info = entry(cursor);
    if (!info) break;
    if (info.isSymbolicLink()) throw new Error(`Refusing symlink path: ${cursor}`);
  }
}

function fileState(sourceRoot, path) {
  const full = resolve(sourceRoot, ...path.split("/"));
  assertWithin(sourceRoot, full, "Transient source path");
  assertNoSymlinkPath(full);
  const info = entry(full);
  if (!info) return { path, full, present: false, sha256: null, bytes: null };
  if (!info.isFile()) throw new Error(`Transient source is not a regular file: ${path}`);
  const bytes = readFileSync(full);
  return { path, full, present: true, sha256: hash(bytes), bytes };
}

function evidenceFile(output, path) {
  const full = resolve(output, ...path.split("/"));
  assertWithin(output, full, "Evidence path");
  assertNoSymlinkPath(full);
  mkdirSync(dirname(full), { recursive: true });
  assertNoSymlinkPath(full);
  if (entry(full)) throw new Error(`Evidence file already exists: ${full}`);
  return full;
}

export function prepareOutputDirectory(path) {
  const output = resolve(path);
  assertNoSymlinkPath(output);
  if (entry(output)) throw new Error("Output directory already exists");
  mkdirSync(dirname(output), { recursive: true });
  assertNoSymlinkPath(dirname(output));
  mkdirSync(output);
  assertNoSymlinkPath(output);
  if (!entry(output)?.isDirectory()) throw new Error("Output path is not a directory");
  return output;
}

export function snapshotTransientSources(sourceRoot, output) {
  const root = resolve(sourceRoot);
  const evidenceRoot = resolve(output);
  assertNoSymlinkPath(root);
  assertNoSymlinkPath(evidenceRoot);
  if (!entry(evidenceRoot)?.isDirectory()) throw new Error("Output directory must already exist");

  const files = transientPaths.map(path => {
    const state = fileState(root, path);
    let backupPath = null;
    if (state.present) {
      const backup = evidenceFile(evidenceRoot, `transient-before/${path}`);
      writeFileSync(backup, state.bytes);
      backupPath = relative(evidenceRoot, backup).split(sep).join("/");
    }
    return { ...state, backupPath };
  });
  const manifest = files.map(({ path, present, sha256: digest, backupPath }) => ({ path, present, sha256: digest, backupPath }));
  writeFileSync(evidenceFile(evidenceRoot, "transient-before.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { repo: root, output: evidenceRoot, files };
}

export function cleanupTransientSources(snapshot) {
  const { repo: sourceRoot, output, files } = snapshot;
  const cleanupErrors = [];
  const observed = files.map(before => {
    let after;
    try { after = fileState(sourceRoot, before.path); }
    catch (error) {
      const item = { path: before.path, beforePresent: before.present, beforeSha256: before.sha256,
        afterPresent: null, afterSha256: null, changed: true, archivePath: null, archiveMethod: null, archiveError: error.message };
      cleanupErrors.push(`${before.path}: ${error.message}`);
      return { before, after: null, item, archived: false };
    }
    const changed = before.present !== after.present || before.sha256 !== after.sha256;
    const item = { path: before.path, beforePresent: before.present, beforeSha256: before.sha256,
      afterPresent: after.present, afterSha256: after.sha256, changed, archivePath: null, archiveMethod: null, archiveError: null };
    let archived = !changed || !after.present;
    if (changed && after.present) {
      try {
        const archive = evidenceFile(output, `transient-effects/${before.path}`);
        if (before.present) {
          writeFileSync(archive, after.bytes);
          item.archiveMethod = "copy";
        } else {
          renameSync(after.full, archive);
          item.archiveMethod = "move";
        }
        item.archivePath = relative(output, archive).split(sep).join("/");
        archived = true;
      } catch (error) {
        item.archiveError = error.message;
        cleanupErrors.push(`${before.path}: archive failed: ${error.message}`);
      }
    }
    return { before, after, item, archived };
  });

  let observationRecorded = false;
  try {
    const observedFile = evidenceFile(output, "transient-effects/observed.json");
    writeFileSync(observedFile, JSON.stringify(observed.map(({ item }) => item), null, 2) + "\n");
    observationRecorded = true;
  } catch (error) {
    cleanupErrors.push(`Could not record transient observations: ${error.message}`);
  }

  const restoredSourcePaths = [];
  if (observationRecorded) {
    for (const { before, after, item, archived } of observed) {
      if (!item.changed || !after || !archived) continue;
      try {
        if (before.present) {
          const current = fileState(sourceRoot, before.path);
          if (!current.present || current.sha256 !== before.sha256) {
            mkdirSync(dirname(current.full), { recursive: true });
            assertNoSymlinkPath(current.full);
            writeFileSync(current.full, before.bytes);
          }
        }
        const restored = fileState(sourceRoot, before.path);
        if (restored.present !== before.present || restored.sha256 !== before.sha256) throw new Error("Post-restore state differs from pre-build snapshot");
        restoredSourcePaths.push(before.path);
      } catch (error) {
        cleanupErrors.push(`${before.path}: restore failed: ${error.message}`);
      }
    }
  }

  const result = { temporarySourceChangesObserved: observed.filter(({ item }) => item.changed).map(({ item }) => item),
    restoredSourcePaths, cleanupErrors };
  try {
    writeFileSync(evidenceFile(output, "transient-effects/cleanup.json"), JSON.stringify(result, null, 2) + "\n");
  } catch (error) { result.cleanupErrors.push(`Could not record cleanup result: ${error.message}`); }
  return result;
}

function sourceFingerprint(file) {
  const info = lstatSync(file);
  return info.isSymbolicLink() ? `symlink:${readlinkSync(file)}` : sha256(file);
}

function sources(sourceRoot, output) {
  const result = spawnSync("git", ["ls-files", "-c", "-o", "--exclude-standard", "-z"], { cwd: sourceRoot, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error("Cannot enumerate build inputs");
  const outputRelative = relative(sourceRoot, output).split(sep).join("/");
  const outputInsideRepo = outputRelative !== ".." && !outputRelative.startsWith("../") && !isAbsolute(outputRelative);
  return Object.fromEntries(result.stdout.split("\0").filter(Boolean).filter(file =>
    !outputInsideRepo || (file !== outputRelative && !file.startsWith(outputRelative + "/")))
    .sort().map(file => [file, sourceFingerprint(join(sourceRoot, file))]));
}

function run(program, args, log, cwd, env = process.env) {
  const fd = openSync(log, "w");
  try {
    const result = spawnSync(program, args, { cwd, windowsHide: true, env, stdio: ["ignore", fd, fd] });
    if (result.error) throw result.error;
    return result.status;
  } finally { closeSync(fd); }
}

function main() {
  const editor = option("--unity") ?? process.env.UNITY_EDITOR;
  const sdk = option("--sdk") ?? process.env.ANDROID_SDK_ROOT;
  const outputArgument = option("--output");
  if (!editor || !sdk || !outputArgument || ![editor, sdk, outputArgument].every(isAbsolute) ||
      !existsSync(editor) || !existsSync(sdk)) {
    console.error("Usage: node scripts/build-quest-client.mjs --unity <Editor.exe> --sdk <Android SDK> --output <new absolute directory>");
    process.exitCode = 1;
    return;
  }

  const evidence = { startedAt: new Date().toISOString(), unity: editor, sdk, directExitCode: null };
  const output = resolve(outputArgument);
  let outputReady = false;
  try {
    prepareOutputDirectory(output);
    outputReady = true;

    const stage = join(output, "managed");
    const stageExit = run(process.execPath, [join(repo, "scripts/build-quest-managed.mjs"), "--output", stage], join(output, "managed.log"), repo);
    if (stageExit !== 0) throw new Error("Managed staging failed: " + stageExit);
    const plugins = join(repo, "clients/quest-unity/Assets/Plugins/Kreoda.Managed");
    mkdirSync(plugins, { recursive: true });
    for (const file of readdirSync(stage)) copyFileSync(join(stage, file), join(plugins, file));

    const apk = join(output, "KreodaQuest.apk");
    const log = join(output, "unity-build.log");
    const args = ["-batchmode", "-nographics", "-buildTarget", "Android", "-projectPath",
      join(repo, "clients/quest-unity"), "-executeMethod", "Kreoda.QuestEditor.QuestBuild.Build", "-quit", "-logFile", log];
    const before = sources(repo, output);
    writeFileSync(join(output, "source-before.json"), JSON.stringify(before, null, 2) + "\n");
    const transient = snapshotTransientSources(repo, output);
    const started = Date.now();
    let launchError = null;
    try {
      // Wait for the direct Editor child, without waiting on licensing descendants.
      evidence.directExitCode = run(editor, args, join(output, "unity-launcher.log"), repo, { ...process.env,
        KREODA_ANDROID_SDK: sdk, KREODA_APK_PATH: apk, KREODA_BUILD_REPORT: join(output, "build-report.json") });
    } catch (error) {
      launchError = error;
      evidence.directExitCode = 1;
      evidence.launchError = error.message;
    } finally {
      evidence.elapsedSeconds = (Date.now() - started) / 1000;
      try { Object.assign(evidence, cleanupTransientSources(transient)); }
      catch (error) { evidence.cleanupErrors = [`Transient cleanup failed: ${error.message}`]; }
      evidence.logSha256 = existsSync(log) ? sha256(log) : null;
      try {
        const after = sources(repo, output);
        writeFileSync(join(output, "source-after.json"), JSON.stringify(after, null, 2) + "\n");
        evidence.sourceChangedDuringBuild = [...new Set([...Object.keys(before), ...Object.keys(after)])]
          .filter(file => before[file] !== after[file]);
        evidence.unexpectedSourceChanges = evidence.sourceChangedDuringBuild.filter(file => !transientPaths.includes(file));
        evidence.sourceManifestSha256 = sha256(join(output, "source-after.json"));
      } catch (error) {
        evidence.cleanupErrors = [...(evidence.cleanupErrors ?? []), `Could not create post-cleanup source manifest: ${error.message}`];
      }
    }

    if (launchError) throw launchError;
    if (evidence.cleanupErrors?.length) throw new Error("Transient source cleanup failed; inspect result.json");
    if (evidence.sourceChangedDuringBuild?.length) throw new Error("Source files changed during build and remain after cleanup");
    if (evidence.directExitCode !== 0 || !existsSync(apk)) throw new Error("Unity build failed; inspect " + log);
    const report = JSON.parse(readFileSync(join(output, "build-report.json"), "utf8"));
    if (report.result !== "Succeeded" || report.errors !== 0) throw new Error("Unity report did not confirm success");
    evidence.apkSha256 = sha256(apk);
    evidence.packageLockSha256 = sha256(join(repo, "clients/quest-unity/Packages/packages-lock.json"));
    evidence.managedManifestSha256 = sha256(join(stage, "manifest.json"));
    evidence.status = "BUILD_SUCCEEDED_HARDWARE_UNTESTED";
    console.log("Quest ARM64 APK: " + apk);
  } catch (error) {
    evidence.status = "BUILD_FAILED";
    evidence.error = error.message;
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    evidence.finishedAt = new Date().toISOString();
    try {
      if (outputReady && entry(output)?.isDirectory()) {
        assertNoSymlinkPath(join(output, "result.json"));
        writeFileSync(join(output, "result.json"), JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
      }
    } catch (error) {
      evidence.status = "BUILD_FAILED";
      evidence.error ??= error.message;
      console.error(`Could not write result manifest: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
