import { describe, expect, it } from "vitest";
import { SketchModelSchema } from "@kreoda/protocol";
import { detectReferenceGeometry, type RgbaImage } from "../src/reference/detect";
import { buildReferenceSketch, pixelToSketchMm } from "../src/reference/propose";

function blank(width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 255;
    data[i * 4 + 1] = 255;
    data[i * 4 + 2] = 255;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function black(image: RgbaImage, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const i = (y * image.width + x) * 4;
  image.data[i] = 0;
  image.data[i + 1] = 0;
  image.data[i + 2] = 0;
}

function line(image: RgbaImage, x1: number, y1: number, x2: number, y2: number, thickness = 3): void {
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const x = Math.round(x1 + (x2 - x1) * t);
    const y = Math.round(y1 + (y2 - y1) * t);
    for (let dy = -Math.floor(thickness / 2); dy <= Math.floor(thickness / 2); dy++) {
      for (let dx = -Math.floor(thickness / 2); dx <= Math.floor(thickness / 2); dx++) {
        black(image, x + dx, y + dy);
      }
    }
  }
}

function circle(image: RgbaImage, cx: number, cy: number, r: number, thickness = 3): void {
  const steps = Math.ceil(2 * Math.PI * r * 2);
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const x = Math.round(cx + r * Math.cos(angle));
    const y = Math.round(cy + r * Math.sin(angle));
    for (let dy = -Math.floor(thickness / 2); dy <= Math.floor(thickness / 2); dy++) {
      for (let dx = -Math.floor(thickness / 2); dx <= Math.floor(thickness / 2); dx++) {
        black(image, x + dx, y + dy);
      }
    }
  }
}

function sample(): RgbaImage {
  const image = blank(200, 120);
  line(image, 20, 40, 180, 40);
  line(image, 100, 20, 100, 100);
  circle(image, 150, 70, 20);
  return image;
}

describe("reference image detection (Stage B)", () => {
  it("finds straight lines and a circle in a clean image", () => {
    const result = detectReferenceGeometry(sample());
    expect(result.width).toBe(200);
    expect(result.height).toBe(120);
    expect(result.lines.length).toBeGreaterThanOrEqual(2);
    const horizontal = result.lines.find(
      (l) =>
        Math.abs(l.y1 - 40) <= 3 &&
        Math.abs(l.y2 - 40) <= 3 &&
        Math.min(l.x1, l.x2) <= 24 &&
        Math.max(l.x1, l.x2) >= 176,
    );
    const vertical = result.lines.find(
      (l) =>
        Math.abs(l.x1 - 100) <= 3 &&
        Math.abs(l.x2 - 100) <= 3 &&
        Math.min(l.y1, l.y2) <= 24 &&
        Math.max(l.y1, l.y2) >= 96,
    );
    expect(horizontal).toBeTruthy();
    expect(vertical).toBeTruthy();
    const detectedCircle = result.circles.find(
      (c) => Math.hypot(c.cx - 150, c.cy - 70) <= 4 && Math.abs(c.r - 20) <= 4,
    );
    expect(detectedCircle).toBeTruthy();
  });

  it("maps pixels to principal sketch millimetres", () => {
    const base = { imageW: 200, imageH: 120, mmPerPx: 0.5 };
    expect(pixelToSketchMm({ ...base, plane: "XY" }, 20, 40)).toEqual([10, 40]);
    expect(pixelToSketchMm({ ...base, plane: "XZ" }, 20, 40)).toEqual([10, 20]);
    expect(pixelToSketchMm({ ...base, plane: "YZ" }, 20, 40)).toEqual([60, 70]);
  });

  it("builds a valid editable sketch model from the detection", () => {
    const result = detectReferenceGeometry(sample());
    const proposal = buildReferenceSketch(
      { plane: "XY", imageW: 200, imageH: 120, mmPerPx: 0.5 },
      result,
    );
    expect(proposal.lineCount).toBeGreaterThanOrEqual(2);
    expect(proposal.circleCount).toBeGreaterThanOrEqual(1);
    const parsed = SketchModelSchema.parse(proposal.model);
    expect(parsed.lines.length).toBe(proposal.lineCount);
    expect(parsed.circles.length).toBe(proposal.circleCount);
    const pointIds = new Set(parsed.points.map((p) => p.id));
    for (const line of parsed.lines) {
      expect(pointIds.has(line.p1)).toBe(true);
      expect(pointIds.has(line.p2)).toBe(true);
    }
    for (const circle of parsed.circles) {
      expect(pointIds.has(circle.center)).toBe(true);
    }
    expect(new Set(parsed.points.map((p) => p.id)).size).toBe(parsed.points.length);
    expect(new Set(parsed.lines.map((l) => l.id)).size).toBe(parsed.lines.length);
    expect(new Set(parsed.circles.map((c) => c.id)).size).toBe(parsed.circles.length);
    const kinds = parsed.constraints.map((c) => c.kind);
    expect(kinds).toContain("horizontal");
    expect(kinds).toContain("vertical");
    expect(kinds).toContain("diameter");
    expect(new Set(parsed.constraints.map((c) => c.id)).size).toBe(parsed.constraints.length);
  });

  it("requires calibration and usable geometry", () => {
    const result = detectReferenceGeometry(sample());
    expect(() =>
      buildReferenceSketch(
        { plane: "XY", imageW: 200, imageH: 120, mmPerPx: 0 },
        result,
      ),
    ).toThrow(/Calibrate/);
    expect(() =>
      buildReferenceSketch(
        { plane: "XY", imageW: 200, imageH: 120, mmPerPx: 0.5 },
        { width: 200, height: 120, scale: 1, lines: [], circles: [] },
      ),
    ).toThrow(/No usable/);
  });
});
