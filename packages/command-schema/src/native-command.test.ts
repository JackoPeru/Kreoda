import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { commandNativeRequest, validateLegacyNativeCommand } from "./native-command.js";
import { commandJsonSchema, featureGeometryKind } from "./index.js";

it("exposes strict surface extrude, revolve and ordered loft commands as native 48-50", () => {
  expect(commandJsonSchema("CreateSurfaceExtrude")).toMatchObject({ nativeType: 48, creation: { fixedCount: 1 } });
  expect(commandJsonSchema("CreateSurfaceRevolve")).toMatchObject({ nativeType: 49, creation: { fixedCount: 1 } });
  expect(commandJsonSchema("CreateSurfaceLoft")).toMatchObject({ nativeType: 50, creation: { fixedCount: 1 } });

  expect(commandNativeRequest("CreateSurfaceExtrude", { sketchId: "sketch-a", distanceMm: -25 }, "surface-a"))
    .toEqual({ type: 48, fields: { featureId: "surface-a", sketchId: "sketch-a", distanceMm: -25 } });
  expect(commandNativeRequest("CreateSurfaceRevolve", { sketchId: "sketch-a", angleDeg: 360 }, "surface-b"))
    .toEqual({ type: 49, fields: { featureId: "surface-b", sketchId: "sketch-a", angleDeg: 360,
      axisOriginXMm: 0, axisOriginYMm: 0, axisOriginZMm: 0, axisX: 1, axisY: 0, axisZ: 0 } });
  expect(commandNativeRequest("CreateSurfaceLoft", { sketchIds: ["section-a", "section-b"] }, "surface-c"))
    .toEqual({ type: 50, fields: { featureId: "surface-c", sketchIds: ["section-a", "section-b"] } });

  for (const invalid of [
    ["CreateSurfaceExtrude", { sketchId: "sketch-a", distanceMm: 0 }],
    ["CreateSurfaceExtrude", { sketchId: "sketch-a", distanceMm: 100001 }],
    ["CreateSurfaceRevolve", { sketchId: "sketch-a", angleDeg: 361 }],
    ["CreateSurfaceRevolve", { sketchId: "sketch-a", angleDeg: 90, axisX: 0, axisY: 0, axisZ: 0 }],
    ["CreateSurfaceRevolve", { sketchId: "sketch-a", angleDeg: 90, axisOriginXMm: 100001 }],
    ["CreateSurfaceRevolve", { sketchId: "sketch-a", angleDeg: 90, unsupported: true }],
    ["CreateSurfaceLoft", { sketchIds: ["section-a", "section-a"] }],
  ] as const) expect(() => commandNativeRequest(invalid[0], invalid[1], "surface-invalid")).toThrow();

  expect(featureGeometryKind("SurfaceExtrude")).toBe("surface");
  expect(featureGeometryKind("SurfaceRevolve")).toBe("surface");
  expect(featureGeometryKind("SurfaceLoft")).toBe("surface");
  expect(featureGeometryKind("SurfaceLoftSewnSolid")).toBe("solid");
  expect(featureGeometryKind("SurfaceFaceThicken")).toBe("solid");
  expect(featureGeometryKind("FutureSurfaceOperation")).toBe("solid");
});

