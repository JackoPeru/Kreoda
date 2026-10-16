// @kreoda/command-schema — central command registry types (§19).
// One definition drives toolbar, context menu, palette, shortcuts, AI tools.

import { z } from "zod";
import { CommandType, SketchModelSchema, StableFeatureIdSchema, SESSION_STABLE_FEATURE_ID_SCHEMA } from "@kreoda/protocol";
import { DatumPlaneDefinitionSchema, DatumAxisDefinitionSchema, DatumPointDefinitionSchema, DatumDefinitionSchema } from "@kreoda/protocol";
import { zodToJsonSchema, ignoreOverride } from "zod-to-json-schema";
import { commandCreationRule } from "./native-command.js";
export { commandNativeRequest, commandCreatesFeature, validateLegacyNativeCommand } from "./native-command.js";

export const SelectionKindSchema = z.enum([
  "body",
  "face",
  "edge",
  "vertex",
  "sketch",
  "datumPlane",
  "datumAxis",
  "datumPoint",
]);
export type SelectionKind = z.infer<typeof SelectionKindSchema>;

export interface CommandContext {
  selection: { kind: SelectionKind; persistentId: string }[];
  beginnerMode: boolean;
}

export interface AvailabilityResult {
  available: boolean;
  reason?: string;
}

export interface CadCommandDefinition<P = unknown> {
  id: string;
  nativeType: number;
  label: string;
  beginnerLabel: string;
  description: string;
  icon: string;
  parameterSchema: z.ZodType<P>;
  supportsPreview: boolean;
  beginnerVisible: boolean;
  advancedVisible: boolean;
  availability: (ctx: CommandContext) => AvailabilityResult;
  selectionBindings?: Record<string, "owner" | "edges" | "faceRole" | "sketch">;
  optionalSelectionBindings?: Record<string, "datumPlane">;
}

export const CreateBoxParams = z.object({
  widthMm: z.number().finite().positive().max(100000),
  heightMm: z.number().finite().positive().max(100000),
  depthMm: z.number().finite().positive().max(100000),
});

const always: AvailabilityResult = { available: true };
const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;
const ProjectionSourceSchema = z.union([
  z.object({ type: z.literal("edge"), featureId: StableFeatureIdSchema,
    persistentEdgeId: z.string().min(1).max(512) }).strict(),
  z.object({ type: z.literal("shape"), featureId: StableFeatureIdSchema }).strict(),
  z.object({ type: z.literal("sketchEntities"), featureId: StableFeatureIdSchema,
    entityIds: z.array(z.string().min(1).max(512)).min(1).max(128) }).strict(),
]);
const ProjectionDefinitionSchema = z.object({
  version: z.literal(1),
  operation: z.enum(["projectEdges", "silhouette", "section"]),
  sources: z.array(ProjectionSourceSchema).min(1).max(128),
}).strict().superRefine((definition, ctx) => {
  if (utf8Bytes(JSON.stringify(definition)) > 65536)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "projection definition exceeds 65536 UTF-8 bytes" });
  const identities = new Set<string>();
  const shapes = definition.sources.filter(source => source.type === "shape");
  for (const [index, source] of definition.sources.entries()) {
    const identity = JSON.stringify(source);
    if (identities.has(identity))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sources", index], message: "duplicate projection source" });
    identities.add(identity);
    if (source.type === "edge") {
      if (utf8Bytes(source.persistentEdgeId) > 512)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sources", index, "persistentEdgeId"], message: "persistentEdgeId exceeds 512 UTF-8 bytes" });
      if (!source.persistentEdgeId.startsWith(`${source.featureId}:`))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sources", index, "persistentEdgeId"], message: "edge source id must be owner-qualified" });
    } else if (source.type === "sketchEntities") {
      const entityIds = new Set<string>();
      for (const [entityIndex, entityId] of source.entityIds.entries()) {
        if (utf8Bytes(entityId) > 512)
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sources", index, "entityIds", entityIndex], message: "entity id exceeds 512 UTF-8 bytes" });
        if (entityIds.has(entityId))
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sources", index, "entityIds", entityIndex], message: "projection entityIds must be unique" });
        entityIds.add(entityId);
      }
    }
  }
  if (definition.operation === "projectEdges" ? shapes.length > 0
      : shapes.length !== 1 || definition.sources.length !== 1)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sources"], message: definition.operation === "projectEdges"
      ? "projectEdges accepts edge or sketchEntities sources"
      : `${definition.operation} requires exactly one whole-shape source` });
});

