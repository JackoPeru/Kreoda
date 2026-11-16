// Stage B/C: turn detected image pixels into an editable principal-plane
// sketch. The output is ordinary SketchModel geometry (lines/circles), never
// an opaque mesh; the user reviews it and can edit or extrude it.

import type { SketchModel } from "@kreoda/protocol";
import type { DetectionResult } from "./detect";

export interface CalibratedReferencePlane {
  plane: "XY" | "XZ" | "YZ";
  imageW: number;
  imageH: number;
  mmPerPx: number;
}

export interface ReferenceProposal {
  model: SketchModel;
  lineCount: number;
  circleCount: number;
}

/**
 * Map an image pixel to the principal sketch's local mm coordinates.
 * The YZ branch mirrors CadViewport.syncReferencePlanes: its reference quad
 * is centered on (widthMm + heightMm) / 2 in both axes.
 */
export function pixelToSketchMm(
  plane: CalibratedReferencePlane,
  px: number,
  py: number,
): [number, number] {
  const s = plane.mmPerPx;
  const widthMm = plane.imageW * s;
  const heightMm = plane.imageH * s;
  if (plane.plane === "XY") return [px * s, (plane.imageH - py) * s];
  if (plane.plane === "XZ") return [px * s, py * s];
  const center = (widthMm + heightMm) / 2;
  return [center - py * s, center - px * s];
}

export function buildReferenceSketch(
  plane: CalibratedReferencePlane,
  detection: DetectionResult,
  limits: { maxLines?: number; maxCircles?: number; maxPoints?: number } = {},
): ReferenceProposal {
  if (
    !Number.isFinite(plane.mmPerPx) ||
    plane.mmPerPx <= 0 ||
    plane.mmPerPx > 1_000_000
  ) {
    throw new Error("Calibrate the reference image before detecting geometry.");
  }
  if (detection.width !== plane.imageW || detection.height !== plane.imageH) {
    throw new Error("Detected geometry does not match the reference image.");
  }
  const maxLines = Math.max(1, Math.min(128, limits.maxLines ?? 64));
  const maxCircles = Math.max(1, Math.min(64, limits.maxCircles ?? 16));
  const maxPoints = Math.max(4, Math.min(512, limits.maxPoints ?? 256));
  const points: SketchModel["points"] = [];
  const lines: SketchModel["lines"] = [];
  const circles: SketchModel["circles"] = [];
  const constraints: SketchModel["constraints"] = [];
  const byKey = new Map<string, string>();
  const pointId = (x: number, y: number): string | null => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const key = `${x.toFixed(3)},${y.toFixed(3)}`;
    const existing = byKey.get(key);
    if (existing) return existing;
    if (points.length >= maxPoints) return null;
    const id = `p${points.length}`;
    points.push({ id, x, y, fixed: false });
    byKey.set(key, id);
    return id;
  };
  for (const line of detection.lines) {
    if (lines.length >= maxLines) break;
    const [x1, y1] = pixelToSketchMm(plane, line.x1, line.y1);
    const [x2, y2] = pixelToSketchMm(plane, line.x2, line.y2);
    if (Math.hypot(x2 - x1, y2 - y1) < 0.5) continue;
    const p1 = pointId(x1, y1);
    const p2 = pointId(x2, y2);
    if (!p1 || !p2 || p1 === p2) continue;
    const lineId = `l${lines.length}`;
    lines.push({ id: lineId, p1, p2 });
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    const tolerance = length * Math.tan((2 * Math.PI) / 180);
    if (Math.abs(dy) <= tolerance) {
      constraints.push({ id: `hc${constraints.length}`, kind: "horizontal", refs: [lineId], value: 0 });
    } else if (Math.abs(dx) <= tolerance) {
      constraints.push({ id: `vc${constraints.length}`, kind: "vertical", refs: [lineId], value: 0 });
    }
  }
  for (const circle of detection.circles) {
    if (circles.length >= maxCircles) break;
    const [cx, cy] = pixelToSketchMm(plane, circle.cx, circle.cy);
    const r = circle.r * plane.mmPerPx;
    if (!(r >= 0.5) || !Number.isFinite(r)) continue;
    const center = pointId(cx, cy);
    if (!center) continue;
    const circleId = `c${circles.length}`;
    circles.push({ id: circleId, center, r });
    constraints.push({
      id: `dc${constraints.length}`,
      kind: "diameter",
      refs: [circleId],
      value: 2 * r,
    });
  }
  if (lines.length === 0 && circles.length === 0) {
    throw new Error("No usable lines or circles were detected.");
  }
  return {
    model: { points, lines, circles, arcs: [], constraints },
    lineCount: lines.length,
    circleCount: circles.length,
  };
}