it("exposes associative surface sew and signed exact offset as native commands 51-52", () => {
  expect(commandJsonSchema("CreateSurfaceSew")).toMatchObject({
    nativeType: 51, creation: { fixedCount: 1 },
    selectionBindings: { featureIds: "owners" },
  });
  expect(commandJsonSchema("CreateSurfaceOffset")).toMatchObject({
    nativeType: 52, creation: { fixedCount: 1 },
    selectionBindings: { targetId: "owner" },
  });
  expect(commandNativeRequest("CreateSurfaceSew", { featureIds: ["surface-a", "surface-b"] }, "sew-1"))
    .toEqual({ type: 51, fields: { featureId: "sew-1", featureIds: ["surface-a", "surface-b"],
      toleranceMm: 0.01, makeSolid: false } });
  expect(commandNativeRequest("CreateSurfaceSew", {
    featureIds: ["surface-b", "surface-a"], toleranceMm: 0.2, makeSolid: true,
  }, "solid-1")).toEqual({ type: 51, fields: { featureId: "solid-1", featureIds: ["surface-b", "surface-a"],
    toleranceMm: 0.2, makeSolid: true } });
  expect(commandNativeRequest("CreateSurfaceOffset", {
    targetId: "surface-a", distanceMm: -2,
  }, "offset-1")).toEqual({ type: 52, fields: {
    featureId: "offset-1", targetId: "surface-a", distanceMm: -2, toleranceMm: 1e-6,
  } });

  for (const invalid of [
    ["CreateSurfaceSew", { featureIds: [] }],
    ["CreateSurfaceSew", { featureIds: ["surface-a", "surface-a"] }],
    ["CreateSurfaceSew", { featureIds: ["surface-a"], toleranceMm: 0 }],
    ["CreateSurfaceSew", { featureIds: ["surface-a"], toleranceMm: 1.1 }],
    ["CreateSurfaceSew", { featureIds: ["surface-a"], makeSolid: 1 }],
    ["CreateSurfaceSew", { featureIds: ["surface-a"], extra: true }],
    ["CreateSurfaceOffset", { targetId: "surface-a", distanceMm: 0 }],
    ["CreateSurfaceOffset", { targetId: "surface-a", distanceMm: 0.0000005 }],
    ["CreateSurfaceOffset", { targetId: "surface-a", distanceMm: 100001 }],
    ["CreateSurfaceOffset", { targetId: "surface-a", distanceMm: -100001 }],
    ["CreateSurfaceOffset", { targetId: "surface-a", distanceMm: 2, toleranceMm: 1.1 }],
    ["CreateSurfaceOffset", { targetId: "surface-a", distanceMm: 2, extra: true }],
  ] as const) expect(() => commandNativeRequest(invalid[0], invalid[1], "surface-invalid")).toThrow();

  expect(featureGeometryKind("SurfaceSew")).toBe("surface");
  expect(featureGeometryKind("SurfaceOffset")).toBe("surface");
  expect(featureGeometryKind("SurfaceSewnSolid")).toBe("solid");
});

it("exposes signed surface thickening as strict native command 54 producing a solid", () => {
  expect(commandJsonSchema("CreateSurfaceThicken")).toMatchObject({ nativeType: 54, creation: { fixedCount: 1 } });
  expect(commandNativeRequest("CreateSurfaceThicken", { targetId: "sheet", thicknessMm: -2 }, "thickened")).toEqual({
    type: 54, fields: { featureId: "thickened", targetId: "sheet", thicknessMm: -2, toleranceMm: 1e-6 },
  });
  for (const invalid of [
    { targetId: "sheet", thicknessMm: 0 }, { targetId: "sheet", thicknessMm: 1e-7 },
    { targetId: "sheet", thicknessMm: 100001 }, { targetId: "sheet", thicknessMm: "1" },
    { targetId: "sheet", thicknessMm: 1, toleranceMm: 2 },
    { targetId: "sheet", thicknessMm: 1, unknown: true }, { targetId: "bad id", thicknessMm: 1 },
  ]) expect(() => commandNativeRequest("CreateSurfaceThicken", invalid, "thickened")).toThrow();
  expect(featureGeometryKind("SurfaceThicken")).toBe("solid");
});

it("exposes SurfaceSweep as strict native command 53 with ordered sketch roles", () => {
  expect(commandJsonSchema("CreateSurfaceSweep")).toMatchObject({
    nativeType: 53,
    creation: { fixedCount: 1 },
    selectionBindings: { profileSketchId: "firstSketch", pathSketchId: "secondSketch" },
  });
  expect(commandNativeRequest("CreateSurfaceSweep", {
    profileSketchId: "profile-a", pathSketchId: "path-b",
  }, "sweep-1")).toEqual({
    type: 53,
    fields: { featureId: "sweep-1", profileSketchId: "profile-a", pathSketchId: "path-b", toleranceMm: 1e-6 },
  });
  expect(commandNativeRequest("CreateSurfaceSweep", {
    profileSketchId: "profile-a", pathSketchId: "path-b", toleranceMm: 0.002,
  }, "sweep-2")).toEqual({
    type: 53,
    fields: { featureId: "sweep-2", profileSketchId: "profile-a", pathSketchId: "path-b", toleranceMm: 0.002 },
  });
  for (const invalid of [
    { profileSketchId: "profile-a", pathSketchId: "path-b", toleranceMm: 0 },
    { profileSketchId: "profile-a", pathSketchId: "path-b", toleranceMm: 1.1 },
    { profileSketchId: "profile-a", pathSketchId: "profile-a" },
    { profileSketchId: "../profile", pathSketchId: "path-b" },
    { profileSketchId: "profile-a", pathSketchId: "path-b", toleranceMm: "0.1" },
    { profileSketchId: "profile-a", pathSketchId: "path-b", extra: true },
  ]) expect(() => commandNativeRequest("CreateSurfaceSweep", invalid, "sweep-invalid")).toThrow();
  expect(featureGeometryKind("SurfaceSweep")).toBe("surface");
  expect(featureGeometryKind("SurfaceSewnSolid")).toBe("solid");
  expect(featureGeometryKind("SurfaceFaceThicken")).toBe("solid");
});

