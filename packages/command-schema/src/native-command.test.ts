import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { commandNativeRequest, validateLegacyNativeCommand } from "./native-command.js";
import { commandJsonSchema } from "./index.js";

it("runtime schemas expose the actual creation budget including multi-hole commands", () => {
  expect(commandJsonSchema("CreateBox")).toHaveProperty("creation", { fixedCount: 1 });
  expect(commandJsonSchema("CreateHolePattern")).toHaveProperty("creation", { idArrayParameter: "featureIds" });
  expect(commandJsonSchema("UpdateSketch")).toHaveProperty("creation", { fixedCount: 0 });
});

it("exports datum constructors with one creation and update/query with zero", () => {
  for (const id of ["CreateDatumPlane", "CreateDatumAxis", "CreateDatumPoint"])
    expect(commandJsonSchema(id)).toHaveProperty("creation", { fixedCount: 1 });
  for (const id of ["UpdateDatum", "RequestDatum"])
    expect(commandJsonSchema(id)).toHaveProperty("creation", { fixedCount: 0 });
  const definition = { type: "offset", base: { type: "principal", planeKind: "XY" }, offsetMm: -12 };
  expect(commandNativeRequest("CreateDatumPlane", { definition }, "plane-stable")).toEqual({ type: 31, fields: { definition, featureId: "plane-stable" } });
  expect(validateLegacyNativeCommand(35, { featureId: "plane-stable" })).toEqual({ type: 35, fields: { featureId: "plane-stable" } });
  expect(commandNativeRequest("CreateSketch", { supportRef: "plane-stable", model: {} }, "sketch-stable").fields).toHaveProperty("supportRef", "plane-stable");
});

it("keeps generated session datum definitions identical to canonical command schemas", () => {
  const contract = JSON.parse(readFileSync(new URL("../../../schemas/session-control-v1.json", import.meta.url), "utf8")) as { definitions: Record<string, unknown> };
  for (const kind of ["Plane", "Axis", "Point"]) {
    const schema = commandJsonSchema(`CreateDatum${kind}`)!.parameters as { properties: { definition: unknown } };
    expect(contract.definitions[`Datum${kind}Definition`]).toEqual(schema.properties.definition);
  }
});

it("validates datum variants, finite bounded input and stable source identities", () => {
  const point = (x: number, y: number, z: number) => ({ type: "coordinates", positionMm: [x, y, z] });
  const principal = { type: "principal", planeKind: "XY" };
  for (const [id, definition] of [
    ["CreateDatumPlane", principal],
    ["CreateDatumPlane", { type: "offset", base: principal, offsetMm: 10 }],
    ["CreateDatumPlane", { type: "mid", first: principal, second: { type: "datum", featureId: "plane-other" } }],
    ["CreateDatumPlane", { type: "angle", base: principal, axis: { type: "principal", axis: "X" }, angleDeg: 90 }],
    ["CreateDatumPlane", { type: "threePoint", first: point(0, 0, 0), second: point(1, 0, 0), third: point(0, 1, 0) }],
    ["CreateDatumAxis", { type: "twoPoint", first: point(0, 0, 0), second: point(0, 0, 1) }],
    ["CreateDatumAxis", { type: "planeNormal", plane: principal }],
    ["CreateDatumAxis", { type: "planeIntersection", first: principal, second: { type: "principal", planeKind: "YZ" } }],
    ["CreateDatumPoint", point(1, 2, 3)],
    ["CreateDatumPoint", { type: "midpoint", first: point(0, 0, 0), second: { type: "datum", featureId: "point-source" } }],
  ] as const) expect(() => commandNativeRequest(id, { definition }, "datum-stable")).not.toThrow();
  for (const definition of [
    { type: "angle", base: principal, axis: { type: "principal", axis: "X" }, angleDeg: 361 },
    { type: "offset", base: principal, offsetMm: Infinity },
    { type: "offset", base: { type: "datum", featureId: "../bad" }, offsetMm: 1 },
    { type: "offset", base: { type: "face", featureId: "body", persistentFaceId: "" }, offsetMm: 1 },
    { type: "unsupported" },
  ]) expect(() => commandNativeRequest("CreateDatumPlane", { definition }, "datum-stable")).toThrow();
  expect(() => commandNativeRequest("CreateDatumPoint", { definition: point(1000001, 0, 0) }, "datum-stable")).toThrow();
  expect(() => commandNativeRequest("CreateDatumPoint", { definition: { type: "coordinates", positionMm: [1, 2] } }, "datum-stable")).toThrow();
  expect(() => commandNativeRequest("CreateDatumAxis", { definition: principal }, "datum-stable")).toThrow();
});

it("exports canonical stable ID constraints even though their runtime validator is opaque Zod custom", () => {
  expect(commandJsonSchema("CreateHolePattern")!.parameters).toMatchObject({ properties: {
    featureIds: { type: "array", items: { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" } },
  } });
  expect(commandJsonSchema("CreateExtrude")!.parameters).toMatchObject({ properties: { sketchId: { type: "string", maxLength: 128 } } });
});

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
