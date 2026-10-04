import { z } from "zod";
import { CommandType, SketchModelSchema, StableFeatureIdSchema } from "@kreoda/protocol";
import { COMMANDS } from "./index.js";

const FeatureId = StableFeatureIdSchema;
const JSON_CONTROL = new Map<number, z.ZodType>([
  [CommandType.GetCoreInfo, z.object({})],
  [CommandType.CreateDocument, z.object({})],
  [CommandType.RequestSnapshot, z.object({})],
  [CommandType.RequestSketch, z.object({ featureId: FeatureId })],
  [CommandType.RequestFaceInfo, z.object({ featureId: FeatureId, faceRole: z.string().min(1) })],
]);

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}
function parse(schema: z.ZodType, parameters: unknown): Record<string, unknown> {
  const parsed = schema.safeParse(parameters);
  if (!parsed.success) fail("BAD_PARAMS", parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  return parsed.data as Record<string, unknown>;
}

export function commandCreatesFeature(commandId: string): boolean {
  return COMMANDS.some(definition => definition.id === commandId) && commandId.startsWith("Create") && commandId !== "CreateHolePattern";
}

/** One registry validation and one wire translation for named and integer calls. */
export function commandNativeRequest(commandId: string, parameters: unknown, featureId?: unknown): { type: number; fields: Record<string, unknown> } {
  const definition = COMMANDS.find(command => command.id === commandId);
  if (!definition) fail("NOT_IMPLEMENTED", "unsupported CAD command: " + commandId);
  const fields = parse(definition.parameterSchema, parameters);
  if (commandCreatesFeature(commandId)) {
    const id = FeatureId.safeParse(featureId);
    if (!id.success) fail("BAD_PARAMS", "creation featureId must be 1–128 letters, digits, underscores or hyphens");
    fields["featureId"] = id.data;
  }
  if (commandId === "CreateSketch" && fields["model"] === undefined) fields["model"] = SketchModelSchema.parse({});
  if (commandId === "CreateHolePattern") {
    fields["points"] = fields["pointsMm"];
    delete fields["pointsMm"];
  }
  return { type: definition.nativeType, fields };
}

/** Normalize valid old native field aliases before using the same registry. */
export function validateLegacyNativeCommand(type: number, fields: Record<string, unknown>): { type: number; fields: Record<string, unknown> } {
  const definition = COMMANDS.find(command => command.nativeType === type);
  if (!definition) {
    const schema = JSON_CONTROL.get(type);
    if (!schema) fail("NOT_IMPLEMENTED", type === CommandType.RequestMesh ?
      "binary meshes require the data transport; invoke carries JSON control only" : "unsupported session invoke type: " + type);
    return { type, fields: parse(schema, fields) };
  }
  const parameters = { ...fields };
  const aliases: Record<string, string> = {
    widthMm: "width", heightMm: "height", depthMm: "depth", radiusMm: "radius",
    diameterMm: "diameter", distanceMm: "distance", angleDeg: "angle", valueMm: "value", xMm: "x", yMm: "y",
  };
  for (const [canonical, alias] of Object.entries(aliases))
    if (!Object.hasOwn(parameters, canonical) && Object.hasOwn(parameters, alias)) parameters[canonical] = parameters[alias];
  if (definition.id === "CreateHole" || definition.id === "CreateHolePattern") {
    if (!parameters["faceRole"] && typeof parameters["faceId"] === "string") parameters["faceRole"] = parameters["faceId"].split(":").slice(1).join(":") || parameters["faceId"];
    if (!Object.hasOwn(parameters, "depthMode")) parameters["depthMode"] = "throughAll";
    if (definition.id === "CreateHole") {
      if (!Object.hasOwn(parameters, "xMm")) parameters["xMm"] = 0;
      if (!Object.hasOwn(parameters, "yMm")) parameters["yMm"] = 0;
    } else if (!Object.hasOwn(parameters, "pointsMm")) parameters["pointsMm"] = parameters["points"];
  }
  if ((definition.id === "CreateSketch" || definition.id === "UpdateSketch") && !Object.hasOwn(parameters, "model"))
    parameters["model"] = SketchModelSchema.parse(parameters);
  return commandNativeRequest(definition.id, parameters, fields["featureId"]);
}
