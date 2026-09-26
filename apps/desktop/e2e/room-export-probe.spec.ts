import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAIN } from "./helpers";

test("export modeled room for offline lighting", async () => {
  test.setTimeout(180000);
  const app = await electron.launch({ args: [MAIN, "--no-sandbox"] });
  try {
    const page = await app.firstWindow();
    page.on("pageerror", error => console.log("PAGE ERROR", error.message));
    await page.goto(`${page.url().split("?")[0]}?export-room`);
    await page.waitForFunction(() => {
      const data = (document.querySelector('[data-testid="home-scene"]') as HTMLElement)?.dataset;
      return Boolean(data?.exportReady || data?.exportError);
    }, undefined, { timeout: 120000 });
    const scene = page.getByTestId("home-scene");
    const error = await scene.getAttribute("data-export-error");
    expect(error).toBeNull();
    const base64 = await page.evaluate(() => (window as unknown as { __homeGlb: string }).__homeGlb);
    const target = path.join(os.tmpdir(), "kreoda-home-room.glb");
    fs.writeFileSync(target, Buffer.from(base64, "base64"));
    console.log("Exported", target, fs.statSync(target).size);
  } finally {
    await app.close();
  }
});
