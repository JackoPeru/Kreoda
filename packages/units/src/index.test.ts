import { describe, expect, it } from "vitest";
import { fromMm, parseLengthToMm, toMm } from "./index.js";

describe("units (§43)", () => {
  it("converts display units to canonical mm", () => {
    expect(toMm(1, "inch")).toBeCloseTo(25.4, 10);
    expect(toMm(2.5, "cm")).toBe(25);
    expect(fromMm(1000, "m")).toBe(1);
  });

  it("parses dimension input explicitly (never locale-inferred)", () => {
    expect(parseLengthToMm("125")).toBe(125);
    expect(parseLengthToMm("12.5 cm")).toBe(125);
    expect(parseLengthToMm("2 in")).toBeCloseTo(50.8, 10);
    expect(() => parseLengthToMm("abc")).toThrow();
  });
});
