import { z } from "zod";
import { StableFeatureIdSchema } from "./session-control.js";

export const SurfacePersistentRoleIdSchema = z.string().min(1).max(512).refine(
  value => new TextEncoder().encode(value).length <= 512,
  { message: "persistent topology ID must be at most 512 UTF-8 bytes" },
);

function roleBelongsTo(featureId: string, roleId: string): boolean {
  return !roleId.includes(":") || roleId.startsWith(`${featureId}:`);
}

function validateRoleOwner(
  featureId: string,
  roleId: string,
  field: "persistentFaceId" | "persistentEdgeId",
  ctx: z.RefinementCtx,
): void {
  if (!roleBelongsTo(featureId, roleId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [field],
      message: `owner-qualified ${field} must belong to featureId`,
    });
  }
}

export const SurfaceFaceReferenceSchema = z.object({
  type: z.literal("face"),
  featureId: StableFeatureIdSchema,
  persistentFaceId: SurfacePersistentRoleIdSchema.describe(
    "Bare role or owner-qualified face ID; an owner prefix must match featureId.",
  ),
}).strict().superRefine((reference, ctx) => {
  validateRoleOwner(reference.featureId, reference.persistentFaceId, "persistentFaceId", ctx);
});

export const SurfaceEdgeReferenceSchema = z.object({
  type: z.literal("edge"),
  featureId: StableFeatureIdSchema,
  persistentEdgeId: SurfacePersistentRoleIdSchema.describe(
    "Bare role or owner-qualified edge ID; an owner prefix must match featureId.",
  ),
}).strict().superRefine((reference, ctx) => {
  validateRoleOwner(reference.featureId, reference.persistentEdgeId, "persistentEdgeId", ctx);
});

const finitePointMm = z.tuple([
  z.number().finite(), z.number().finite(), z.number().finite(),
]);
const finiteUv = z.tuple([z.number().finite(), z.number().finite()]);

export const SurfacePointResolveRequestSchema = z.object({
  targetId: StableFeatureIdSchema,
  pointMm: finitePointMm,
  persistentFaceId: SurfacePersistentRoleIdSchema.optional(),
  maxDistanceMm: z.number().finite().min(1e-6).max(1).default(0.5),
}).strict().superRefine((request, ctx) => {
  if (request.persistentFaceId !== undefined &&
      !roleBelongsTo(request.targetId, request.persistentFaceId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["persistentFaceId"],
      message: "owner-qualified persistentFaceId must belong to targetId",
    });
  }
});

export const SurfacePointResolveResultSchema = z.object({
  keepFace: SurfaceFaceReferenceSchema,
  keepUv: finiteUv,
  pointMm: finitePointMm,
  projectionDistanceMm: z.number().finite().min(0).max(1),
}).strict();

export type SurfacePointResolveRequest = z.input<typeof SurfacePointResolveRequestSchema>;
export type SurfacePointResolveParsedRequest = z.output<typeof SurfacePointResolveRequestSchema>;
export type SurfacePointResolveResult = z.infer<typeof SurfacePointResolveResultSchema>;
export type SurfaceFaceReference = z.infer<typeof SurfaceFaceReferenceSchema>;
export type SurfaceEdgeReference = z.infer<typeof SurfaceEdgeReferenceSchema>;