it("runtime schemas expose the actual creation budget including multi-hole commands", () => {
  expect(commandJsonSchema("CreateBox")).toHaveProperty("creation", { fixedCount: 1 });
  expect(commandJsonSchema("CreateHolePattern")).toHaveProperty("creation", { idArrayParameter: "featureIds" });
  expect(commandJsonSchema("UpdateSketch")).toHaveProperty("creation", { fixedCount: 0 });
});

it("exposes a persistent bounded inward STEP face pocket as native command 45", () => {
  expect(commandJsonSchema("CreateInwardFacePocket")).toMatchObject({
    nativeType: 45, creation: { fixedCount: 1 },
  });
  const valid = { sourceFeatureId: "imported", faceRole: "face.plane.+Z", distanceMm: 2 };
  expect(commandNativeRequest("CreateInwardFacePocket", valid, "pocket-1")).toEqual({
    type: 45, fields: { ...valid, featureId: "pocket-1" },
  });
  for (const invalid of [
    { ...valid, distanceMm: 0 },
    { ...valid, distanceMm: -1 },
    { ...valid, distanceMm: Number.NaN },
    { ...valid, faceRole: "face[0]" },
    { ...valid, faceRole: "" },
    { ...valid, unknown: true },
  ]) expect(() => commandNativeRequest("CreateInwardFacePocket", invalid, "pocket-1")).toThrow();
  expect(() => commandNativeRequest("CreateInwardFacePocket", valid, "bad:id")).toThrow();
});

it("exposes persistent planar face thickening as native command 46", () => {
  expect(commandJsonSchema("CreateSurfaceFaceThicken")).toMatchObject({ nativeType: 46, creation: { fixedCount: 1 } });
  const valid = { sourceFeatureId: "imported", faceRole: "box.+Z", thicknessMm: 3 };
  expect(commandNativeRequest("CreateSurfaceFaceThicken", valid, "thicken-1")).toEqual({
    type: 46, fields: { ...valid, featureId: "thicken-1" },
  });
  for (const invalid of [
    { ...valid, thicknessMm: 0 }, { ...valid, thicknessMm: -2 },
    { ...valid, thicknessMm: Number.NaN }, { ...valid, faceRole: "face[0]" },
    { ...valid, extra: "not allowed" },
  ]) expect(() => commandNativeRequest("CreateSurfaceFaceThicken", invalid, "thicken-1")).toThrow();
});

it("validates canonical bounded assembly mates as native command 47", () => {
  expect(commandJsonSchema("DefineAssemblyConstraint")).toMatchObject({ nativeType: 47, creation: { fixedCount: 0 } });
  const ground = { constraintId: "fix-a", kind: "ground", movingId: "instance-a" };
  const coincident = { constraintId: "align-b", kind: "coincident", movingId: "instance-b", fixedId: "instance-a" };
  const distance = { constraintId: "dist-b", kind: "distance", movingId: "instance-b", fixedId: "instance-a", axis: 2, distanceMm: -12 };
  for (const value of [ground, coincident, distance]) {
    expect(commandNativeRequest("DefineAssemblyConstraint", value)).toEqual({ type: 47, fields: value });
  }
  for (const invalid of [
    { ...ground, fixedId: "unexpected" }, { ...coincident, axis: 0 },
    { ...distance, axis: 3 }, { ...distance, distanceMm: Number.NaN },
    { ...coincident, fixedId: "" }, { ...distance, distanceMm: 2, untrusted: true },
  ]) expect(() => commandNativeRequest("DefineAssemblyConstraint", invalid)).toThrow();
});

