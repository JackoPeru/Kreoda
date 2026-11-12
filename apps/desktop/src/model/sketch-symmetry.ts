import { SketchModelSchema, type SketchModel } from "@kreoda/protocol";

export function addSymmetricConstraint(model: SketchModel, id: string, pointA: string, pointB: string, axisLine: string): SketchModel {
  if (!id || model.constraints.some(c => c.id === id) || pointA === pointB ||
      !model.points.some(p => p.id === pointA) || !model.points.some(p => p.id === pointB) ||
      !model.lines.some(l => l.id === axisLine)) throw Error("Seleziona due punti distinti e una linea asse esistenti");
  return SketchModelSchema.parse({ ...model,
    constraints: [...model.constraints, { id, kind: "symmetric", refs: [pointA, pointB, axisLine], value: 0 }] });
}
