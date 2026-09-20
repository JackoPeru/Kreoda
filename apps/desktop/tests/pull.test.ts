import { describe, expect, it } from "vitest";
import { clampDimension, resolvePullTarget } from "../src/interaction/pull";

const box = { featureId: "b", type: "Box", paramsMm: [100, 50, 20] };

describe("pull mapping (§17)", () => {
  it("maps free faces to source parameters", () => {
    expect(resolvePullTarget(box, "b:box.+X")).toEqual({
      ok: true,
      target: { featureId: "b", faceId: "b:box.+X", paramName: "widthMm", startValueMm: 100 },
    });
    expect(resolvePullTarget(box, "b:box.+Z")).toMatchObject({
      ok: true,
    });
  });

  it("refuses anchored faces with a reason, never a wrong edit", () => {
    const r = resolvePullTarget(box, "b:box.-X");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/anchored/);
  });

  it("clamps dimensions to kernel range", () => {
    expect(clampDimension(-5)).toBe(0.1);
    expect(clampDimension(1e9)).toBe(100000);
    expect(clampDimension(42.5)).toBe(42.5);
  });
});
