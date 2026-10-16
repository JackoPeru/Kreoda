import { spawnSync } from "node:child_process";
import { join } from "node:path";

const [unity, project, evidence, filter, name] = process.argv.slice(2);
if (!unity || !project || !evidence || !filter || !name) throw new Error("usage: node run-editor-tests.mjs UNITY PROJECT EVIDENCE FILTER NAME");
const args = ["-batchmode", "-nographics", "-buildTarget", "Android", "-projectPath", project,
  "-runTests", "-testPlatform", "EditMode", "-testFilter", filter,
  "-testResults", join(evidence, name + ".xml"), "-logFile", join(evidence, name + ".log")];
const result = spawnSync(unity, args, { cwd: project, windowsHide: true, stdio: "inherit" });
if (result.error) throw result.error;
console.log(`Unity exit: ${result.status}`);
process.exitCode = result.status ?? 1;
