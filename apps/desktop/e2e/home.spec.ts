import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { MAIN } from "./helpers";

const screenshots = path.join(import.meta.dirname, "..", "test-results", "home-visual-qa");

test("home uses the supplied video and keeps accessible responsive controls", async () => {
  test.slow();
  fs.mkdirSync(screenshots, { recursive: true });
  const app = await electron.launch({ args: [MAIN, "--no-sandbox", "--lang=en-US"] });
  try {
    const window = await app.firstWindow({ timeout: 30000 });
    await window.waitForLoadState("domcontentloaded");
    await window.setViewportSize({ width: 1536, height: 1024 });
    await expect(window.getByTestId("home-screen")).toBeVisible({ timeout: 20000 });
    for (const id of ["home-topbar", "home-recent", "home-hero", "home-quickstart", "home-tasks", "home-orbit"]) {
      await expect(window.getByTestId(id)).toBeVisible();
    }
    await expect(window.getByTestId("home-new-project")).toBeVisible();
    await expect(window.getByTestId("home-reference")).toHaveCount(0);
    await expect(window.locator('img[src*="kreoda-home.png"]')).toHaveCount(0);

    const mappedLandmarks = {
      "home-recent": [170, 210, 330, 425],
      "home-quickstart": [1037, 220, 345, 365],
      "home-orbit": [505, 645, 530, 220],
      "home-quote": [27, 853, 317, 135],
      "home-tasks": [1130, 786, 380, 190],
    } as const;
    const captureMappedViewport = async (width: number, height: number, name: string) => {
      await window.setViewportSize({ width, height });
      await expect(window.getByTestId("home-screen")).toBeVisible();
      await window.screenshot({ path: path.join(screenshots, name), timeout: 60000 });
      const scale = height / 1024;
      const left = (width - 1536 * scale) / 2;
      const bounds = await window.evaluate((ids) => Object.fromEntries(ids.map(id => {
        const element = document.querySelector(`[data-testid="${id}"]`);
        return [id, element ? element.getBoundingClientRect().toJSON() : null];
      })), Object.keys(mappedLandmarks));
      for (const [id, [x, y, boxWidth, boxHeight]] of Object.entries(mappedLandmarks)) {
        const box = bounds[id];
        expect(box).not.toBeNull();
        expect(Math.abs(box!.x - (left + x * scale))).toBeLessThan(8);
        expect(Math.abs(box!.y - y * scale)).toBeLessThan(8);
        expect(Math.abs(box!.width - boxWidth * scale)).toBeLessThan(12);
        expect(Math.abs(box!.height - boxHeight * scale)).toBeLessThan(14);
      }
    };
    await captureMappedViewport(1920, 1080, "home-1920x1080.png");
    await captureMappedViewport(1280, 720, "home-1280x720.png");
    await window.setViewportSize({ width: 1536, height: 1024 });

    const video = window.getByTestId("home-background-video");
    await expect(video).toHaveAttribute("src", /home\/assets\/reference-home\.mp4$/);
    await expect(video).toHaveAttribute("poster", /home\/assets\/reference-home-poster\.png$/);
    await expect(video).toHaveJSProperty("muted", true);
    await expect(video).toHaveJSProperty("loop", true);
    await expect(video).toHaveJSProperty("playsInline", true);
    await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
    await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
    await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).videoHeight)).toBeGreaterThan(0);
    await expect.poll(() => video.evaluate(element => {
      const media = element as HTMLVideoElement;
      return !media.paused && media.currentTime > 0;
    })).toBe(true);
    expect(await video.evaluate(element => getComputedStyle(element).objectFit)).toBe("cover");
    await expect(window.locator(".home-scene, [data-testid='home-scene'], canvas")).toHaveCount(0);
    await window.screenshot({ path: path.join(screenshots, "home-video.png"), timeout: 60000 });

    await window.setViewportSize({ width: 1280, height: 800 });
    await expect(window.getByTestId("home-screen")).toBeVisible();
    const responsive = await window.screenshot({ path: path.join(screenshots, "home-1280.png"), timeout: 60000 });
    expect(responsive.byteLength).toBeGreaterThan(100_000);
    const newProjectBox = await window.getByTestId("home-new-project").boundingBox();
    expect(newProjectBox).not.toBeNull();
    expect(newProjectBox!.x).toBeGreaterThanOrEqual(0);
    expect(newProjectBox!.y).toBeGreaterThanOrEqual(0);
    expect(newProjectBox!.x + newProjectBox!.width).toBeLessThanOrEqual(1280);
    expect(newProjectBox!.y + newProjectBox!.height).toBeLessThanOrEqual(800);

    await window.setViewportSize({ width: 390, height: 844 });
    await expect(window.getByTestId("home-screen")).toBeVisible();
    expect(await window.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(392);
    await window.getByTestId("home-new-project").scrollIntoViewIfNeeded();
    await expect(window.getByTestId("home-new-project")).toBeVisible();

    await window.setViewportSize({ width: 1536, height: 1024 });
    const recent = window.getByRole("button", { name: "Apri progetto Cucina Villa Costa" });
    await recent.focus();
    await window.keyboard.press("Enter");
    await expect(window.getByTestId("home-screen")).toHaveCount(0);
    await window.getByTestId("back-home").click();
    await expect(window.getByTestId("home-screen")).toBeVisible();
    await window.getByTestId("home-new-project").click();
    await expect(window.getByTestId("home-screen")).toHaveCount(0);
    await window.getByTestId("back-home").click();

    await window.emulateMedia({ reducedMotion: "reduce" });
    await window.reload();
    await expect(window.getByTestId("home-screen")).toBeVisible();
    const reducedVideo = window.getByTestId("home-background-video");
    await expect(reducedVideo).toHaveAttribute("data-reduced-motion", "true");
    await expect(reducedVideo).toHaveAttribute("poster", /reference-home-poster\.png$/);
    await expect.poll(() => reducedVideo.evaluate(element => (element as HTMLVideoElement).paused)).toBe(true);
    const reducedTime = await reducedVideo.evaluate(element => (element as HTMLVideoElement).currentTime);
    await window.waitForTimeout(500);
    expect(await reducedVideo.evaluate(element => (element as HTMLVideoElement).currentTime)).toBe(reducedTime);
    await reducedVideo.evaluate(element => element.dispatchEvent(new Event("error")));
    await expect(window.getByTestId("home-screen")).toHaveAttribute("data-video-error", "true");
    await expect(reducedVideo).toHaveAttribute("poster", /reference-home-poster\.png$/);
    await expect(window.getByTestId("home-new-project")).toBeVisible();
    console.log(`Home screenshots: ${path.join(screenshots, "home-1920x1080.png")}; ${path.join(screenshots, "home-1280x720.png")}`);
  } finally {
    await app.close();
  }
});
