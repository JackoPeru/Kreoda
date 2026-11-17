import { SketchModelSchema, type SketchModel } from "@kreoda/protocol";

export function addSketchEllipse(model: SketchModel, id: string, center: string,
  majorRadius: number, minorRadius: number, arc = false, startAngleRad = 0, endAngleRad = Math.PI): SketchModel {
  if (!model.points.some(p => p.id === center) || !id ||
      [...(model.ellipses ?? []), ...(model.splines ?? [])].some(e => e.id === id)) throw Error("Invalid ellipse reference or duplicate ID");
  return SketchModelSchema.parse({ ...model, ellipses: [...(model.ellipses ?? []),
    { id, center, majorRadius, minorRadius, rotationRad: 0, arc,
      startAngleRad: arc ? startAngleRad : 0, endAngleRad: arc ? endAngleRad : Math.PI * 2 }] });
}

export function addSketchSpline(model: SketchModel, id: string, pointIds: string[], closed = false): SketchModel {
  if (!id || [...(model.ellipses ?? []), ...(model.splines ?? [])].some(e => e.id === id) ||
      pointIds.some(point => !model.points.some(p => p.id === point))) throw Error("Invalid B-spline point reference");
  return SketchModelSchema.parse({ ...model, splines: [...(model.splines ?? []),
    { id, pointIds, controlPoints: true, closed }] });
}

export type SketchLineTransform =
  | { kind: "mirror"; axis: { kind: "x" | "y" } | { kind: "line"; lineId: string } }
  | { kind: "pattern"; spacingX: number; spacingY: number; copies: number };

export type TrimExtendCandidate = {
  model: SketchModel;
  targetLineId: string;
  pointId: string;
  x: number;
  y: number;
  affectedLineIds: string[];
};

export function sameSketchCoordinateMm(a: number, b: number, scale = 1): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(scale)) return false;
  const magnitude = Math.max(1, Math.abs(a), Math.abs(b), Math.abs(scale));
  return Math.abs(a - b) <= 1e-7 + 64 * Number.EPSILON * magnitude;
}

type NormalizedLineTransform = {
  kind: "mirror" | "pattern";
  mirror: boolean;
  axisX: number;
  axisY: number;
  axisOriginX: number;
  axisOriginY: number;
  spacingX: number;
  spacingY: number;
  copies: number;
};

function globalSketchIds(model: SketchModel): Set<string> {
  const ids = new Set<string>();
  const entries = [
    ...model.points, ...model.lines, ...(model.circles ?? []), ...(model.arcs ?? []),
    ...(model.ellipses ?? []), ...(model.splines ?? []), ...model.constraints,
  ];
  for (const item of entries) {
    if (!item.id || ids.has(item.id)) throw Error(`Duplicate or empty sketch ID: ${item.id}`);
    ids.add(item.id);
  }
  return ids;
}

function normalizeTransform(model: SketchModel, transform: SketchLineTransform,
  offsetX = 0, offsetY = 0): NormalizedLineTransform {
  if (transform.kind === "pattern") {
    if (!Number.isInteger(transform.copies) || transform.copies < 1 || transform.copies > 64 ||
        !Number.isFinite(transform.spacingX) || !Number.isFinite(transform.spacingY)) {
      throw Error("Invalid pattern spacing or copy count (1–64)");
    }
    return { kind: "pattern", mirror: false, axisX: 1, axisY: 0, axisOriginX: 0, axisOriginY: 0,
      spacingX: transform.spacingX, spacingY: transform.spacingY, copies: transform.copies };
  }
  let axisX: number, axisY: number, axisOriginX: number, axisOriginY: number;
  if (transform.axis.kind === "x") {
    axisX = 1; axisY = 0; axisOriginX = 0; axisOriginY = 0;
  } else if (transform.axis.kind === "y") {
    axisX = 0; axisY = 1; axisOriginX = 0; axisOriginY = 0;
  } else if (transform.axis.kind === "line") {
    const axisLineId = transform.axis.lineId;
    const axis = model.lines.find(line => line.id === axisLineId);
    const points = new Map(model.points.map(point => [point.id, point]));
    const a = axis && points.get(axis.p1), b = axis && points.get(axis.p2);
    if (!axis || !a || !b) throw Error(`Unknown mirror axis line ${axisLineId}`);
    axisX = b.x - a.x; axisY = b.y - a.y; axisOriginX = a.x; axisOriginY = a.y;
  } else {
    throw Error("Invalid mirror axis");
  }
  if (![axisX, axisY, axisOriginX, axisOriginY, offsetX, offsetY].every(Number.isFinite) ||
      Math.hypot(axisX, axisY) < 1e-12) throw Error("Mirror axis is degenerate or non-finite");
  return { kind: "mirror", mirror: true, axisX, axisY, axisOriginX, axisOriginY,
    spacingX: offsetX, spacingY: offsetY, copies: 1 };
}

