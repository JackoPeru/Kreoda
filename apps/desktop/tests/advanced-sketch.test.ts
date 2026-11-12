import { expect, it } from "vitest";
import { SketchModelSchema } from "@kreoda/protocol";
import { transformSketchLines, trimExtendSketchLine, sameSketchCoordinateMm, addSketchEllipse, addSketchSpline } from "../src/model/advanced-sketch";

it("creates native ellipse/arc and B-spline from existing stable point IDs", () => {
  const ellipse = addSketchEllipse(original, "e1", "a", 12, 6);
  expect(ellipse.ellipses?.[0]).toMatchObject({ id: "e1", center: "a", arc: false, majorRadius: 12, minorRadius: 6 });
  const arc = addSketchEllipse(ellipse, "arc1", "b", 10, 3, true);
  expect(arc.ellipses?.[1]).toMatchObject({ arc: true, startAngleRad: 0, endAngleRad: Math.PI });
  const spline = addSketchSpline(arc, "s1", ["a", "b", "a"]);
  expect(spline.splines?.[0]?.pointIds).toEqual(["a", "b", "a"]);
  expect(original.ellipses).toBeUndefined();
  expect(() => addSketchEllipse(original, "bad", "missing", 12, 6)).toThrow();
  expect(() => addSketchEllipse(original, "bad", "a", 3, 6)).toThrow();
  expect(() => addSketchSpline(original, "bad", ["a", "missing", "b"])).toThrow();
});

const original = SketchModelSchema.parse({
  points: [{ id: "a", x: 2, y: 3, fixed: false }, { id: "b", x: 5, y: 3, fixed: false }],
  lines: [{ id: "source", p1: "a", p2: "b" }], constructionIds: ["source"],
});

it("uses precise native ellipse/elliptical arc and spline JSON field names", () => {
  const parsed = SketchModelSchema.parse({ ...original,
    ellipses: [{ id: "ell", center: "a", majorRadius: 9, minorRadius: 4, rotationRad: 0.5,
      arc: true, startAngleRad: 0, endAngleRad: 2 }],
    splines: [{ id: "spl", pointIds: ["a", "b", "a"], controlPoints: true, closed: false }],
  });
  expect(parsed.ellipses?.[0]?.arc).toBe(true);
  expect(parsed.splines?.[0]?.controlPoints).toBe(true);
  expect(() => SketchModelSchema.parse({ ...original, ellipses: [{ id: "bad", center: "a", majorRadius: 2, minorRadius: 3 }] })).toThrow();
  expect(() => SketchModelSchema.parse({ ...original, splines: [{ id: "bad", pointIds: ["a", "b"] }] })).toThrow();
});

it("mirrors lines around Y and preserves construction metadata and original geometry", () => {
  const transformed = transformSketchLines(original, ["source"], "mirror", true, 0, 1, 0, 0, 1);
  expect(transformed.points.slice(-2).map(p => [p.x, p.y, p.fixed])).toEqual([[-2, 3, false], [-5, 3, false]]);
  expect(transformed.constructionIds).toContain("mirror-1-source");
  expect(transformed.points[0]).toEqual(original.points[0]);
  expect(original.lines).toHaveLength(1);
});

it("patterns independent fixed points and rejects invalid collisions", () => {
  const transformed = transformSketchLines(original, ["source"], "array", false, 1, 0, 10, 0, 2);
  expect(transformed.points.slice(-2).map(p => p.x)).toEqual([22, 25]);
  expect(transformed.lines).toHaveLength(3);
  expect(() => transformSketchLines(transformed, ["source"], "array", false, 1, 0, 10, 0, 1)).toThrow(/collision/i);
  expect(() => transformSketchLines(original, ["unknown"], "x", true, 0, 1, 0, 0, 1)).toThrow(/unknown source/i);
});

