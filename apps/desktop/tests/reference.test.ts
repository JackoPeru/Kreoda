// Reference calibration math (§29 Stage A).
import { describe, expect, it } from "vitest";
import { calibrateSize } from "../src/reference/store";

describe("calibrateSize", () => {
  it("maps pixel distance to real size", () => {
    // 200×100 px image, clicks 50 px apart = 25 mm.
    const s = calibrateSize(200, 100, [10, 10], [60, 10], 25);
    expect(s.mmPerPx).toBeCloseTo(0.5, 9);
    expect(s.widthMm).toBeCloseTo(100, 9);
    expect(s.heightMm).toBeCloseTo(50, 9);
  });

  it("rejects degenerate input honestly", () => {
    expect(() => calibrateSize(200, 100, [5, 5], [5, 5], 25)).toThrow(
      /distinct/,
    );
    expect(() => calibrateSize(200, 100, [0, 0], [10, 0], 0)).toThrow(
      /positive/,
    );
    expect(() => calibrateSize(200, 100, [0, 0], [10, 0], -3)).toThrow();
    expect(() =>
      calibrateSize(200, 100, [0, 0], [NaN, 0], 25),
    ).toThrow();
  });
});
