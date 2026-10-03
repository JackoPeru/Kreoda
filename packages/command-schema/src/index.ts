// @kreoda/command-schema — central command registry types (§19).
// One definition drives toolbar, context menu, palette, shortcuts, AI tools.

import { z } from "zod";
import { CommandType, SketchModelSchema, StableFeatureIdSchema } from "@kreoda/protocol";
import { zodToJsonSchema } from "zod-to-json-schema";
export { commandNativeRequest, commandCreatesFeature, validateLegacyNativeCommand } from "./native-command.js";

export const SelectionKindSchema = z.enum([
  "body",
  "face",
  "edge",
  "vertex",
  "sketch",
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
}

export const CreateBoxParams = z.object({
  widthMm: z.number().finite().positive().max(100000),
  heightMm: z.number().finite().positive().max(100000),
  depthMm: z.number().finite().positive().max(100000),
});

const always: AvailabilityResult = { available: true };

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
    description: "Change one canonical mm parameter (one Undo step).",
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
    nativeType: CommandType.CreateSketch,
    label: "Sketch",
    beginnerLabel: "Draw a shape",
    description: "New constrained 2D sketch on a principal plane.",
    icon: "pencil",
    parameterSchema: z.object({
      planeKind: z.enum(["XY", "XZ", "YZ"]).default("XY"),
      model: SketchModelSchema.optional(),
    }),
    supportsPreview: false,
    beginnerVisible: true,
    advancedVisible: true,
    availability: () => always,
  },
  {
    id: "CreateExtrude",
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
    supportsPreview: true,
    beginnerVisible: true,
    advancedVisible: true,
    availability: (ctx) =>
      ctx.selection.some((s) => s.kind === "edge")
        ? always
        : { available: false, reason: "Select an edge first" },
  },
  {
    id: "CreateChamfer",
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
    label: "Revolve", beginnerLabel: "Revolve sketch",
    description: "Revolve a sketch around its canonical axis by an angle in degrees.",
    icon: "rotate-cw", supportsPreview: false, beginnerVisible: false, advancedVisible: true,
    parameterSchema: z.object({ sketchId: StableFeatureIdSchema, angleDeg: z.number().finite().positive().max(360) }),
    availability: (ctx) => ctx.selection.some((item) => item.kind === "sketch") ? always : { available: false, reason: "Select a sketch first" },
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
  return { id: definition.id, nativeType: definition.nativeType,
    description: definition.description,
    parameters: zodToJsonSchema(definition.parameterSchema, { $refStrategy: "none", target: "jsonSchema7" }),
  };
}