it("copies connected line closures once and remaps fixed points, construction and internal constraints", () => {
  const rectangle = SketchModelSchema.parse({
    points: [{ id: "p0", x: 0, y: 0, fixed: true }, { id: "p1", x: 10, y: 0, fixed: false },
      { id: "p2", x: 10, y: 5, fixed: false }, { id: "p3", x: 0, y: 5, fixed: false }],
    lines: [{ id: "l0", p1: "p0", p2: "p1" }, { id: "l1", p1: "p1", p2: "p2" },
      { id: "l2", p1: "p2", p2: "p3" }, { id: "l3", p1: "p3", p2: "p0" }],
    constructionIds: ["l0", "l2"],
    constraints: [{ id: "anchor", kind: "fixed", refs: ["p0"], value: 0 },
      { id: "h0", kind: "horizontal", refs: ["l0"], value: 0 },
      { id: "v1", kind: "vertical", refs: ["l1"], value: 0 },
      { id: "width", kind: "distance", refs: ["p0", "p1"], value: 10 }],
  });
  const copy = transformSketchLines(rectangle, ["l0", "l1", "l2", "l3"], "array", false, 1, 0, 20, 30, 1);
  const copiedLines = copy.lines.filter(line => line.id.startsWith("array-1-"));
  expect(copiedLines).toHaveLength(4);
  const copiedPointIds = new Set(copiedLines.flatMap(line => [line.p1, line.p2]));
  expect(copiedPointIds.size).toBe(4);
  const copies = new Map(copy.points.filter(point => copiedPointIds.has(point.id)).map(point => [point.id, point]));
  expect([...copies.values()].filter(point => point.fixed)).toHaveLength(1);
  expect([...copies.values()].map(point => [point.x, point.y])).toContainEqual([20, 30]);
  const byId = new Map(copiedLines.map(line => [line.id, line]));
  expect(byId.get("array-1-l0")?.p2).toBe(byId.get("array-1-l1")?.p1);
  expect(byId.get("array-1-l1")?.p2).toBe(byId.get("array-1-l2")?.p1);
  expect(copy.constructionIds).toContain("array-1-l0");
  expect(copy.constructionIds).toContain("array-1-l2");
  expect(copy.constraints.find(constraint => constraint.id === "array-1-width")).toMatchObject({
    kind: "distance", value: 10,
  });
  expect(copy.constraints.find(constraint => constraint.id === "array-1-width")?.refs.every(ref => copiedPointIds.has(ref))).toBe(true);
  expect(copy.points.find(point => point.id === "p0")).toEqual(rectangle.points[0]);
});

it("rejects a constraint that crosses the selected copy closure and cross-kind generated IDs", () => {
  const crossing = SketchModelSchema.parse({
    points: [{ id: "a", x: 0, y: 0, fixed: true }, { id: "b", x: 10, y: 0, fixed: true },
      { id: "c", x: 20, y: 0, fixed: true }, { id: "d", x: 30, y: 0, fixed: true }],
    lines: [{ id: "source", p1: "a", p2: "b" }, { id: "outside", p1: "c", p2: "d" }],
    constraints: [{ id: "crossing", kind: "parallel", refs: ["source", "outside"], value: 0 }],
  });
  expect(() => transformSketchLines(crossing, ["source"], "copy", false, 1, 0, 0, 0, 1)).toThrow(/constraint.*cross/i);
});

it("rejects generated line IDs that collide with points", () => {
  const colliding = SketchModelSchema.parse({
    points: [{ id: "a", x: 0, y: 0, fixed: true }, { id: "b", x: 10, y: 0, fixed: true },
      { id: "collision-1-source", x: 40, y: 40, fixed: true }],
    lines: [{ id: "source", p1: "a", p2: "b" }],
  });
  expect(() => transformSketchLines(colliding, ["source"], "collision", false, 1, 0, 0, 0, 1)).toThrow(/collision/i);
});

it("remaps horizontal and vertical constraints under oblique reflection and reverses signed angles", () => {
  const axes = SketchModelSchema.parse({
    points: [{ id: "a", x: 0, y: 0, fixed: true }, { id: "b", x: 4, y: 0, fixed: true },
      { id: "c", x: 0, y: 0, fixed: true }, { id: "d", x: 0, y: 4, fixed: true }],
    lines: [{ id: "horizontal", p1: "a", p2: "b" }, { id: "vertical", p1: "c", p2: "d" }],
    constraints: [{ id: "h", kind: "horizontal", refs: ["horizontal"], value: 0 },
      { id: "v", kind: "vertical", refs: ["vertical"], value: 0 },
      { id: "angle", kind: "angle", refs: ["horizontal", "vertical"], value: Math.PI / 2 }],
  });
  const reflected = transformSketchLines(axes, ["horizontal", "vertical"], "mirror", true, 1, 1, 0, 0, 1);
  expect(reflected.constraints.find(constraint => constraint.id === "mirror-1-h")).toMatchObject({ kind: "vertical" });
  expect(reflected.constraints.find(constraint => constraint.id === "mirror-1-v")).toMatchObject({ kind: "horizontal" });
  expect(reflected.constraints.find(constraint => constraint.id === "mirror-1-angle")?.value).toBeCloseTo(-Math.PI / 2);
});

