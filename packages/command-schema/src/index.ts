// @kreoda/command-schema — central command registry types (§19).
// One definition drives toolbar, context menu, palette, shortcuts, AI tools.

import { z } from "zod";
import {
  CommandType, SketchModelSchema, StableFeatureIdSchema, SESSION_STABLE_FEATURE_ID_SCHEMA,
  SurfaceEdgeReferenceSchema, SurfaceFaceReferenceSchema,
} from "@kreoda/protocol";
import { DatumPlaneDefinitionSchema, DatumAxisDefinitionSchema, DatumPointDefinitionSchema, DatumDefinitionSchema } from "@kreoda/protocol";
import { zodToJsonSchema, ignoreOverride } from "zod-to-json-schema";
import { commandCreationRule } from "./native-command.js";
export { commandNativeRequest, commandCreatesFeature, validateLegacyNativeCommand } from "./native-command.js";

const AssemblySourceRoleSchema = z.string().min(1).max(512)
  .refine(role => !role.includes(":"), "source role must be local to its feature");
const AssemblySourceBindingSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("face"), featureId: StableFeatureIdSchema,
    persistentFaceId: AssemblySourceRoleSchema, geometryKind: z.enum(["plane", "cylinder"]),
  }).strict(),
  z.object({
    type: z.literal("edge"), featureId: StableFeatureIdSchema,
    persistentEdgeId: AssemblySourceRoleSchema, geometryKind: z.enum(["circle", "line"]),
  }).strict(),
]);
const GeometricAssemblyConstraintShape = {
  constraintId: StableFeatureIdSchema,
  movingId: StableFeatureIdSchema,
  fixedId: StableFeatureIdSchema,
  captureRevision: z.number().int().nonnegative().refine(Number.isSafeInteger),
  movingPickId: z.string().min(1),
  fixedPickId: z.string().min(1),
};

/** Surface bodies are identified only by their canonical feature types.
 * Names such as SurfaceLoftSewnSolid, SurfaceSewnSolid and SurfaceFaceThicken still produce solids. */
export function featureGeometryKind(type: string): "surface" | "solid" {
  return type === "SurfaceExtrude" || type === "SurfaceRevolve" ||
    type === "SurfaceLoft" || type === "SurfaceSew" || type === "SurfaceOffset" ||
    type === "SurfaceSweep" || type === "SurfaceTrim" || type === "SurfaceExtend"
    ? "surface"
    : "solid";
}

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
  selectionBindings?: Record<string, "owner" | "owners" | "edges" | "faceRole" | "sketch" | "firstSketch" | "secondSketch">;
  optionalSelectionBindings?: Record<string, "datumPlane">;
}

export const CreateBoxParams = z.object({
  widthMm: z.number().finite().positive().max(100000),
  heightMm: z.number().finite().positive().max(100000),
  depthMm: z.number().finite().positive().max(100000),
});

