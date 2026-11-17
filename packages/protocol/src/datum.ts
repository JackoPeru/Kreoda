import { z } from "zod";
import { StableFeatureIdSchema } from "./session-control.js";

const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
const position = z.tuple([coordinate, coordinate, coordinate]);
const namingEntry = z.string().max(128).regex(/^\d+(?::\d+)+$/).optional();
const datumRef = z.object({ type: z.literal("datum"), featureId: StableFeatureIdSchema }).strict();
const principalPlane = z.object({ type: z.literal("principal"), planeKind: z.enum(["XY", "XZ", "YZ"]) }).strict();
const coordinates = z.object({ type: z.literal("coordinates"), positionMm: position }).strict();

export const DatumPlaneRefSchema = z.discriminatedUnion("type", [principalPlane, datumRef,
  z.object({ type: z.literal("face"), featureId: StableFeatureIdSchema,
    persistentFaceId: z.string().min(1).max(512), selectionEntry: namingEntry }).strict(),
]);
export const DatumAxisRefSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("principal"), axis: z.enum(["X", "Y", "Z"]) }).strict(), datumRef,
  z.object({ type: z.literal("edge"), featureId: StableFeatureIdSchema,
    persistentEdgeId: z.string().min(1).max(512), selectionEntry: namingEntry }).strict(),
]);
export const DatumPointRefSchema = z.discriminatedUnion("type", [coordinates, datumRef]);
export const DatumPlaneDefinitionSchema = z.discriminatedUnion("type", [principalPlane,
  z.object({ type: z.literal("offset"), base: DatumPlaneRefSchema, offsetMm: coordinate }).strict(),
  z.object({ type: z.literal("mid"), first: DatumPlaneRefSchema, second: DatumPlaneRefSchema }).strict(),
  z.object({ type: z.literal("angle"), base: DatumPlaneRefSchema, axis: DatumAxisRefSchema,
    angleDeg: z.number().finite().min(-360).max(360) }).strict(),
  z.object({ type: z.literal("threePoint"), first: DatumPointRefSchema,
    second: DatumPointRefSchema, third: DatumPointRefSchema }).strict(),
]);
export const DatumAxisDefinitionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("twoPoint"), first: DatumPointRefSchema, second: DatumPointRefSchema }).strict(),
  z.object({ type: z.literal("planeNormal"), plane: DatumPlaneRefSchema, through: DatumPointRefSchema.optional() }).strict(),
  z.object({ type: z.literal("planeIntersection"), first: DatumPlaneRefSchema, second: DatumPlaneRefSchema }).strict(),
]);
export const DatumPointDefinitionSchema = z.discriminatedUnion("type", [coordinates,
  z.object({ type: z.literal("midpoint"), first: DatumPointRefSchema, second: DatumPointRefSchema }).strict(),
]);
export const DatumDefinitionSchema = z.union([DatumPlaneDefinitionSchema, DatumAxisDefinitionSchema, DatumPointDefinitionSchema]);
export type DatumPlaneDefinition = z.infer<typeof DatumPlaneDefinitionSchema>;
export type DatumAxisDefinition = z.infer<typeof DatumAxisDefinitionSchema>;
export type DatumPointDefinition = z.infer<typeof DatumPointDefinitionSchema>;
export type DatumDefinition = z.infer<typeof DatumDefinitionSchema>;
