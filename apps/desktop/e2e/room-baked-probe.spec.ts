import { test, expect, _electron as electron } from "@playwright/test";
import { MAIN } from "./helpers";

// The former baked-room diagnostic now verifies the active video policy.
test("home video follows reduced motion and resumes playback when motion is allowed", async () => {
  const app = await electron.launch({ args: [MAIN, "--no-sandbox"] });
  try {
    const page = await app.firstWindow();
    const video = page.getByTestId("home-background-video");
    await expect(video).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(video).toHaveAttribute("data-reduced-motion", "true");
    await expect(video).toHaveJSProperty("paused", true);
    await expect(video).toHaveJSProperty("autoplay", false);
    const stoppedTime = await video.evaluate(element => (element as HTMLVideoElement).currentTime);
    await page.evaluate(() => new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBe(stoppedTime);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(video).toHaveAttribute("data-reduced-motion", "false");
    await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(stoppedTime);
    await expect(video).toHaveJSProperty("paused", false);
    await expect(page.locator(".home-scene, [data-testid='home-scene'], canvas")).toHaveCount(0);
  } finally {
    if (!app.process().killed) {
      const page = app.windows()[0];
      if (page && !page.isClosed()) console.log("HOME_MOTION_STATE", await page.evaluate(() => {
        const video = document.querySelector<HTMLVideoElement>('video');
        return { error: document.querySelector('[data-testid="home-screen"]')?.getAttribute('data-video-error'),
          reduced: video?.dataset.reducedMotion, paused: video?.paused,
          ready: video?.readyState, mediaError: video?.error?.code, time: video?.currentTime };
      }));
    }
    await app.close();
  }
});