const always: AvailabilityResult = { available: true };
const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;
const DirectFaceReferenceSchema = z.object({
  type: z.literal("face"),
  featureId: StableFeatureIdSchema,
  persistentFaceId: z.string().min(1).max(512)
    .refine(role => utf8Bytes(role) <= 512),
}).strict().superRefine((reference, ctx) => {
  const separator = reference.persistentFaceId.indexOf(":");
  if (separator >= 0 &&
      (reference.persistentFaceId.slice(0, separator) !== reference.featureId ||
       reference.persistentFaceId.slice(separator + 1).length === 0 ||
       reference.persistentFaceId.slice(separator + 1).includes(":"))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom,
      path: ["persistentFaceId"],
      message: "persistentFaceId must be local or qualified by its exact owner" });
  }
});
const DirectFaceVectorSchema = z.object({
  x: z.number().finite(), y: z.number().finite(), z: z.number().finite(),
}).strict();
const DirectFaceRevisionSchema =
  z.number().int().nonnegative().refine(Number.isSafeInteger);
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
    id: "CreateSurfaceLoftSewnSolid", nativeType: CommandType.CreateSurfaceLoftSewnSolid,
    label: "Loft sewn solid", beginnerLabel: "Create loft",
    description: "Create an associative sewn solid through ordered sketch sections.",
    icon: "layers", parameterSchema: z.object({ sketchIds: z.array(StableFeatureIdSchema).min(2).max(128) }).strict(),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true, availability: () => always,
  },
  {
    id: "CreateSurfaceExtrude", nativeType: CommandType.CreateSurfaceExtrude,
    label: "Extrude surface", beginnerLabel: "Create surface",
    description: "Create an uncapped surface body from exact sketch boundary wires.",
    icon: "layers", parameterSchema: z.object({
      sketchId: StableFeatureIdSchema,
      distanceMm: z.number().finite().max(100000).min(-100000).refine(value => value !== 0),
    }).strict(),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true, availability: () => always,
  },
  {
    id: "CreateSurfaceRevolve", nativeType: CommandType.CreateSurfaceRevolve,
    label: "Revolve surface", beginnerLabel: "Create revolved surface",
    description: "Revolve exact sketch boundary wires about a normalized world axis without caps.",
    icon: "rotate-3d", parameterSchema: z.object({
      sketchId: StableFeatureIdSchema,
      angleDeg: z.number().finite().positive().max(360),
      axisOriginXMm: z.number().finite().min(-100000).max(100000).default(0),
      axisOriginYMm: z.number().finite().min(-100000).max(100000).default(0),
      axisOriginZMm: z.number().finite().min(-100000).max(100000).default(0),
      axisX: z.number().finite().min(-1).max(1).default(1),
      axisY: z.number().finite().min(-1).max(1).default(0),
      axisZ: z.number().finite().min(-1).max(1).default(0),
    }).strict().refine(({ axisX, axisY, axisZ }) => axisX ** 2 + axisY ** 2 + axisZ ** 2 > 1e-18),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true, availability: () => always,
  },
  {
    id: "CreateSurfaceLoft", nativeType: CommandType.CreateSurfaceLoft,
    label: "Loft surface", beginnerLabel: "Create lofted surface",
    description: "Create an uncapped surface through ordered, compatible sketch sections.",
    icon: "layers", parameterSchema: z.object({
      sketchIds: z.array(StableFeatureIdSchema).min(2).max(128)
        .refine(ids => new Set(ids).size === ids.length),
    }).strict(),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true, availability: () => always,
  },
  {
    id: "CreateSurfaceSew", nativeType: CommandType.CreateSurfaceSew,
    label: "Sew surfaces", beginnerLabel: "Sew surfaces",
    description: "Join exact surface B-Reps into one connected surface or a truly closed solid.",
    icon: "layers", parameterSchema: z.object({
      featureIds: z.array(StableFeatureIdSchema).min(1).max(128)
        .refine(ids => new Set(ids).size === ids.length),
      toleranceMm: z.number().finite().min(1e-7).max(1).default(0.01),
      makeSolid: z.boolean().default(false),
    }).strict(),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true,
    availability: () => always, selectionBindings: { featureIds: "owners" },
  },
  {
    id: "CreateSurfaceOffset", nativeType: CommandType.CreateSurfaceOffset,
    label: "Offset surface", beginnerLabel: "Offset surface",
    description: "Create an exact signed offset of a surface B-Rep.",
    icon: "layers", parameterSchema: z.object({
      targetId: StableFeatureIdSchema,
      distanceMm: z.number().finite().refine(value => Math.abs(value) >= 1e-6 && Math.abs(value) <= 100000),
      toleranceMm: z.number().finite().min(1e-7).max(1).default(1e-6),
    }).strict(),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true,
    availability: () => always, selectionBindings: { targetId: "owner" },
  },
  {
    id: "CreateSurfaceSweep", nativeType: CommandType.CreateSurfaceSweep,
    label: "Sweep surface", beginnerLabel: "Sweep surface",
    description: "Sweep exact sketch boundary wires along a connected sketch path without caps.",
    icon: "layers", parameterSchema: z.object({
      profileSketchId: StableFeatureIdSchema,
      pathSketchId: StableFeatureIdSchema,
      toleranceMm: z.number().finite().min(1e-7).max(1).default(1e-6),
    }).strict().refine(({ profileSketchId, pathSketchId }) => profileSketchId !== pathSketchId),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true,
    availability: (ctx) => ctx.selection.length === 2 && ctx.selection.every(reference => reference.kind === "sketch")
      ? always : { available: false, reason: "Select exactly two sketches in profile then path order" },
    selectionBindings: { profileSketchId: "firstSketch", pathSketchId: "secondSketch" },
  },
  {
    id: "CreateSurfaceThicken", nativeType: CommandType.CreateSurfaceThicken,
    label: "Thicken surface", beginnerLabel: "Create solid from surface",
    description: "Create an independent editable solid with signed thickness from a connected surface body.",
    icon: "layers", parameterSchema: z.object({
      targetId: StableFeatureIdSchema,
      thicknessMm: z.number().finite().refine(value => Math.abs(value) >= 1e-6 && Math.abs(value) <= 100000),
      toleranceMm: z.number().finite().min(1e-7).max(1).default(1e-6),
    }).strict(),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true,
    availability: () => always, selectionBindings: { targetId: "owner" },
  },
  {
    id: "CreateSurfaceTrim", nativeType: CommandType.CreateSurfaceTrim,
    label: "Trim surface", beginnerLabel: "Trim surface",
    description: "Keep the connected surface region selected by an exact face and UV point.",
    icon: "scissors", parameterSchema: z.object({
      targetId: StableFeatureIdSchema,
      toolId: StableFeatureIdSchema,
      keepFace: SurfaceFaceReferenceSchema.describe("Face reference owned by targetId; internal OCAF bindings are not accepted."),
      keepUv: z.tuple([z.number().finite(), z.number().finite()]),
      toleranceMm: z.number().finite().min(1e-7).max(1).default(1e-6),
    }).strict().superRefine((parameters, ctx) => {
      if (parameters.targetId === parameters.toolId)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["toolId"], message: "toolId must differ from targetId" });
      if (parameters.keepFace.featureId !== parameters.targetId)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["keepFace", "featureId"], message: "keepFace must belong to targetId" });
    }),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true, availability: () => always,
  },
  {
    id: "CreateSurfaceExtend", nativeType: CommandType.CreateSurfaceExtend,
    label: "Extend surface", beginnerLabel: "Extend surface",
    description: "Extend one free outer boundary by a measured spatial chord on its exact support.",
    icon: "move-3d", parameterSchema: z.object({
      targetId: StableFeatureIdSchema,
      boundaryEdge: SurfaceEdgeReferenceSchema.describe("Edge reference owned by targetId; internal OCAF bindings are not accepted."),
      distanceMm: z.number().finite().min(1e-6).max(100000),
      toleranceMm: z.number().finite().min(1e-7).max(1).default(1e-6),
    }).strict().superRefine((parameters, ctx) => {
      if (parameters.boundaryEdge.featureId !== parameters.targetId)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["boundaryEdge", "featureId"], message: "boundaryEdge must belong to targetId" });
    }),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true, availability: () => always,
  },
  {
    id: "DefineConfiguration", nativeType: CommandType.DefineConfiguration,
    label: "Define configuration", beginnerLabel: "Save variant",
    description: "Store validated parameter overrides for a named model configuration.",
    icon: "layers", parameterSchema: z.object({
      name: z.string().min(1).max(64),
      overrides: z.record(StableFeatureIdSchema, z.record(z.string().min(1).max(128), z.number().finite()).refine(values => Object.keys(values).length > 0)).refine(values => Object.keys(values).length > 0),
    }).strict(),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true, availability: () => always,
  },
  {
    id: "ActivateConfiguration", nativeType: CommandType.ActivateConfiguration,
    label: "Activate configuration", beginnerLabel: "Switch variant",
    description: "Apply an existing named configuration atomically.",
    icon: "layers", parameterSchema: z.object({ name: z.string().min(1).max(64) }).strict(),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true, availability: () => always,
  },
  {
    id: "QueryConfigurations", nativeType: CommandType.QueryConfigurations,
    label: "Inspect configurations", beginnerLabel: "List variants",
    description: "Read the current configuration and saved names without changing model revision.",
    icon: "info", parameterSchema: z.object({}).strict(),
    supportsPreview: false, beginnerVisible: false, advancedVisible: false, availability: () => always,
  },
  {
    id: "CreateOutwardFacePush", nativeType: CommandType.CreateOutwardFacePush,
    label: "Push planar face", beginnerLabel: "Extend selected face",
    description: "Push a persistent planar face outwards by a positive distance.",
    icon: "move-3d", parameterSchema: z.object({
      sourceFeatureId: StableFeatureIdSchema,
      faceRole: z.string().min(1).max(512).refine(role => !/(?:^|[.:])(?:face|edge)\[\d+\]/.test(role)),
      distanceMm: z.number().finite().positive().max(100000),
    }).strict(),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true, availability: () => always,
  },
  {
    id: "CreateMoveFace", nativeType: CommandType.CreateMoveFace,
    label: "Move face", beginnerLabel: "Move face",
    description: "Move one captured planar face by a rigid transform while preserving the remaining convex planar supports.",
    icon: "move-3d", parameterSchema: z.object({
      sourceFeatureId: StableFeatureIdSchema,
      sourceFace: DirectFaceReferenceSchema,
      captureRevision: DirectFaceRevisionSchema,
      translationMm: DirectFaceVectorSchema,
      rotationDeg: DirectFaceVectorSchema,
      pivotMm: DirectFaceVectorSchema,
    }).strict().superRefine((parameters, ctx) => {
      if (parameters.sourceFace.featureId !== parameters.sourceFeatureId)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceFace", "featureId"],
          message: "sourceFace must belong to sourceFeatureId" });
    }),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true, availability: () => always,
  },
  {
    id: "CreateOffsetFace", nativeType: CommandType.CreateOffsetFace,
    label: "Offset face", beginnerLabel: "Offset face",
    description: "Apply a signed exact OCCT offset to one planar, cylindrical or spherical face.",
    icon: "move-3d", parameterSchema: z.object({
      sourceFeatureId: StableFeatureIdSchema,
      sourceFace: DirectFaceReferenceSchema,
      captureRevision: DirectFaceRevisionSchema,
      distanceMm: z.number().finite().refine(value => value !== 0),
    }).strict().superRefine((parameters, ctx) => {
      if (parameters.sourceFace.featureId !== parameters.sourceFeatureId)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceFace", "featureId"],
          message: "sourceFace must belong to sourceFeatureId" });
    }),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true, availability: () => always,
  },
  {
    id: "CreateDeleteFace", nativeType: CommandType.CreateDeleteFace,
    label: "Delete face", beginnerLabel: "Delete face",
    description: "Remove and heal one captured face using OCCT defeaturing.",
    icon: "scissors", parameterSchema: z.object({
      sourceFeatureId: StableFeatureIdSchema,
      sourceFace: DirectFaceReferenceSchema,
      captureRevision: DirectFaceRevisionSchema,
    }).strict().superRefine((parameters, ctx) => {
      if (parameters.sourceFace.featureId !== parameters.sourceFeatureId)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceFace", "featureId"],
          message: "sourceFace must belong to sourceFeatureId" });
    }),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true, availability: () => always,
  },
  {
    id: "CreateReplaceFace", nativeType: CommandType.CreateReplaceFace,
    label: "Replace face", beginnerLabel: "Replace face",
    description: "Replace one captured planar support with a separate compatible planar face.",
    icon: "layers", parameterSchema: z.object({
      sourceFeatureId: StableFeatureIdSchema,
      sourceFace: DirectFaceReferenceSchema,
      captureRevision: DirectFaceRevisionSchema,
      replacementFace: DirectFaceReferenceSchema,
    }).strict().superRefine((parameters, ctx) => {
      if (parameters.sourceFace.featureId !== parameters.sourceFeatureId)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceFace", "featureId"],
          message: "sourceFace must belong to sourceFeatureId" });
    }),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true, availability: () => always,
  },
  {
    id: "CreateInwardFacePocket", nativeType: CommandType.CreateInwardFacePocket,
    label: "Pocket planar face", beginnerLabel: "Cut into selected face",
    description: "Create a persistent inward pocket on a semantic planar face of an imported STEP solid.",
    icon: "move-3d", parameterSchema: z.object({
      sourceFeatureId: StableFeatureIdSchema,
      faceRole: z.string().min(1).max(512).refine(role => !/(?:^|[.:])(?:face|edge)\[\d+\]/.test(role)),
      distanceMm: z.number().finite().positive().max(100000),
    }).strict(),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true, availability: () => always,
  },
  {
    id: "CreateSurfaceFaceThicken", nativeType: CommandType.CreateSurfaceFaceThicken,
    label: "Thicken planar face", beginnerLabel: "Create solid from face",
    description: "Create a separate persistent solid by thickening one semantic planar source face; does not implement arbitrary surface offset.",
    icon: "layers", parameterSchema: z.object({
      sourceFeatureId: StableFeatureIdSchema,
      faceRole: z.string().min(1).max(512).refine(role => !/(?:^|[.:])(?:face|edge)\[\d+\]/.test(role)),
      thicknessMm: z.number().finite().positive().max(100000),
    }).strict(),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true, availability: () => always,
  },
  {
    id: "DefineAssemblyConstraint", nativeType: CommandType.DefineAssemblyConstraint,
    label: "Constrain assembly instances", beginnerLabel: "Mate components",
    description: "Ground rigid instances, constrain origins, or mate selected analytic faces and axes.",
    icon: "link", parameterSchema: z.discriminatedUnion("kind", [
      z.object({ constraintId: StableFeatureIdSchema, kind: z.literal("ground"), movingId: StableFeatureIdSchema }).strict(),
      z.object({ constraintId: StableFeatureIdSchema, kind: z.literal("coincident"), movingId: StableFeatureIdSchema, fixedId: StableFeatureIdSchema }).strict(),
      z.object({ constraintId: StableFeatureIdSchema, kind: z.literal("distance"), movingId: StableFeatureIdSchema, fixedId: StableFeatureIdSchema,
        axis: z.number().int().min(0).max(2), distanceMm: z.number().finite() }).strict(),
      z.object({ ...GeometricAssemblyConstraintShape, kind: z.literal("concentric"),
        movingSourceBinding: AssemblySourceBindingSchema, fixedSourceBinding: AssemblySourceBindingSchema }).strict(),
      z.object({ ...GeometricAssemblyConstraintShape, kind: z.literal("parallel"),
        movingSourceBinding: AssemblySourceBindingSchema, fixedSourceBinding: AssemblySourceBindingSchema }).strict(),
      z.object({ ...GeometricAssemblyConstraintShape, kind: z.literal("perpendicular"),
        movingSourceBinding: AssemblySourceBindingSchema, fixedSourceBinding: AssemblySourceBindingSchema }).strict(),
      z.object({ ...GeometricAssemblyConstraintShape, kind: z.literal("angle"),
        movingSourceBinding: AssemblySourceBindingSchema, fixedSourceBinding: AssemblySourceBindingSchema,
        angleDeg: z.number().finite().min(0).max(180) }).strict(),
    ]),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true, availability: () => always,
  },
  {
    id: "SetBodyVisibility", nativeType: CommandType.SetBodyVisibility,
    label: "Body visibility", beginnerLabel: "Show or hide body",
    description: "Persistently toggle displayed body without deleting history or dependencies.",
    icon: "eye", parameterSchema: z.object({ bodyId: z.string().min(1), visible: z.boolean() }).strict(),
    supportsPreview: false, beginnerVisible: false, advancedVisible: true, availability: () => always,
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
    projection["maxJsonUtf8Bytes"] = 65536;
    const projectionProperties = record(projection["properties"]);
    const sources = record(projectionProperties["sources"]);
    sources["uniqueItems"] = true;
    const variants = record(sources["items"])["anyOf"];
    if (Array.isArray(variants)) {
      for (const variant of variants) {
        const sourceProperties = record(record(variant)["properties"]);
        const sourceType = record(sourceProperties["type"])["const"];
        if (sourceType === "edge") {
          record(sourceProperties["persistentEdgeId"])["maxUtf8Bytes"] = 512;
        } else if (sourceType === "sketchEntities") {
          const entityIds = record(sourceProperties["entityIds"]);
          record(entityIds["items"])["maxUtf8Bytes"] = 512;
          record(sourceProperties["entityIds"])["uniqueItems"] = true;
        }
      }
    }
  }
  if (id === "CreateSurfaceTrim" || id === "CreateSurfaceExtend") {
    const record = (value: unknown) => value as Record<string, unknown>;
    const properties = record(parameters["properties"]);
    const referenceName = id === "CreateSurfaceTrim" ? "keepFace" : "boundaryEdge";
    const roleName = id === "CreateSurfaceTrim" ? "persistentFaceId" : "persistentEdgeId";
    const referenceProperties = record(record(properties[referenceName])["properties"]);
    const role = record(referenceProperties[roleName]);
    role["maxLength"] = 512;
    role["maxUtf8Bytes"] = 512;
  }
  if (id === "CreateMoveFace" || id === "CreateOffsetFace" ||
      id === "CreateDeleteFace" || id === "CreateReplaceFace") {
    const record = (value: unknown) => value as Record<string, unknown>;
    const properties = record(parameters["properties"]);
    for (const referenceName of ["sourceFace", "replacementFace"]) {
      if (!(referenceName in properties)) continue;
      const referenceProperties = record(record(properties[referenceName])["properties"]);
      const role = record(referenceProperties["persistentFaceId"]);
      role["maxLength"] = 512;
      role["maxUtf8Bytes"] = 512;
    }
    if ("captureRevision" in properties)
      record(properties["captureRevision"])["maximum"] = Number.MAX_SAFE_INTEGER;
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
