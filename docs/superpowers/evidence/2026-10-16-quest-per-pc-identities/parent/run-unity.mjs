import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const qa = "C:/Users/matte/Documents/Codex-tools/Native/quest-per-pc-parent-20261017";
const name = process.argv[2], filter = process.argv[3];
const args = ["-batchmode", "-nographics", "-buildTarget", "Android", "-projectPath",
  "C:/Users/matte/Desktop/Saas/Kreoda-phase10-ci/clients/quest-unity", "-runTests", "-testPlatform", "EditMode",
  "-testResults", `${qa}/${name}.xml`, "-logFile", `${qa}/${name}.log`];
if (filter) args.push("-testFilter", filter);
const result = spawnSync("C:/Users/matte/Documents/Codex-tools/Unity/Editors/6000.3.25f1/Editor/Unity.exe", args,
  { windowsHide: true, stdio: "ignore" });
writeFileSync(`${qa}/${name}-exit.json`, JSON.stringify({ exitCode: result.status, error: result.error?.message, args }, null, 2));
console.log(JSON.stringify({ name, exitCode: result.status, error: result.error?.message }));
process.exitCode = result.status ?? 1;
