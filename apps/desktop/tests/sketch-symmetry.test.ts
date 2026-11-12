import { expect, it } from "vitest";
import { SketchConstraintSchema, SketchModelSchema } from "@kreoda/protocol";
import { addSymmetricConstraint } from "../src/model/sketch-symmetry";

const model = SketchModelSchema.parse({
  points: [{ id: "a", x: -2, y: 1 }, { id: "b", x: 2, y: 1 }, { id: "axisA", x: 0, y: 0 }, { id: "axisB", x: 0, y: 5 }],
  lines: [{ id: "axis", p1: "axisA", p2: "axisB" }],
  constraints: [{ id: "existing", kind: "horizontal", refs: ["a", "b"], value: 0 }],
});

it("adds exact native symmetric JSON and preserves all existing sketch history", () => {
  const next = addSymmetricConstraint(model, "sym-1", "a", "b", "axis");
  expect(next.constraints.at(-1)).toEqual({ id: "sym-1", kind: "symmetric", refs: ["a", "b", "axis"], value: 0 });
  expect(next.constraints[0]).toEqual(model.constraints[0]);
  expect(model.constraints).toHaveLength(1);
});

it("rejects ambiguous or invalid native symmetry references", () => {
  expect(() => addSymmetricConstraint(model, "sym", "a", "a", "axis")).toThrow();
  expect(() => addSymmetricConstraint(model, "sym", "missing", "b", "axis")).toThrow();
  expect(() => addSymmetricConstraint(model, "sym", "a", "b", "missing")).toThrow();
  expect(() => SketchConstraintSchema.parse({ id: "sym", kind: "symmetric", refs: ["a", "b"], value: 0 })).toThrow();
  expect(() => SketchConstraintSchema.parse({ id: "sym", kind: "symmetric", refs: ["a", "b", "axis"], value: 1 })).toThrow();
  expect(() => SketchConstraintSchema.parse({ id: "sym", kind: "symmetric", refs: ["a", "a", "axis"], value: 0 })).toThrow();
});
