import { test, expect, _electron as electron } from "@playwright/test";
import { MAIN } from "./helpers";

// Offline lighting export belonged to the retired HomeScene3D diagnostic.
// Current CAD export coverage remains in phase8-*; this checks video failure.
test("home video failure keeps a loadable poster and usable project controls", async () => {
  const app = await electron.launch({ args: [MAIN, "--no-sandbox"] });
  try {
    const page = await app.firstWindow();
    const home = page.getByTestId("home-screen");
    const video = page.getByTestId("home-background-video");
    await expect(video).toBeVisible();
    const poster = await video.getAttribute("poster");
    expect(poster).toMatch(/reference-home-poster\.png$/);
    expect(await video.evaluate(async element => {
      const image = new Image();
      image.src = (element as HTMLVideoElement).poster;
      await image.decode();
      return image.naturalWidth > 0 && image.naturalHeight > 0;
    })).toBe(true);
    // Load an actually missing file so Chromium emits a real media error.
    await video.evaluate(element => {
      const media = element as HTMLVideoElement;
      media.src = new URL("missing-reference-video.mp4", media.src).href;
      media.load();
    });
    await expect(home).toHaveAttribute("data-video-error", "true");
    await expect(video).toHaveJSProperty("paused", true);
    await expect(video).toHaveJSProperty("autoplay", false);
    await expect(video).toHaveAttribute("poster", poster!);
    await expect(page.locator(".home-scene, [data-testid='home-scene'], canvas")).toHaveCount(0);
    await page.getByTestId("home-new-project").click();
    await expect(page.getByTestId("viewport")).toBeVisible();
  } finally {
    await app.close();
  }
});
