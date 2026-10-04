import { expect, it } from "vitest";
import { commandNativeRequest, validateLegacyNativeCommand } from "./native-command.js";
import { commandJsonSchema } from "./index.js";

it("validates named commands and legacy invokes with the same parameter registry", () => {
  const named = commandNativeRequest("CreateBox", { widthMm: 20, heightMm: 30, depthMm: 10 }, "box-stable");
  expect(named).toEqual({ type: 3, fields: { featureId: "box-stable", widthMm: 20, heightMm: 30, depthMm: 10 } });
  expect(validateLegacyNativeCommand(3, { featureId: "box-stable", width: 20, height: 30, depth: 10 })).toEqual(named);
  for (const widthMm of [-1, 0, "20", Infinity]) {
    expect(() => commandNativeRequest("CreateBox", { widthMm, heightMm: 30, depthMm: 10 }, "box-stable")).toThrow();
    expect(() => validateLegacyNativeCommand(3, { featureId: "box-stable", widthMm, heightMm: 30, depthMm: 10 })).toThrow();
  }
});

it("requires a dimension value or expression and preserves valid zero or negative instance placement", () => {
  expect(() => commandNativeRequest("SetDimension", { featureId: "instance", paramName: "txMm" })).toThrow();
  expect(commandNativeRequest("SetDimension", { featureId: "instance", paramName: "txMm", valueMm: -20 }).fields["valueMm"]).toBe(-20);
  expect(commandNativeRequest("SetDimension", { featureId: "instance", paramName: "rxDeg", valueMm: 0 }).fields["valueMm"]).toBe(0);
});

it("keeps canonical sketch content and translates pattern arrays after their shared validation", () => {
  const sketch = commandNativeRequest("CreateSketch", { model: { points: [{ id: "p", x: 2, y: 3 }] } }, "sk-stable");
  expect(sketch.fields["model"]).toMatchObject({ points: [{ id: "p", x: 2, y: 3, fixed: false }] });
  const pattern = { targetId: "box", faceRole: "box.+Z", featureIds: ["h1", "h2"], pointsMm: [2, 3, 4, 5], diameterMm: 2, depthMode: "throughAll" };
  expect(commandNativeRequest("CreateHolePattern", pattern).fields["points"]).toEqual([2, 3, 4, 5]);
  expect(() => commandNativeRequest("CreateHolePattern", { ...pattern, pointsMm: [2, 3] })).toThrow();
  const update = { featureId: "sk-stable", model: {}, dragPointId: "p", dragX: 2, dragY: 3 };
  expect(validateLegacyNativeCommand(14, update).fields).toMatchObject({ dragPointId: "p", dragX: 2, dragY: 3 });
  expect(() => commandNativeRequest("UpdateSketch", { ...update, dragY: undefined })).toThrow();
});

it("rejects unsupported operations, binary mesh control calls and invalid creation identities", () => {
  expect(() => commandNativeRequest("CreateShell", {})).toThrow();
  expect(() => validateLegacyNativeCommand(12, { featureId: "box" })).toThrow();
  expect(() => validateLegacyNativeCommand(27, {})).toThrow();
  expect(() => commandNativeRequest("CreateBox", { widthMm: 20, heightMm: 30, depthMm: 10 }, "../invalid")).toThrow();
});

it("exports actual parameter constraints from the registry through the standard converter", () => {
  const exported = commandJsonSchema("CreateBox")!;
  expect(exported.nativeType).toBe(3);
  expect(exported.parameters).toMatchObject({ type: "object", required: ["widthMm", "heightMm", "depthMm"], properties: { widthMm: { type: "number", exclusiveMinimum: 0, maximum: 100000 } } });
  expect(commandJsonSchema("CreateShell")).toBeNull();
});
