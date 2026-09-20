// Bounded pool contract (Phase 8 large-model slice).
import { describe, expect, it } from "vitest";
import { mapPool } from "../src/model/pool";

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("mapPool", () => {
  it("preserves input order under random delays", async () => {
    const items = [5, 3, 8, 1, 9, 2, 7, 4, 6, 0];
    const out = await mapPool(items, 4, async (v) => {
      await new Promise((r) => setTimeout(r, Math.random() * 5));
      return v * 2;
    });
    expect(out).toEqual(items.map((v) => v * 2));
  });

  it("caps in-flight work and handles empty input", async () => {
    expect(await mapPool([], 4, async (v: number) => v)).toEqual([]);
    let live = 0;
    let peak = 0;
    await mapPool([1, 2, 3, 4, 5, 6], 2, async () => {
      live++;
      peak = Math.max(peak, live);
      await tick();
      live--;
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(1);
  });

  it("first rejection wins with the original error", async () => {
    const boom = new Error("mesh failed");
    await expect(
      mapPool([1, 2, 3], 3, async (v) => {
        await tick();
        if (v === 2) throw boom;
        return v;
      }),
    ).rejects.toBe(boom);
  });
});
