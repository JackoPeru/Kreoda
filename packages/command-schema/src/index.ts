// @kreoda/command-schema — central command registry types (§19).
// One definition drives toolbar, context menu, palette, shortcuts, AI tools.

import { z } from "zod";

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
    label: "Set dimension",
    beginnerLabel: "Set size",
    description: "Change one canonical mm parameter (one Undo step).",
    icon: "ruler",
    parameterSchema: z.object({
      featureId: z.string().min(1),
      paramName: z.string().min(1),
      valueMm: z.number().finite().positive().max(100000),
    }),
    supportsPreview: true,
    beginnerVisible: false,
    advancedVisible: true,
    availability: () => always,
  },
  {
    id: "CreateSketch",
    label: "Sketch",
    beginnerLabel: "Draw a shape",
    description: "New constrained 2D sketch on a principal plane.",
    icon: "pencil",
    parameterSchema: z.object({
      planeKind: z.enum(["XY", "XZ", "YZ"]).default("XY"),
    }),
    supportsPreview: false,
    beginnerVisible: true,
    advancedVisible: true,
    availability: () => always,
  },
  {
    id: "CreateExtrude",
    label: "Extrude",
    beginnerLabel: "Pull sketch",
    description: "Extrude the selected sketch into a solid.",
    icon: "arrow-up-from-line",
    parameterSchema: z.object({
      sketchId: z.string().min(1),
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
    label: "Boolean",
    beginnerLabel: "Combine",
    description: "Fuse (combine), cut (subtract) or intersect two solids.",
    icon: "combine",
    parameterSchema: z.object({
      op: z.enum(["fuse", "cut", "common"]),
      targetId: z.string().min(1),
      toolId: z.string().min(1),
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
    label: "Hole",
    beginnerLabel: "Make hole",
    description: "Cut a parametric hole in the selected face.",
    icon: "circle-dot",
    parameterSchema: z.object({
      targetId: z.string().min(1),
      faceRole: z.string().min(1),
      xMm: z.number().finite(),
      yMm: z.number().finite(),
      diameterMm: z.number().finite().positive().max(50000),
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
    id: "CreateFillet",
    label: "Fillet",
    beginnerLabel: "Round edge",
    description: "Round the selected edges with a constant radius.",
    icon: "spline",
    parameterSchema: z.object({
      targetId: z.string().min(1),
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
    label: "Chamfer",
    beginnerLabel: "Cut corner",
    description: "Chamfer the selected edges with a symmetric distance.",
    icon: "slice",
    parameterSchema: z.object({
      targetId: z.string().min(1),
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
    id: "Undo",
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
];
