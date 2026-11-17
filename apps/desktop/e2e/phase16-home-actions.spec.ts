import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAIN, snapOf } from "./helpers";

async function launchHome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kreoda-home-actions-"));
  const app = await electron.launch({
    executablePath: createRequire(import.meta.url)("electron") as string,
    args: [MAIN, "--no-sandbox", "--lang=en-US", `--user-data-dir=${profile}`],
  });
  const window = await app.firstWindow({ timeout: 30000 });
  await expect(window.getByTestId("home-screen")).toBeVisible({ timeout: 20000 });
  return { app, window, profile };
}

test("Home template creates an editable plate with four holes", async () => {
  const { app, window, profile } = await launchHome();
  try {
    await window.getByTestId("home-template").click();
    await expect(window.getByTestId("template-dialog")).toBeVisible({ timeout: 5000 });
    await window.getByTestId("template-plate").click();
    await expect(window.getByTestId("workspace-chrome")).toBeVisible({ timeout: 60000 });
    await expect.poll(async () => (await snapOf(window)).bodies.some(body => body.type === "HolePattern"), {
      timeout: 60000,
    }).toBe(true);
    const bodies = (await snapOf(window)).bodies;
    expect(bodies.some(body => body.type === "Box")).toBe(true);
    const pattern = bodies.find(body => body.type === "HolePattern")!;
    expect(pattern.status).not.toBe("error");
  } finally {
    await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test("Home template creates a native open-box shell", async () => {
  const { app, window, profile } = await launchHome();
  try {
    await window.getByTestId("home-template").click();
    await expect(window.getByTestId("template-dialog")).toBeVisible({ timeout: 5000 });
    await window.getByTestId("template-openBox").click();
    await expect(window.getByTestId("workspace-chrome")).toBeVisible({ timeout: 60000 });
    await expect.poll(async () => (await snapOf(window)).bodies.some(body => body.type === "Shell"), {
      timeout: 60000,
    }).toBe(true);
    const shell = (await snapOf(window)).bodies.find(body => body.type === "Shell")!;
    expect(shell.status).not.toBe("error");
    expect(shell.volumeMm3).toBeGreaterThan(0);
    expect(shell.volumeMm3).toBeLessThan(80 * 60 * 30);
  } finally {
    await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test("Home settings switches the interface language", async () => {
  const { app, window, profile } = await launchHome();
  try {
    await window.getByTestId("home-nav-impostazioni").click();
    const dialog = window.getByTestId("settings-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText("Settings", { exact: true })).toBeVisible();
    await window.getByTestId("settings-language").selectOption("it");
    await expect(dialog.getByText("Impostazioni", { exact: true })).toBeVisible();
    await window.getByTestId("settings-language").selectOption("en");
    await expect(dialog.getByText("Settings", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
  } finally {
    await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test("Home Progetti opens the workspace project drawer", async () => {
  const { app, window, profile } = await launchHome();
  try {
    await window.getByTestId("home-nav-progetti").click();
    await expect(window.getByTestId("workspace-chrome")).toBeVisible({ timeout: 20000 });
    await expect(window.getByTestId("project-drawer")).toBeVisible({ timeout: 5000 });
  } finally {
    await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