export const COMMANDS: CadCommandDefinition[] = [
  {
    id: "CreateBox",
    nativeType: CommandType.CreateBox,
    label: "Box",
    beginnerLabel: "Add box",
    description: "Create a parametric box (B-Rep primitive).",
    icon: "box",
    parameterSchema: CreateBoxParams,
    supportsPreview: true,
    beginnerVisible: true,
    advancedVisible: true,
    availability: () => always,
  },
  {
    id: "CreateCylinder",
    nativeType: CommandType.CreateCylinder,
    label: "Cylinder",
    beginnerLabel: "Add tube",
    description: "Create a parametric cylinder, base at origin, axis +Z.",
    icon: "cylinder",
    parameterSchema: z.object({
      radiusMm: z.number().finite().positive().max(50000),
      heightMm: z.number().finite().positive().max(100000),
    }),
    supportsPreview: true,
    beginnerVisible: true,
    advancedVisible: true,
    availability: () => always,
  },
  {
    id: "CreateSphere",
    nativeType: CommandType.CreateSphere,
    label: "Sphere",
    beginnerLabel: "Add ball",
    description: "Create a parametric sphere centered at origin.",
    icon: "circle",
    parameterSchema: z.object({
      radiusMm: z.number().finite().positive().max(50000),
    }),
    supportsPreview: true,
    beginnerVisible: true,
    advancedVisible: true,
    availability: () => always,
  },
  {
    id: "SetDimension",
    nativeType: CommandType.SetFeatureParameter,
    label: "Set dimension",
    beginnerLabel: "Set size",
    description: "Change canonical parameters atomically (one Undo step).",
    icon: "ruler",
    parameterSchema: z.object({
      featureId: StableFeatureIdSchema,
      paramName: z.string().min(1),
      // Bare value; optional when an expression replaces it (core ignores
      // valueMm whenever expression is non-empty).
      // C3: must accept legal Instance placement (0/negative) and 0-degree
      // angles — range is enforced core-side (honest REBUILD_FAILED).
      // Dimensions stay positive via core CheckValueRange; the schema stays
      // permissive so the core owns the single source of truth.
      valueMm: z.number().finite().max(1000000).min(-1000000).optional(),
      // Phase 9a: formula replacing the bare value (validated core-side).
      expression: z.string().max(256).optional(),
      parameterValues: z.record(z.string().min(1).max(128).refine(name => name !== "__proto__", "unknown parameter"), z.number().finite().min(-1000000).max(1000000))
        .refine(values => Object.keys(values).length <= 5, "at most five additional parameters").optional(),
    }).refine(value => !value.parameterValues || !Object.hasOwn(value.parameterValues, value.paramName), {
      message: "additional parameters cannot repeat the primary parameter",
    }).refine((value) => value.valueMm !== undefined || !!value.expression?.trim(), {
      message: "provide valueMm or a non-empty expression",
    }),
    supportsPreview: true,
    beginnerVisible: false,
    advancedVisible: true,
    availability: () => always,
  },
  {
    id: "CreateSketch",
    optionalSelectionBindings: { supportRef: "datumPlane" },
    nativeType: CommandType.CreateSketch,
    label: "Sketch",
    beginnerLabel: "Draw a shape",
    description: "New constrained 2D sketch on a principal or native datum plane.",
    icon: "pencil",
    parameterSchema: z.object({
      planeKind: z.enum(["XY", "XZ", "YZ"]).default("XY"),
      supportRef: StableFeatureIdSchema.optional(),
      model: SketchModelSchema.optional(),
    }),
    supportsPreview: false,
    beginnerVisible: true,
    advancedVisible: true,
    availability: () => always,
  },
  {
    id: "CreateExtrude",
    selectionBindings: { sketchId: "sketch" },
    nativeType: CommandType.CreateExtrude,
    label: "Extrude",
    beginnerLabel: "Pull sketch",
    description: "Extrude the selected sketch into a solid.",
    icon: "arrow-up-from-line",
    parameterSchema: z.object({
      sketchId: StableFeatureIdSchema,
      distanceMm: z.number().positive().max(100000),
    }),
    supportsPreview: true,
    beginnerVisible: true,
    advancedVisible: true,
    availability: (ctx) =>
      ctx.selection.some((s) => s.kind === "sketch")
        ? always
        : { available: false, reason: "Select a sketch first" },
  },
  {
    id: "CreateBoolean",
    nativeType: CommandType.CreateBoolean,
    label: "Boolean",
    beginnerLabel: "Combine",
    description: "Fuse (combine), cut (subtract) or intersect two solids.",
    icon: "combine",
    parameterSchema: z.object({
      op: z.enum(["fuse", "cut", "common"]),
      targetId: StableFeatureIdSchema,
      toolId: StableFeatureIdSchema,
    }),
    supportsPreview: false,
    beginnerVisible: true,
    advancedVisible: true,
    availability: (ctx) => {
      const bodies = ctx.selection.filter((s) => s.kind === "body");
      return bodies.length >= 2
        ? always
        : { available: false, reason: "Select two solids first" };
    },
  },
  {
    id: "CreateHole",
    selectionBindings: { targetId: "owner", faceRole: "faceRole" },
    nativeType: CommandType.CreateHole,
    label: "Hole",
    beginnerLabel: "Make hole",
    description: "Cut a parametric hole in the selected face.",
    icon: "circle-dot",
    parameterSchema: z.object({
      insertBeforeId: StableFeatureIdSchema.optional(),
      targetId: StableFeatureIdSchema,
      faceRole: z.string().min(1),
      xMm: z.number().finite(),
      yMm: z.number().finite(),
      // M7: cap matches the core gate (hole diameter (0, 100000]);
      // the core re-validates and owns the honest error.
      diameterMm: z.number().finite().positive().max(100000),
      depthMode: z.enum(["throughAll", "blind"]),
      depthMm: z.number().finite().nonnegative().max(100000).default(0),
    }),
    supportsPreview: false,
    beginnerVisible: true,
    advancedVisible: true,
    availability: (ctx) =>
      ctx.selection.some((s) => s.kind === "face")
        ? always
        : { available: false, reason: "Select a face first" },
  },
  {
    // M11: corner/center patterns in ONE transaction (one Undo step).
    id: "CreateHolePattern",
    nativeType: CommandType.CreateHolePattern,
    label: "Hole pattern",
    beginnerLabel: "Make holes",
    description: "Cut 1–4 parametric holes in one Undo step.",
    icon: "circle-dot",
    parameterSchema: z.object({
      targetId: StableFeatureIdSchema,
      faceRole: z.string().min(1),
      featureIds: z.array(StableFeatureIdSchema).min(1).max(4),
      pointsMm: z.array(z.number().finite()).min(2).max(8),
      // M7: cap matches the core gate (hole diameter (0, 100000]).
      diameterMm: z.number().finite().positive().max(100000),
      depthMode: z.enum(["throughAll", "blind"]),
      depthMm: z.number().finite().nonnegative().max(100000).default(0),
      // m11: ids match points 1:1 (checked again core-side as BAD_PARAMS).
    }).refine((v) => v.featureIds.length * 2 === v.pointsMm.length, {
      message: "hole pattern featureIds must match points 1:1",
    }),
    supportsPreview: false,
    beginnerVisible: false,
    advancedVisible: true,
    availability: (ctx) =>
      ctx.selection.some((s) => s.kind === "face" || s.kind === "body")
        ? always
        : { available: false, reason: "Select a solid body first" },
  },
  {
    id: "CreateFillet",
    selectionBindings: { targetId: "owner", edgeIds: "edges" },
    nativeType: CommandType.CreateFillet,
    label: "Fillet",
    beginnerLabel: "Round edge",
    description: "Round the selected edges with a constant radius.",
    icon: "spline",
    parameterSchema: z.object({
      targetId: StableFeatureIdSchema,
      edgeIds: z.array(z.string().min(1)).min(1),
      radiusMm: z.number().finite().positive().max(50000),
    }),
    supportsPreview: false,
    beginnerVisible: true,
    advancedVisible: true,
    availability: (ctx) =>
      ctx.selection.some((s) => s.kind === "edge")
        ? always
        : { available: false, reason: "Select an edge first" },
  },
  {
    id: "CreateChamfer",
    selectionBindings: { targetId: "owner", edgeIds: "edges" },
    nativeType: CommandType.CreateChamfer,
    label: "Chamfer",
    beginnerLabel: "Cut corner",
    description: "Chamfer the selected edges with a symmetric distance.",
    icon: "slice",
    parameterSchema: z.object({
      targetId: StableFeatureIdSchema,
      edgeIds: z.array(z.string().min(1)).min(1),
      distanceMm: z.number().finite().positive().max(50000),
    }),
    supportsPreview: false,
    beginnerVisible: true,
    advancedVisible: true,
    availability: (ctx) =>
      ctx.selection.some((s) => s.kind === "edge")
        ? always
        : { available: false, reason: "Select an edge first" },
  },
  {
    id: "CreateInstance",
    nativeType: CommandType.CreateInstance,
    label: "Instance",
    beginnerLabel: "Copy placed",
    description:
      "Rigid placed copy of the selected solid (translation mm + ZYX degrees).",
    icon: "copy",
    parameterSchema: z.object({
      targetId: StableFeatureIdSchema,
      txMm: z.number().finite().min(-1000000).max(1000000).default(0),
      tyMm: z.number().finite().min(-1000000).max(1000000).default(0),
      tzMm: z.number().finite().min(-1000000).max(1000000).default(0),
      rxDeg: z.number().finite().default(0),
      ryDeg: z.number().finite().default(0),
      rzDeg: z.number().finite().default(0),
    }),
    supportsPreview: false,
    beginnerVisible: true,
    advancedVisible: true,
    availability: (ctx) =>
      ctx.selection.some((s) => s.kind === "body")
        ? always
        : { available: false, reason: "Select a solid body first" },
  },
  {
    id: "Undo",
    nativeType: CommandType.Undo,
    label: "Undo",
    beginnerLabel: "Undo",
    description: "Undo the last modeling transaction (OCAF).",
    icon: "undo",
    parameterSchema: z.object({}),
    supportsPreview: false,
    beginnerVisible: false,
    advancedVisible: true,
    availability: () => always,
  },
  {
    id: "Redo",
    nativeType: CommandType.Redo,
    label: "Redo",
    beginnerLabel: "Redo",
    description: "Redo an undone modeling transaction (OCAF).",
    icon: "redo",
    parameterSchema: z.object({}),
    supportsPreview: false,
    beginnerVisible: false,
    advancedVisible: true,
    availability: () => always,
  },
  {
    id: "UpdateSketch", nativeType: CommandType.UpdateSketch,
    label: "Update sketch", beginnerLabel: "Update sketch",
    description: "Replace a canonical constrained sketch model (one Undo step).",
    icon: "pencil", supportsPreview: false, beginnerVisible: false, advancedVisible: false,
    parameterSchema: z.object({
      featureId: StableFeatureIdSchema, model: SketchModelSchema,
      dragPointId: z.string().min(1).optional(),
      dragX: z.number().finite().optional(), dragY: z.number().finite().optional(),
    }).refine(value => value.dragPointId === undefined
      ? value.dragX === undefined && value.dragY === undefined
      : value.dragX !== undefined && value.dragY !== undefined, {
      message: "dragPointId, dragX and dragY must be provided together",
    }),
    availability: () => always,
  },
  {
    id: "CreateRevolve", nativeType: CommandType.CreateRevolve,
    selectionBindings: { sketchId: "sketch" },
    label: "Revolve", beginnerLabel: "Revolve sketch",
    description: "Revolve a sketch around its canonical axis by an angle in degrees.",
    icon: "rotate-cw", supportsPreview: false, beginnerVisible: false, advancedVisible: true,
    parameterSchema: z.object({ sketchId: StableFeatureIdSchema, angleDeg: z.number().finite().positive().max(360) }),
    availability: (ctx) => ctx.selection.some((item) => item.kind === "sketch") ? always : { available: false, reason: "Select a sketch first" },
  },
  {
    id: "CreateDatumPlane", nativeType: CommandType.CreateDatumPlane,
    label: "Datum plane", beginnerLabel: "Reference plane",
    description: "Create a principal, offset, mid, angled or three-point native reference plane.",
    icon: "square", parameterSchema: z.object({ definition: DatumPlaneDefinitionSchema }),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true, availability: () => always,
  },
  {
    id: "CreateDatumAxis", nativeType: CommandType.CreateDatumAxis,
    label: "Datum axis", beginnerLabel: "Reference axis",
    description: "Create a native reference axis through two points, normal to a plane or at two planes' intersection.",
    icon: "move", parameterSchema: z.object({ definition: DatumAxisDefinitionSchema }),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true, availability: () => always,
  },
  {
    id: "CreateDatumPoint", nativeType: CommandType.CreateDatumPoint,
    label: "Datum point", beginnerLabel: "Reference point",
    description: "Create a native reference point at coordinates or halfway between two points.",
    icon: "crosshair", parameterSchema: z.object({ definition: DatumPointDefinitionSchema }),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true, availability: () => always,
  },
  {
    id: "UpdateDatum", nativeType: CommandType.UpdateDatum,
    label: "Edit datum", beginnerLabel: "Edit reference",
    description: "Replace a datum definition while preserving its identity and recomputing dependent native geometry.",
    icon: "pencil", parameterSchema: z.object({ featureId: StableFeatureIdSchema, definition: DatumDefinitionSchema }),
    supportsPreview: false, beginnerVisible: false, advancedVisible: false, availability: () => always,
  },
  {
    id: "RequestDatum", nativeType: CommandType.RequestDatum,
    label: "Inspect datum", beginnerLabel: "Inspect reference",
    description: "Read a datum's native definition, resolved geometry, source identities and status without mutation.",
    icon: "info", parameterSchema: z.object({ featureId: StableFeatureIdSchema }),
    supportsPreview: false, beginnerVisible: false, advancedVisible: false, availability: () => always,
  },
  {
    id: "SetSketchProjection", nativeType: CommandType.SetSketchProjection,
    label: "Set sketch projection", beginnerLabel: "Set projection",
    description: "Create or replace one sketch-owned associative projection group.",
    icon: "link", parameterSchema: z.object({ featureId: StableFeatureIdSchema,
      groupId: StableFeatureIdSchema, definition: ProjectionDefinitionSchema }).strict(),
    supportsPreview: false, beginnerVisible: false, advancedVisible: false, availability: () => always,
  },
  {
    id: "RemoveSketchProjection", nativeType: CommandType.RemoveSketchProjection,
    label: "Remove sketch projection", beginnerLabel: "Remove projection",
    description: "Remove one sketch-owned projection group and release its source references.",
    icon: "unlink", parameterSchema: z.object({ featureId: StableFeatureIdSchema,
      groupId: StableFeatureIdSchema }).strict(),
    supportsPreview: false, beginnerVisible: false, advancedVisible: false, availability: () => always,
  },
  {
    id: "RequestSketchProjection", nativeType: CommandType.RequestSketchProjection,
    label: "Inspect sketch projection", beginnerLabel: "Inspect projection",
    description: "Read current projection definitions, status and bounded display geometry.",
    icon: "info", parameterSchema: z.object({ featureId: StableFeatureIdSchema,
      groupId: StableFeatureIdSchema.optional() }).strict(),
    supportsPreview: false, beginnerVisible: false, advancedVisible: false, availability: () => always,
  },
  {
    id: "DeleteFeature", nativeType: CommandType.DeleteFeature,
    label: "Delete feature", beginnerLabel: "Delete feature",
    description: "Delete a feature or sketch only when it has no dependent geometry or formulas.",
    icon: "trash", supportsPreview: false, beginnerVisible: false, advancedVisible: false,
    parameterSchema: z.object({ featureId: StableFeatureIdSchema }),
    availability: () => always,
  },
];