function transformSketchLineClosure(model: SketchModel, lineIds: string[], prefix: string,
  operation: NormalizedLineTransform): SketchModel {
  if (!prefix || !lineIds.length) throw Error("Invalid sketch transformation");
  const ids = globalSketchIds(model);
  const lineById = new Map(model.lines.map(line => [line.id, line]));
  const pointById = new Map(model.points.map(point => [point.id, point]));
  const selected = new Set<string>();
  const selectedLines = lineIds.map(id => {
    if (selected.has(id)) throw Error("Duplicate source line selection");
    selected.add(id);
    const line = lineById.get(id);
    if (!line) throw Error(`Unknown source line ${id}`);
    const a = pointById.get(line.p1), b = pointById.get(line.p2);
    if (!a || !b) throw Error("Source line has missing point");
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite) || line.p1 === line.p2 ||
        Math.hypot(b.x - a.x, b.y - a.y) < 1e-12) throw Error("Source line is non-finite or degenerate");
    return line;
  });
  const closure = new Set(selected);
  for (const line of selectedLines) { closure.add(line.p1); closure.add(line.p2); }
  for (const constraint of model.constraints) {
    if (constraint.refs.some(ref => !ids.has(ref))) throw Error(`Constraint ${constraint.id} has missing reference`);
  }
  const copiedConstraints = model.constraints.filter(constraint => {
    const touches = constraint.refs.some(ref => closure.has(ref));
    if (touches && constraint.refs.some(ref => !closure.has(ref))) {
      throw Error(`Constraint ${constraint.id} crosses the selected line closure`);
    }
    return touches;
  });

  let next = SketchModelSchema.parse(model);
  const existingIds = new Set(ids);
  for (let copy = 1; copy <= operation.copies; copy++) {
    const remap = new Map<string, string>();
    const generated = (sourceId: string): string => {
      const id = `${prefix}-${copy}-${sourceId}`;
      if (existingIds.has(id)) throw Error(`Transformed ID collision: ${id}`);
      existingIds.add(id);
      remap.set(sourceId, id);
      return id;
    };
    for (const line of selectedLines) generated(line.id);
    for (const line of selectedLines) {
      if (!remap.has(line.p1)) generated(line.p1);
      if (!remap.has(line.p2)) generated(line.p2);
    }
    for (const constraint of copiedConstraints) generated(constraint.id);

    const positions = new Map<string, { x: number; y: number }>();
    const newPoints = new Map<string, (typeof model.points)[number]>();
    for (const line of selectedLines) for (const sourceId of [line.p1, line.p2]) {
      if (newPoints.has(sourceId)) continue;
      const source = pointById.get(sourceId)!;
      let { x, y } = source;
      if (operation.mirror) {
        const length = Math.hypot(operation.axisX, operation.axisY);
        const ux = operation.axisX / length, uy = operation.axisY / length;
        const dx = x - operation.axisOriginX, dy = y - operation.axisOriginY;
        const along = dx * ux + dy * uy;
        x = operation.axisOriginX + 2 * along * ux - dx;
        y = operation.axisOriginY + 2 * along * uy - dy;
      }
      x += copy * operation.spacingX;
      y += copy * operation.spacingY;
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw Error("Transformed coordinates are non-finite");
      positions.set(sourceId, { x, y });
      newPoints.set(sourceId, { ...source, id: remap.get(sourceId)!, x, y });
    }
    const newLines = selectedLines.map(line => ({
      id: remap.get(line.id)!, p1: remap.get(line.p1)!, p2: remap.get(line.p2)!,
    }));
    const newConstraints = copiedConstraints.map(constraint => {
      const refs = constraint.refs.map(ref => remap.get(ref)!);
      let kind = constraint.kind;
      let value = constraint.value;
      if (operation.mirror && kind === "angle") value = -value;
      if (operation.mirror && (kind === "horizontal" || kind === "vertical")) {
        if (constraint.refs.length !== 1) throw Error(`Constraint ${constraint.id} has invalid axis references`);
        const sourceLine = lineById.get(constraint.refs[0]!);
        if (!sourceLine || !selected.has(sourceLine.id)) throw Error(`Constraint ${constraint.id} references an unselected axis`);
        const a = positions.get(sourceLine.p1)!, b = positions.get(sourceLine.p2)!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const tolerance = 1e-8 * Math.max(1, Math.abs(dx), Math.abs(dy));
        if (Math.abs(dy) <= tolerance) kind = "horizontal";
        else if (Math.abs(dx) <= tolerance) kind = "vertical";
        else throw Error("Oblique mirror cannot preserve horizontal or vertical constraint");
      }
      return { ...constraint, id: remap.get(constraint.id)!, kind, value, refs };
    });
    const constructionIds = (model.constructionIds ?? [])
      .filter(id => selected.has(id)).map(id => remap.get(id)!);
    next = SketchModelSchema.parse({
      ...next,
      points: [...next.points, ...[...newPoints.values()]],
      lines: [...next.lines, ...newLines],
      constraints: [...next.constraints, ...newConstraints],
      constructionIds: [...(next.constructionIds ?? []), ...constructionIds],
    });
  }
  return next;
}

