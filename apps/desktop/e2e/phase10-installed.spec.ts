// The actual Squirrel-installed application, only on the disposable CI runner.
import { test, expect, _electron as electron } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openProject, runBar, snapOf } from "./helpers";

test("installed desktop: packaged core, project round trip and continued editing", async ({}, testInfo) => {
  test.skip(process.platform !== "win32" || process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true",
    "Installed desktop GUI is exercised only on the disposable Windows CI runner");
  test.setTimeout(120_000);
  const root = path.join(process.env.LOCALAPPDATA!, "kreoda");
  const versions = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith("app-"));
  expect(versions).toHaveLength(1);
  const executablePath = path.join(root, versions[0]!.name, "Kreoda.exe");
  expect(fs.existsSync(executablePath)).toBe(true);
  const file = path.join(os.tmpdir(), `kreoda-installed-${process.pid}-${Date.now()}.icad`);
  const app = await electron.launch({ executablePath, args: ["--no-sandbox", "--lang=en-US"] });
  const childProcess = app.process();
  let stderr = "";
  const collect = (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-200_000); };
  childProcess.stderr?.on("data", collect);
  try {
    const identity = await app.evaluate(({ app }) => ({
      packaged: app.isPackaged, executable: process.execPath,
      appPath: app.getAppPath(), resources: process.resourcesPath,
    }));
    expect(identity.packaged).toBe(true);
    expect(path.resolve(identity.executable).toLowerCase()).toBe(path.resolve(executablePath).toLowerCase());
    expect(identity.appPath.toLowerCase()).toBe(path.join(identity.resources, "app.asar").toLowerCase());
    const window = await app.firstWindow({ timeout: 30_000 });
    await window.waitForLoadState("domcontentloaded");
    await expect(window.getByTestId("home-screen")).toBeVisible({ timeout: 20_000 });
    await window.getByTestId("home-new-project").click();
    await expect(window.getByTestId("workspace-chrome")).toBeVisible();
    await expect(window.getByText(/core 0\.1\.0(?!-stub)/i)).toBeVisible({ timeout: 20_000 });
    expect(window.url()).toMatch(/^file:/);
    await expect(window.getByTestId("viewport").locator("canvas")).toBeVisible();
    const core = await window.evaluate(() => globalThis.window.kreoda.coreInfo());
    if (!Number.isInteger(core.pid) || !core.pid || core.pid <= 0) throw new Error("Installed core PID unavailable");
    const corePath = JSON.parse(execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
      `(Get-Process -Id ${core.pid} -ErrorAction Stop).Path | ConvertTo-Json -Compress`],
    { encoding: "utf8", windowsHide: true, timeout: 10_000 })) as string;
    expect(path.resolve(corePath).toLowerCase()).toBe(path.join(identity.resources, "kreoda-core.exe").toLowerCase());
    await runBar(window, "box 100 60 10");
    const saved = await snapOf(window);
    expect(saved.bodies).toHaveLength(1);
    expect(saved.bodies[0]!.volumeMm3).toBeCloseTo(60_000, 3);
    await window.evaluate(file => (window as unknown as {
      __kreoda_test: { saveIcad: (file: string) => Promise<unknown> };
    }).__kreoda_test.saveIcad(file), file);
    expect(fs.readFileSync(file).readUInt32LE(0)).toBe(0x04034b50);
    await runBar(window, "box 10 10 10");
    expect((await snapOf(window)).bodies).toHaveLength(2);
    await window.evaluate(file => (window as unknown as {
      __kreoda_test: { openIcad: (file: string) => Promise<unknown> };
    }).__kreoda_test.openIcad(file), file);
    expect((await snapOf(window)).bodies).toEqual(saved.bodies);
    await openProject(window);
    await window.getByTestId(`object-tree-${saved.bodies[0]!.id}`).click();
    await runBar(window, "set widthMm 120");
    expect((await snapOf(window)).bodies[0]!.volumeMm3).toBeCloseTo(72_000, 3);
    expect((await window.evaluate(() => globalThis.window.kreoda.coreInfo())).pid).toBe(core.pid);
    console.log(`PHASE10_INSTALLED_DESKTOP ${JSON.stringify({ ...identity, corePath,
      corePid: core.pid, reopenedEditable: true, nativeDialogsExercised: false })}`);
  } finally {
    childProcess.stderr?.off("data", collect);
    await app.close();
    await testInfo.attach("installed-sidecar-stderr", { body: Buffer.from(stderr), contentType: "text/plain" });
    fs.rmSync(file, { force: true });
  }
});
