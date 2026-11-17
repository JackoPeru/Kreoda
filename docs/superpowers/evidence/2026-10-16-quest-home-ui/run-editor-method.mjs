import { spawnSync } from "node:child_process";
import { join } from "node:path";
const [unity, project, evidence, method, name] = process.argv.slice(2);
if (!unity || !project || !evidence || !method || !name) throw new Error("usage: node run-editor-method.mjs UNITY PROJECT EVIDENCE METHOD NAME");
const args = ["-batchmode", "-buildTarget", "Android", "-projectPath", project,
  "-executeMethod", method, "-quit", "-logFile", join(evidence, name + ".log")];
const result = spawnSync(unity, args, { cwd: project, windowsHide: true, stdio: "inherit" });
if (result.error) throw result.error;
console.log(`Unity exit: ${result.status}`);
process.exitCode = result.status ?? 1;