it("validates captured analytic geometric mates and strict source bindings", () => {
  const face = { type: "face", featureId: "source-a", persistentFaceId: "box.+Z", geometryKind: "plane" };
  const edge = { type: "edge", featureId: "source-b", persistentEdgeId: "edge.cir.box.+Z", geometryKind: "circle" };
  const common = {
    constraintId: "mate-1", movingId: "instance-a", fixedId: "instance-b",
    captureRevision: 12, movingPickId: "instance-a:box.+Z", fixedPickId: "instance-b:box.+Z",
    movingSourceBinding: face, fixedSourceBinding: face,
  };
  const variants = [
    { ...common, kind: "concentric", movingSourceBinding: edge, fixedSourceBinding: edge },
    { ...common, kind: "parallel" },
    { ...common, kind: "perpendicular" },
    { ...common, kind: "angle", movingSourceBinding: edge, fixedSourceBinding: face, angleDeg: 30 },
  ];
  for (const value of variants)
    expect(commandNativeRequest("DefineAssemblyConstraint", value)).toEqual({ type: 47, fields: value });
  for (const invalid of [
    { ...variants[1], captureRevision: -1 },
    { ...variants[1], captureRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...variants[1], clientExtra: true },
    { ...variants[1], movingSourceBinding: { ...face, persistentFaceId: "source-a:box.+Z" } },
    { ...variants[0], fixedSourceBinding: { ...edge, persistentEdgeId: "x".repeat(513) } },
    { ...variants[1], movingSourceBinding: { ...face, selectionEntry: "0:1:3" } },
    { ...variants[1], movingSourceBinding: { ...face, persistentEdgeId: "edge.lin.x" } },
    { ...variants[3], angleDeg: 181 },
  ]) expect(() => commandNativeRequest("DefineAssemblyConstraint", invalid)).toThrow();
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

it("exports strict projection commands with zero allocation and wire parity", () => {
  const contract = JSON.parse(readFileSync(new URL("../../../schemas/session-control-v1.json", import.meta.url), "utf8")) as { definitions: Record<string, unknown> };
  const expand = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(expand);
    if (!value || typeof value !== "object") return value;
    const object = value as Record<string, unknown>;
    if (typeof object["$ref"] === "string")
      return expand(contract.definitions[(object["$ref"] as string).split("/").at(-1)!]);
    return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, expand(child)]));
  };
  const definition = { version: 1, operation: "projectEdges", sources: [
    { type: "edge", featureId: "source", persistentEdgeId: "source:edge.lin.box.+X~box.+Z" },
  ] } as const;
  for (const [id, type] of [["SetSketchProjection", 36], ["RemoveSketchProjection", 37], ["RequestSketchProjection", 38]] as const) {
    expect(commandJsonSchema(id)).toMatchObject({ nativeType: type, creation: { fixedCount: 0 } });
  }
  expect(commandNativeRequest("DefineConfiguration", { name: "variant-A", overrides: { box: { widthMm: 120 } } })).toEqual({
    type: 40, fields: { name: "variant-A", overrides: { box: { widthMm: 120 } } },
  });
  expect(commandNativeRequest("ActivateConfiguration", { name: "variant-A" })).toEqual({ type: 41, fields: { name: "variant-A" } });
  expect(commandNativeRequest("QueryConfigurations", {})).toEqual({ type: 42, fields: {} });
  for (const invalid of [
    { name: "", overrides: { box: { widthMm: 120 } } },
    { name: "variant", overrides: {} },
    { name: "variant", overrides: { box: {} } },
    { name: "variant", overrides: { box: { widthMm: Number.NaN } } },
    { name: "variant", overrides: { box: { widthMm: Number.POSITIVE_INFINITY } } },
  ]) expect(() => commandNativeRequest("DefineConfiguration", invalid)).toThrow();
  expect(() => commandNativeRequest("ActivateConfiguration", { name: "variant", extra: 1 })).toThrow();
  expect(() => commandNativeRequest("QueryConfigurations", { mutate: true })).toThrow();
  const parameters = commandJsonSchema("SetSketchProjection")!.parameters as { properties: { definition: unknown } };
  expect(parameters.properties.definition).toEqual(expand(contract.definitions["SketchProjectionDefinition"]));
  const definitionSchema = parameters.properties.definition as { maxJsonUtf8Bytes: number };
  expect(definitionSchema.maxJsonUtf8Bytes).toBe(65536);
  type SourceVariant = {
    properties: {
      type: { const?: string };
      persistentEdgeId?: { maxUtf8Bytes?: number };
      entityIds?: { items?: { maxUtf8Bytes?: number } };
    };
  };
  const projectionSources = (definitionSchema as unknown as {
    properties: { sources: { items: { anyOf: SourceVariant[] } } };
  }).properties.sources.items.anyOf;
  const edgeVariant = projectionSources.find(variant => variant.properties.type.const === "edge")!;
  const entityVariant = projectionSources.find(variant => variant.properties.type.const === "sketchEntities")!;
  expect(edgeVariant.properties.persistentEdgeId.maxUtf8Bytes).toBe(512);
  expect(entityVariant.properties.entityIds.items?.maxUtf8Bytes).toBe(512);
  const named = commandNativeRequest("SetSketchProjection", {
    featureId: "target", groupId: "linked", definition,
  });
  expect(named).toEqual({ type: 36, fields: { featureId: "target", groupId: "linked", definition } });
  expect(validateLegacyNativeCommand(36, named.fields)).toEqual(named);
  expect(validateLegacyNativeCommand(37, { featureId: "target", groupId: "linked" })).toEqual({
    type: 37, fields: { featureId: "target", groupId: "linked" },
  });
  expect(validateLegacyNativeCommand(38, { featureId: "target" })).toEqual({
    type: 38, fields: { featureId: "target" },
  });
});

