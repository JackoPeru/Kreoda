import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const qa = "C:/Users/matte/Documents/Codex-tools/Native/quest-autoconnect-parent-20261016";
const source = join(qa, "pc-frozen-70e3550");
const require = createRequire(join(source, "apps/desktop/package.json"));
const { _electron } = require("playwright");
const { frameMessage, PROTOCOL_VERSION, CommandType } = await import(pathToFileURL(join(source, "packages/protocol/dist/index.js")).href);
const executable = join(source, "apps/desktop/out/Kreoda-win32-x64/Kreoda.exe");
const profile = mkdtempSync(join(qa, "packaged-smoke-profile-"));
let app;
try {
  app = await _electron.launch({ executablePath: executable,
    args: ["--no-sandbox", "--lang=en-US", "--user-data-dir=" + profile],
    env: { ...process.env, KREODA_BACKGROUND_TEST: "1", KREODA_AUTOMATIC_LOOPBACK_TEST: "1",
      KREODA_SESSION_PORT: "", KREODA_SESSION_TOKEN: "", KREODA_RECOVERY_DIR: profile },
  });
  const page = await app.firstWindow();
  const windows = await app.evaluate(({ BrowserWindow, app }) => {
    const items = BrowserWindow.getAllWindows();
    for (const window of items) window.webContents.setBackgroundThrottling(false);
    return { visible: items.some(window => window.isVisible()), count: items.length, userData: app.getPath("userData") };
  });
  if (windows.visible || !windows.count || windows.userData.toLowerCase().replaceAll("\\", "/") !== profile.toLowerCase().replaceAll("\\", "/"))
    throw new Error("packaged hidden-profile isolation failed: " + JSON.stringify(windows));
  await page.getByTestId("home-screen").waitFor({ state: "visible", timeout: 20000 });
  await page.getByTestId("home-new-project").click();
  await page.getByTestId("workspace-chrome").waitFor({ state: "visible", timeout: 20000 });
  await page.getByText(/core 0\.1\.0/).waitFor({ timeout: 20000 });
  async function native(type, fields = {}) {
    const frame = frameMessage(Buffer.from(JSON.stringify({ protocolVersion: PROTOCOL_VERSION,
      requestId: "packaged-" + type, documentId: "doc-phase1", type, ...fields })));
    const raw = await page.evaluate(payload => window.kreoda.invoke(payload), Buffer.from(frame).toString("base64"));
    const result = JSON.parse(Buffer.from(raw, "base64").toString());
    if (result.status !== "ok") throw new Error("packaged native command failed: " + JSON.stringify(result));
    return result;
  }
  const core = await native(CommandType.GetCoreInfo);
  if (core.occtVersion !== "8.0.1-native") throw new Error("actual packaged OCCT runtime missing");
  await native(CommandType.CreateBox, { featureId: "automatic-box", widthMm: 10, heightMm: 10, depthMm: 10 });
  const probe = spawn("dotnet", ["C:/Users/matte/Desktop/Saas/Kreoda-phase10-ci/clients/session-dotnet/probes/Kreoda.McpProbe/bin/Release/net8.0/Kreoda.McpProbe.dll"],
    { windowsHide: true, env: { ...process.env, KREODA_MCP_PROBE_SCENARIO: "automatic-local-connection" } });
  let stdout = "", stderr = "";
  probe.stdout.on("data", chunk => { stdout += String(chunk); });probe.stderr.on("data", chunk => { stderr += String(chunk); });
  const code = await new Promise((resolve, reject) => { probe.once("error", reject);probe.once("exit", resolve); });
  if (code !== 0) throw new Error("actual managed packaged auto-connect failed: " + stderr);
  const proof = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
  if (proof.manualInputs !== 0 || !proof.verifiedIdentity || proof.features !== 1) throw new Error("incomplete packaged proof");
  writeFileSync(join(qa, "packaged-smoke-proof.json"), JSON.stringify({ sourceHead: "70e355084807e7223000825ddca6c6390ed879a4",
    executable, executableSha256: createHash("sha256").update(readFileSync(executable)).digest("hex"), windows,
    occtVersion: core.occtVersion, ...proof }, null, 2) + "\n");
  console.log("PACKAGED_HIDDEN_AUTOMATIC_CONNECTION_PASSED");
} finally { await app?.close(); }
