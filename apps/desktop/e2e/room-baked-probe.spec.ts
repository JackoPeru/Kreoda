import { test, expect, _electron as electron } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { MAIN } from "./helpers";

test("inspect Cycles room with moving K", async () => {
  const app = await electron.launch({ args: [MAIN, "--no-sandbox"] });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${page.url().split("?")[0]}?room-baked-probe`);
    await expect(page.getByTestId("home-scene")).toHaveAttribute("data-room-baked", "ready", { timeout: 30000 });
    await expect(page.getByTestId("home-scene")).toHaveAttribute("data-baked-k", "video", { timeout: 30000 });
    await page.mouse.move(1900, 1050);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(os.tmpdir(), "kreoda-room-baked-probe.png") });
  } finally {
    await app.close();
  }
});
