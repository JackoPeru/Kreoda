import { describe, expect, it } from "vitest";
import {
  createSectionPlane,
  isSectionPlane,
  isVisibleAtSection,
  signedDistanceMm,
} from "../src/section/plane";

describe("section plane CAD millimetre math", () => {
  it.each([
    { axis: "X", normal: [1, 0, 0] as const, point: [14, 5, 9] as const },
    { axis: "Y", normal: [0, 1, 0] as const, point: [5, 14, 9] as const },
    { axis: "Z", normal: [0, 0, 1] as const, point: [5, 9, 14] as const },
  ])("uses $axis axis and signed quota", ({ normal, point }) => {
    const plane = createSectionPlane(normal, 10);
    expect(plane).not.toBeNull();
    expect(signedDistanceMm(point, plane!)).toBe(4);
    expect(isVisibleAtSection(point, plane!)).toBe(true);
    expect(isVisibleAtSection([5, 9, 9], plane!)).toBe(false);
  });

  it("inverts the kept side without changing the plane quota", () => {
    const plane = createSectionPlane([1, 0, 0], -25, true);
    expect(plane).not.toBeNull();
    expect(signedDistanceMm([-27, 0, 0], plane!)).toBe(2);
    expect(isVisibleAtSection([-27, 0, 0], plane!)).toBe(true);
    expect(isVisibleAtSection([-23, 0, 0], plane!)).toBe(false);
  });

  it("keeps the plane boundary within the documented picking tolerance", () => {
    const plane = createSectionPlane([0, 0, 1], 0);
    expect(plane).not.toBeNull();
    expect(isVisibleAtSection([0, 0, -1e-6], plane!)).toBe(true);
    expect(isVisibleAtSection([0, 0, -1.01e-6], plane!)).toBe(false);
  });

  it("accepts negative quotas and rejects malformed or out-of-range planes", () => {
    expect(createSectionPlane([0, 1, 0], -125.5)).toMatchObject({ offsetMm: -125.5 });
    expect(createSectionPlane([0, 0, 0], 0)).toBeNull();
    expect(createSectionPlane([2, 0, 0], 0)).toBeNull();
    expect(createSectionPlane([0, 0, 1], Number.NaN)).toBeNull();
    expect(createSectionPlane([0, 0, 1], Number.POSITIVE_INFINITY)).toBeNull();
    expect(createSectionPlane([0, 0, 1], 1_000_000.01)).toBeNull();
    expect(isSectionPlane({ normal: [0, 0, 1], offsetMm: -1, inverted: "no" })).toBe(false);
  });
});