export function transformSketchLines(model: SketchModel, lineIds: string[], prefix: string,
  transform: SketchLineTransform): SketchModel;
export function transformSketchLines(model: SketchModel, lineIds: string[], prefix: string,
  mirror: boolean, axisX: number, axisY: number, offsetX: number, offsetY: number, copies: number): SketchModel;
export function transformSketchLines(model: SketchModel, lineIds: string[], prefix: string,
  transformOrMirror: SketchLineTransform | boolean, axisX?: number, axisY?: number,
  offsetX?: number, offsetY?: number, copies?: number): SketchModel {
  if (typeof transformOrMirror !== "boolean") {
    return transformSketchLineClosure(model, lineIds, prefix, normalizeTransform(model, transformOrMirror));
  }
  const legacyCopies = copies ?? NaN;
  if (![axisX, axisY, offsetX, offsetY].every(value => Number.isFinite(value)) ||
      !Number.isInteger(legacyCopies) || legacyCopies < 1 || legacyCopies > 64) {
    throw Error("Invalid sketch transformation");
  }
  if (transformOrMirror) {
    if (Math.hypot(axisX!, axisY!) < 1e-12) throw Error("Mirror axis is degenerate");
    return transformSketchLineClosure(model, lineIds, prefix, {
      kind: "mirror", mirror: true, axisX: axisX ?? NaN, axisY: axisY ?? NaN,
      axisOriginX: 0, axisOriginY: 0, spacingX: offsetX ?? NaN, spacingY: offsetY ?? NaN,
      copies: legacyCopies,
    });
  }
  return transformSketchLineClosure(model, lineIds, prefix, normalizeTransform(model, {
    kind: "pattern", spacingX: offsetX!, spacingY: offsetY!, copies: legacyCopies,
  }));
}

export function trimExtendSketchLine(model: SketchModel, targetLineId: string, boundaryLineId: string,
  moveStart: boolean, extend: boolean): TrimExtendCandidate {
  const target = model.lines.find(line => line.id === targetLineId);
  const boundary = model.lines.find(line => line.id === boundaryLineId);
  if (!target || !boundary || targetLineId === boundaryLineId) throw Error("Trim/extend requires distinct existing lines");
  const points = new Map(model.points.map(point => [point.id, point]));
  const a = points.get(target.p1), b = points.get(target.p2), c = points.get(boundary.p1), d = points.get(boundary.p2);
  if (!a || !b || !c || !d) throw Error("Trim/extend has missing endpoints");
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const det = rx * sy - ry * sx;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-10 * Math.hypot(rx, ry) * Math.hypot(sx, sy)) {
    throw Error("Trim/extend lines parallel or degenerate");
  }
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / det;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / det;
  const tolerance = 1e-8;
  if (!Number.isFinite(t) || !Number.isFinite(u) || u < -tolerance || u > 1 + tolerance ||
      (extend ? t >= -tolerance && t <= 1 + tolerance : !(t > tolerance && t < 1 - tolerance)) ||
      (!extend && (moveStart ? t <= tolerance : t >= 1 - tolerance)) ||
      (extend && (moveStart ? t >= -tolerance : t <= 1 + tolerance))) {
    throw Error("Trim/extend intersection outside supported region");
  }
  const pointId = moveStart ? target.p1 : target.p2;
  const point = points.get(pointId)!;
  if (point.fixed || model.constraints.some(constraint => constraint.kind === "fixed" && constraint.refs.includes(pointId))) {
    throw Error("Trim/extend endpoint is fixed");
  }
  const x = a.x + t * rx, y = a.y + t * ry;
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw Error("Trim/extend intersection is non-finite");
  const candidate = SketchModelSchema.parse({
    ...model,
    points: model.points.map(item => item.id === pointId ? { ...item, x, y } : item),
  });
  return { model: candidate, targetLineId, pointId, x, y,
    affectedLineIds: model.lines.filter(line => line.p1 === pointId || line.p2 === pointId).map(line => line.id) };
}
