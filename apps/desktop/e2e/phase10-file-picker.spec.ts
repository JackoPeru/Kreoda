// Actual Windows common-item dialogs on the hosted runner; never a local GUI.
import { test, expect, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, openProject, runBar, snapOf } from "./helpers";

const execute = promisify(execFile);
function nativePicker(pid: number, kind: "Save" | "Open", action: "Accept" | "Cancel", file: string) {
  return execute("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-File",
    path.join(import.meta.dirname, "native-file-dialog.ps1"),
    "-TargetProcessId", String(pid), "-Kind", kind, "-Action", action, "-FilePath", file],
  { windowsHide: true, timeout: 50_000 });
}
async function openPicker(window: Page) {
  await window.getByRole("button", { name: "More", exact: true }).click();
  await window.getByRole("button", { name: "Open", exact: true }).click();
}

test("native file pickers: Save/Open cancellation and editable project round trip", async () => {
  test.skip(process.platform !== "win32" || process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true",
    "Native dialogs are exercised only on the disposable Windows CI runner");
  test.setTimeout(180_000);
  const { app, window } = await boot();
  const file = path.join(os.tmpdir(), `kreoda-native-picker-${process.pid}-${Date.now()}.icad`);
  const rows: unknown[] = [];
  try {
    const pid = await app.evaluate(() => process.pid);
    await runBar(window, "box 100 60 10");
    const saved = await snapOf(window);
    const save = () => window.getByTestId("workspace-actions").getByRole("button", { name: "Save", exact: true }).click();
    const pick = async (kind: "Save" | "Open", action: "Accept" | "Cancel", click: () => Promise<unknown>) => {
      const [result] = await Promise.all([nativePicker(pid, kind, action, file), click()]);
      rows.push(JSON.parse(result.stdout));
    };
    await pick("Save", "Cancel", save);
    expect(fs.existsSync(file)).toBe(false);
    expect((await snapOf(window)).bodies).toEqual(saved.bodies);
    await pick("Save", "Accept", save);
    await expect.poll(() => fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file).readUInt32LE(0)).toBe(0x04034b50);
    await runBar(window, "box 10 10 10");
    const changed = await snapOf(window);
    expect(changed.bodies).toHaveLength(2);
    await pick("Open", "Cancel", () => openPicker(window));
    expect((await snapOf(window)).bodies).toEqual(changed.bodies);
    await pick("Open", "Accept", () => openPicker(window));
    await expect.poll(async () => (await snapOf(window)).bodies.length).toBe(1);
    expect((await snapOf(window)).bodies).toEqual(saved.bodies);
    await openProject(window);
    await window.getByTestId(`object-tree-${saved.bodies[0]!.id}`).click();
    await runBar(window, "set widthMm 120");
    expect((await snapOf(window)).bodies[0]!.volumeMm3).toBeCloseTo(72000, 3);
    await expect(window.getByTestId("workspace-actions").getByRole("alert")).toHaveCount(0);
    console.log(`PHASE10_NATIVE_PICKER ${JSON.stringify({ dialogs: rows, reopenedEditable: true })}`);
  } finally {
    await app.close();
    fs.rmSync(file, { force: true });
  }
});
