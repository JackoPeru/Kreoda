import { expect, it } from "vitest";
import { commandJsonSchema, SelectionKindSchema } from "./index.js";

it("accepts datum target kinds alongside the existing canonical selection kinds", () => {
  const kinds = ["body", "face", "edge", "vertex", "sketch", "datumPlane", "datumAxis", "datumPoint"];
  expect(kinds.map((kind) => SelectionKindSchema.parse(kind))).toEqual(kinds);
});

it("declares CreateSketch datum-plane support as optional registry metadata", () => {
  const schema = commandJsonSchema("CreateSketch")!;
  expect(schema).toMatchObject({
    optionalSelectionBindings: { supportRef: "datumPlane" },
    parameters: { properties: { supportRef: { type: "string" } } },
  });
  expect((schema.parameters as { required?: string[] }).required ?? []).not.toContain("supportRef");
});
