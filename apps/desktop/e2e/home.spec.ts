import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAIN } from "./helpers";

const screenshots = path.join(os.tmpdir(), "kreoda-home-visual-qa");
const difference = async (
  window: import("@playwright/test").Page,
  first: Buffer,
  second: Buffer,
  boxes: Record<string, { left: number; top: number; right: number; bottom: number }>,
) => window.evaluate(async ({ a, b, boxes }) => {
  const decode = async (base64: string): Promise<HTMLImageElement> => {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not decode screenshot"));
      image.src = `data:image/png;base64,${base64}`;
    });
    return image;
  };
  const [one, two] = await Promise.all([decode(a), decode(b)]);
  const canvas = document.createElement("canvas");
  canvas.width = one.width;
  canvas.height = one.height;
  const context = canvas.getContext("2d")!;
  context.drawImage(one, 0, 0);
  const firstPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(two, 0, 0);
  const secondPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  return Object.fromEntries(Object.entries(boxes).map(([name, box]) => {
    let difference = 0;
    let changed = 0;
    let count = 0;
    for (let y = box.top; y < box.bottom; y += 2) {
      for (let x = box.left; x < box.right; x += 2) {
        const i = (y * canvas.width + x) * 4;
        const delta = Math.abs(firstPixels[i] - secondPixels[i]) +
          Math.abs(firstPixels[i + 1] - secondPixels[i + 1]) +
          Math.abs(firstPixels[i + 2] - secondPixels[i + 2]);
        difference += delta;
        if (delta >= 36) changed++;
        count++;
      }
    }
    return [name, { mean: difference / (count * 3), changedFraction: changed / count }];
  }));
}, { a: first.toString("base64"), b: second.toString("base64"), boxes });

test("home renders a real 3D studio with accessible responsive controls", async () => {
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
      await window.screenshot({ path: path.join(screenshots, name) });
      const scale = height / 1024;
      const left = (width - 1536 * scale) / 2;
      for (const [id, [x, y, boxWidth, boxHeight]] of Object.entries(mappedLandmarks)) {
        const box = await window.getByTestId(id).boundingBox();
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

    const scene = window.getByTestId("home-scene");
    await expect(scene).toHaveAttribute("data-scene-ready", "true");
    await expect(scene).toHaveAttribute("data-baked-k", "video", { timeout: 20000 });
    await expect(scene.locator("canvas")).toHaveCount(1);
    await expect(scene).not.toHaveAttribute("data-webgl", "unavailable");

    const resting = await window.screenshot({ path: path.join(screenshots, "home-1536.png") });
    await window.waitForTimeout(2400);
    const animated = await window.screenshot({ path: path.join(screenshots, "home-animated.png") });
    const motion = await difference(window, resting, animated, {
      room: { left: 400, top: 95, right: 1120, bottom: 180 },
      letter: { left: 615, top: 250, right: 925, bottom: 505 },
      plant: { left: 0, top: 370, right: 180, bottom: 670 },
    });
    expect(motion.room.mean).toBeLessThan(0.12);
    expect(motion.letter.mean).toBeGreaterThan(0.12);
    expect(motion.plant.changedFraction).toBeGreaterThan(0.0005);

    await window.mouse.move(20, 145);
    const pointerAway = await window.screenshot();
    await window.mouse.move(768, 605);
    await window.waitForTimeout(120);
    const pointerNear = await window.screenshot({ path: path.join(screenshots, "home-glow.png") });
    const pointerMotion = await difference(window, pointerAway, pointerNear, {
      room: { left: 400, top: 95, right: 1120, bottom: 180 },
      glow: { left: 590, top: 525, right: 950, bottom: 675 },
    });
    console.log(`Pointer ROI: room ${pointerMotion.room.mean.toFixed(3)}, glow ${pointerMotion.glow.mean.toFixed(3)}`);
    expect(pointerMotion.room.mean).toBeLessThan(0.12);
    expect(pointerMotion.glow.mean).toBeGreaterThan(0.2);

    await window.setViewportSize({ width: 1280, height: 800 });
    await expect(window.getByTestId("home-screen")).toBeVisible();
    const responsive = await window.screenshot({ path: path.join(screenshots, "home-1280.png") });
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
    await expect(window.getByTestId("home-scene")).toHaveAttribute("data-scene-ready", "true");
    await expect(window.getByTestId("home-scene")).toHaveAttribute("data-motion", "reduced");
    await expect(window.getByTestId("home-scene")).toHaveAttribute("data-baked-k", "ready");
    await window.waitForTimeout(500);
    const reduced = await window.screenshot();
    await window.mouse.move(20, 145);
    await window.waitForTimeout(400);
    await window.mouse.move(768, 605);
    await window.waitForTimeout(400);
    expect((await window.screenshot()).equals(reduced)).toBe(true);

    await window.addInitScript(() => {
      const prototype = HTMLCanvasElement.prototype as unknown as {
        getContext: (kind: string, ...args: unknown[]) => unknown;
      };
      const getContext = prototype.getContext;
      prototype.getContext = function (kind, ...args) {
        if (kind.startsWith("webgl")) return null;
        return getContext.call(this, kind, ...args);
      };
    });
    await window.reload();
    await expect(window.getByTestId("home-screen")).toBeVisible();
    await expect(window.getByTestId("home-scene")).toHaveAttribute("data-webgl", "unavailable");
    await expect(window.getByTestId("home-reference")).toHaveCount(0);
    await expect(window.getByTestId("home-new-project")).toBeVisible();
    console.log(`Home screenshots: ${path.join(screenshots, "home-1920x1080.png")}; ${path.join(screenshots, "home-1280x720.png")}`);
  } finally {
    await app.close();
  }
});