it("rejects projection private/unknown fields, duplicates, wrong source kinds and UTF-8 overflow", () => {
  const base = { version: 1, operation: "projectEdges", sources: [
    { type: "sketchEntities", featureId: "source", entityIds: ["circle"] },
  ] };
  expect(() => commandNativeRequest("SetSketchProjection", {
    featureId: "target", groupId: "linked", definition: { ...base, bindings: { version: 1, entries: [] } },
  })).toThrow();
  expect(() => commandNativeRequest("SetSketchProjection", {
    featureId: "target", groupId: "linked", definition: { ...base, unknown: true },
  })).toThrow();
  expect(() => commandNativeRequest("SetSketchProjection", {
    featureId: "target", groupId: "linked", definition: { ...base, sources: [...base.sources, ...base.sources] },
  })).toThrow();
  expect(() => commandNativeRequest("SetSketchProjection", {
    featureId: "target", groupId: "linked", definition: { ...base, sources: [
      { type: "shape", featureId: "source" },
    ] },
  })).toThrow();
  expect(() => commandNativeRequest("RequestSketchProjection", {
    featureId: "target", privateBinding: "1:2",
  })).toThrow();

  const unicodeSources = Array.from({ length: 128 }, (_, index) => ({ type: "edge",
    featureId: "source", persistentEdgeId: `source:${"é".repeat(236)}:${index}` }));
  expect(JSON.stringify({ version: 1, operation: "projectEdges", sources: unicodeSources }).length).toBeLessThan(65536);
  expect(new TextEncoder().encode(JSON.stringify({ version: 1, operation: "projectEdges", sources: unicodeSources })).length).toBeGreaterThan(65536);
  expect(() => commandNativeRequest("SetSketchProjection", {
    featureId: "target", groupId: "linked",
    definition: { version: 1, operation: "projectEdges", sources: unicodeSources },
  })).toThrow(/UTF-8 bytes/);
});