/** Export parameter schemas from the same Zod registry used at execution. */
export function commandJsonSchema(id: string) {
  const definition = COMMANDS.find((command) => command.id === id);
  if (!definition) return null;
  const parameters = zodToJsonSchema(definition.parameterSchema, { $refStrategy: "none", target: "jsonSchema7",
    override: def => def === StableFeatureIdSchema._def ? { ...SESSION_STABLE_FEATURE_ID_SCHEMA } : ignoreOverride,
  }) as Record<string, unknown>;
  if (id === "SetSketchProjection") {
    const record = (value: unknown) => value as Record<string, unknown>;
    const properties = record(parameters["properties"]);
    const projection = record(properties["definition"]);
    const projectionProperties = record(projection["properties"]);
    const sources = record(projectionProperties["sources"]);
    sources["uniqueItems"] = true;
    const variants = record(sources["items"])["anyOf"];
    if (Array.isArray(variants)) {
      for (const variant of variants) {
        const sourceProperties = record(record(variant)["properties"]);
        if (record(sourceProperties["type"])["const"] === "sketchEntities")
          record(sourceProperties["entityIds"])["uniqueItems"] = true;
      }
    }
  }
  return { id: definition.id, nativeType: definition.nativeType,
    creation: commandCreationRule(id),
    description: definition.description,
    supportsPreview: definition.supportsPreview,
    selectionBindings: definition.selectionBindings ?? {},
    optionalSelectionBindings: definition.optionalSelectionBindings ?? {},
    parameters,
  };
}