it("mirrors about a selected existing line axis away from the origin and rejects unrepresentable axes", () => {
  const model = SketchModelSchema.parse({
    points: [{ id: "o0", x: 10, y: 10, fixed: true }, { id: "o1", x: 14, y: 14, fixed: true },
      { id: "a", x: 10, y: 12, fixed: false }, { id: "b", x: 12, y: 12, fixed: false }],
    lines: [{ id: "axis", p1: "o0", p2: "o1" }, { id: "source", p1: "a", p2: "b" }],
  });
  const mirrored = transformSketchLines(model, ["source"], "mirror", {
    kind: "mirror", axis: { kind: "line", lineId: "axis" },
  });
  expect(mirrored.points.slice(-2).map(point => [point.x, point.y])).toEqual([[12, 10], [12, 12]]);
  expect(mirrored.lines.find(line => line.id === "source")).toEqual(model.lines[1]);
  const constrained = SketchModelSchema.parse({
    points: [...model.points, { id: "oblique-end", x: 11, y: 13, fixed: true }],
    lines: [...model.lines, { id: "oblique-axis", p1: "o0", p2: "oblique-end" }],
    constraints: [{ id: "h", kind: "horizontal", refs: ["source"], value: 0 }],
  });
  expect(() => transformSketchLines(constrained, ["source"], "mirror", {
    kind: "mirror", axis: { kind: "line", lineId: "oblique-axis" },
  })).toThrow(/oblique mirror/i);
});

it("builds an exact trim candidate without changing the source and reports shared-point consequences", () => {
  const model = SketchModelSchema.parse({
    points: [{ id: "a", x: 0, y: 0, fixed: false }, { id: "b", x: 10, y: 0, fixed: false },
      { id: "c", x: 4, y: -5, fixed: true }, { id: "d", x: 4, y: 5, fixed: true },
      { id: "e", x: 0, y: -5, fixed: true }, { id: "f", x: 15, y: -5, fixed: true },
      { id: "g", x: 15, y: 5, fixed: true }],
    lines: [{ id: "target", p1: "a", p2: "b" }, { id: "boundary", p1: "c", p2: "d" },
      { id: "shared-segment", p1: "a", p2: "e" }, { id: "extension-boundary", p1: "f", p2: "g" }],
  });
  const candidate = trimExtendSketchLine(model, "target", "boundary", true, false);
  expect(candidate).toMatchObject({ pointId: "a", x: 4, y: 0, affectedLineIds: ["target", "shared-segment"] });
  expect(candidate.model.points.find(point => point.id === "a")).toMatchObject({ x: 4, y: 0 });
  expect(model.points.find(point => point.id === "a")).toMatchObject({ x: 0, y: 0 });
  expect(trimExtendSketchLine(model, "target", "extension-boundary", false, true)).toMatchObject({
    pointId: "b", x: 15, y: 0,
  });
  expect(() => trimExtendSketchLine(SketchModelSchema.parse({ ...model,
    constraints: [{ id: "fixed-start", kind: "fixed", refs: ["a"], value: 0 }],
  }), "target", "boundary", true, false)).toThrow(/fixed/i);
  expect(() => trimExtendSketchLine(model, "target", "shared-segment", true, false)).toThrow(/parallel|outside/i);
});

it("uses a fixed millimetre tolerance plus floating-point allowance at large coordinates", () => {
  expect(sameSketchCoordinateMm(1_000_000, 1_000_000.005)).toBe(false);
  expect(sameSketchCoordinateMm(100_000, 100_000.0005)).toBe(false);
  expect(sameSketchCoordinateMm(100_000, 100_000 + 1e-9)).toBe(true);
});