it("keeps Unicode identifiers valid below 512 bytes and enforces exact definition bytes", () => {
  const edgeBelow = { type: "edge", featureId: "source",
    persistentEdgeId: `source:${"é".repeat(250)}` };
  const edgeAbove = { type: "edge", featureId: "source",
    persistentEdgeId: `source:${"é".repeat(253)}` };
  const entityBelow = { type: "sketchEntities", featureId: "source",
    entityIds: ["é".repeat(250)] };
  const entityAbove = { type: "sketchEntities", featureId: "source",
    entityIds: ["é".repeat(257)] };
  expect(edgeBelow.persistentEdgeId.length).toBeLessThan(512);
  expect(new TextEncoder().encode(edgeBelow.persistentEdgeId).length).toBeLessThan(512);
  expect(edgeAbove.persistentEdgeId.length).toBeLessThan(512);
  expect(new TextEncoder().encode(edgeAbove.persistentEdgeId).length).toBeGreaterThan(512);
  expect(() => commandNativeRequest("SetSketchProjection", { featureId: "target",
    groupId: "linked", definition: { version: 1, operation: "projectEdges",
      sources: [edgeBelow] } })).not.toThrow();
  expect(() => commandNativeRequest("SetSketchProjection", { featureId: "target",
    groupId: "linked", definition: { version: 1, operation: "projectEdges",
      sources: [edgeAbove] } })).toThrow();
  expect(() => commandNativeRequest("SetSketchProjection", { featureId: "target",
    groupId: "linked", definition: { version: 1, operation: "projectEdges",
      sources: [entityBelow] } })).not.toThrow();
  expect(() => commandNativeRequest("SetSketchProjection", { featureId: "target",
    groupId: "linked", definition: { version: 1, operation: "projectEdges",
      sources: [entityAbove] } })).toThrow();

  const entityIds = Array.from({ length: 128 }, (_, index) =>
    `entity-${index.toString().padStart(3, "0")}-${"a".repeat(455)}`);
  const definitionAtLimit = { version: 1, operation: "projectEdges",
    sources: [{ type: "sketchEntities", featureId: "source", entityIds }] };
  let remaining = 65536 - new TextEncoder().encode(JSON.stringify(definitionAtLimit)).length;
  for (let index = 0; index < entityIds.length - 1 && remaining > 0; index++) {
    const extra = Math.min(512 - entityIds[index].length, remaining);
    entityIds[index] += "a".repeat(extra);
    remaining -= extra;
  }
  expect(remaining).toBeLessThan(512 - entityIds.at(-1)!.length);
  entityIds[entityIds.length - 1] += "a".repeat(remaining);
  expect(new TextEncoder().encode(JSON.stringify(definitionAtLimit)).length).toBe(65536);
  expect(() => commandNativeRequest("SetSketchProjection", { featureId: "target",
    groupId: "linked", definition: definitionAtLimit })).not.toThrow();
  const oneByteOver = { ...definitionAtLimit,
    sources: [{ ...definitionAtLimit.sources[0],
      entityIds: [...entityIds.slice(0, -1), entityIds.at(-1)! + "a"] }] };
  expect(new TextEncoder().encode(JSON.stringify(oneByteOver)).length).toBe(65537);
  expect(() => commandNativeRequest("SetSketchProjection", { featureId: "target",
    groupId: "linked", definition: oneByteOver })).toThrow(/UTF-8 bytes/);
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
  const shell = commandJsonSchema("CreateShell")!;
  expect(shell.nativeType).toBe(61);
  expect(shell.parameters).toMatchObject({ type: "object",
    required: ["targetId", "faceRole", "thicknessMm"],
    properties: { thicknessMm: { type: "number", exclusiveMinimum: 0, maximum: 50000 } } });
});

it("registers four strict face-history commands with fenced owner references", () => {
  const face = { type: "face", featureId: "source-a", persistentFaceId: "source-a:box.+Z" };
  const common = { sourceFeatureId: "source-a", sourceFace: face, captureRevision: 7 };
  const move = { ...common, translationMm: { x: 0, y: 0, z: 2 },
    rotationDeg: { x: 0, y: 0, z: 0 }, pivotMm: { x: 0, y: 0, z: 0 } };
  const replacementFace = { type: "face", featureId: "support-b", persistentFaceId: "box.+X" };

  expect(commandJsonSchema("CreateMoveFace")!.nativeType).toBe(57);
  expect(commandJsonSchema("CreateOffsetFace")!.nativeType).toBe(58);
  expect(commandJsonSchema("CreateDeleteFace")!.nativeType).toBe(59);
  expect(commandJsonSchema("CreateReplaceFace")!.nativeType).toBe(60);
  expect(featureGeometryKind("MoveFace")).toBe("solid");
  expect(commandNativeRequest("CreateMoveFace", move, "move-a")).toEqual({
    type: 57, fields: { ...move, featureId: "move-a" },
  });
  expect(commandNativeRequest("CreateOffsetFace", { ...common, distanceMm: -1 }, "offset-a").type).toBe(58);
  expect(commandNativeRequest("CreateDeleteFace", common, "delete-a").type).toBe(59);
  expect(commandNativeRequest("CreateReplaceFace", { ...common, replacementFace }, "replace-a").type).toBe(60);

  expect(() => commandNativeRequest("CreateMoveFace", { ...move, captureRevision: Number.MAX_SAFE_INTEGER + 1 }, "move-b")).toThrow();
  expect(() => commandNativeRequest("CreateMoveFace", { ...move, sourceFace: { ...face, featureId: "other" } }, "move-b")).toThrow();
  expect(() => commandNativeRequest("CreateMoveFace", { ...move, sourceFace: { ...face, persistentFaceId: "other:box.+Z" } }, "move-b")).toThrow();
  expect(() => commandNativeRequest("CreateMoveFace", { ...move, sourceFace: { ...face, selectionEntry: "0:1:4" } }, "move-b")).toThrow();
  expect(() => commandNativeRequest("CreateOffsetFace", { ...common, distanceMm: 0 }, "offset-b")).toThrow();
  expect(() => commandNativeRequest("CreateDeleteFace", { ...common, distanceMm: 1 }, "delete-b")).toThrow();
});
