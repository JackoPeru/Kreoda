import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const option = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const editor = option("--unity") ?? process.env.UNITY_EDITOR;
const sdk = option("--sdk") ?? process.env.ANDROID_SDK_ROOT;
const output = option("--output");
if (!editor || !sdk || !output || ![editor, sdk, output].every(isAbsolute) ||
    !existsSync(editor) || !existsSync(sdk) || existsSync(output)) {
  console.error("Usage: node scripts/build-quest-client.mjs --unity <Editor.exe> --sdk <Android SDK> --output <new absolute directory>");
  process.exit(1);
}
mkdirSync(output, { recursive: true });
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
function run(program, args, log, env = process.env) {
  const fd = openSync(log, "w");
  try {
    const result = spawnSync(program, args, { cwd: repo, windowsHide: true, env, stdio: ["ignore", fd, fd] });
    if (result.error) throw result.error;
    return result.status;
  } finally { closeSync(fd); }
}
const evidence = { startedAt: new Date().toISOString(), unity: editor, sdk, directExitCode: null };
function sources() {
  const files = spawnSync("git", ["ls-files", "-c", "-o", "--exclude-standard", "-z"], { cwd: repo, encoding: "utf8", windowsHide: true });
  if (files.status !== 0) throw new Error("Cannot enumerate build inputs");
  return Object.fromEntries(files.stdout.split("\0").filter(Boolean).sort().map(file => [file, sha256(join(repo, file))]));
}
try {
  const stage = join(output, "managed");
  const stageExit = run(process.execPath, [join(repo, "scripts/build-quest-managed.mjs"), "--output", stage], join(output, "managed.log"));
  if (stageExit !== 0) throw new Error("Managed staging failed: " + stageExit);
  const plugins = join(repo, "clients/quest-unity/Assets/Plugins/Kreoda.Managed");
  mkdirSync(plugins, { recursive: true });
  for (const file of readdirSync(stage)) copyFileSync(join(stage, file), join(plugins, file));
  const apk = join(output, "KreodaQuest.apk");
  const log = join(output, "unity-build.log");
  const args = ["-batchmode", "-nographics", "-buildTarget", "Android", "-projectPath",
    join(repo, "clients/quest-unity"), "-executeMethod", "Kreoda.QuestEditor.QuestBuild.Build", "-quit", "-logFile", log];
  // Direct Editor child: wait for its exit, without waiting on licensing descendants.
  const started = Date.now();
  const before = sources();
  writeFileSync(join(output, "source-before.json"), JSON.stringify(before, null, 2) + "\n");
  evidence.directExitCode = run(editor, args, join(output, "unity-launcher.log"), { ...process.env,
    KREODA_ANDROID_SDK: sdk, KREODA_APK_PATH: apk, KREODA_BUILD_REPORT: join(output, "build-report.json") });
  evidence.elapsedSeconds = (Date.now() - started) / 1000;
  const after = sources();
  writeFileSync(join(output, "source-after.json"), JSON.stringify(after, null, 2) + "\n");
  evidence.sourceChangedDuringBuild = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(file => before[file] !== after[file]);
  evidence.sourceManifestSha256 = sha256(join(output, "source-after.json"));
  evidence.logSha256 = sha256(log);
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
  writeFileSync(join(output, "result.json"), JSON.stringify(evidence, null, 2) + "\n");
}
