import { z } from "zod";
import validators from "./generated/session-validators.js";
import { SESSION_DTO_NAMES } from "./generated/session-metadata.js";
import type * as DTO from "./generated/session-dtos.js";

function schema<T>(name: (typeof SESSION_DTO_NAMES)[number]): z.ZodType<T> {
  return z.custom<T>(value => validators[name](value), {
    message: "Invalid session control " + name,
  });
}

export const SketchProjectionSourceSchema = schema<DTO.SketchProjectionSource>("SketchProjectionSource");
export const SketchProjectionDefinitionSchema = schema<DTO.SketchProjectionDefinition>("SketchProjectionDefinition")
  .superRefine((value, ctx) => {
    const definition = value as unknown as {
      operation: string;
      sources: { type: string; featureId: string; persistentEdgeId?: string; entityIds?: string[] }[];
    };
    if (new TextEncoder().encode(JSON.stringify(value)).length > 65536)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "projection definition exceeds 65536 UTF-8 bytes" });
    const identities = new Set<string>();
    const shapeSources = definition.sources.filter(source => source.type === "shape");
    for (const [index, source] of definition.sources.entries()) {
      const identity = source.type === "edge"
        ? JSON.stringify([source.type, source.featureId, source.persistentEdgeId])
        : source.type === "sketchEntities"
          ? JSON.stringify([source.type, source.featureId, source.entityIds])
          : JSON.stringify([source.type, source.featureId]);
      if (identities.has(identity))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sources", index], message: "duplicate projection source" });
      identities.add(identity);
      if (source.type === "edge" && source.persistentEdgeId &&
          (!source.persistentEdgeId.startsWith(`${source.featureId}:`) ||
           new TextEncoder().encode(source.persistentEdgeId).length > 512))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sources", index, "persistentEdgeId"], message: "invalid owner-qualified projection edge id" });
      if (source.type === "sketchEntities") {
        const entityIds = source.entityIds ?? [];
        const unique = new Set(entityIds);
        if (unique.size !== entityIds.length || entityIds.some(id => new TextEncoder().encode(id).length > 512))
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sources", index, "entityIds"], message: "projection entityIds must be unique and at most 512 UTF-8 bytes" });
      }
    }
    if (definition.operation === "projectEdges" ? shapeSources.length > 0
        : shapeSources.length !== 1 || definition.sources.length !== 1)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sources"], message: "invalid projection source kind for operation" });
  });

export const SketchProjectionGroupSummarySchema = schema<DTO.SketchProjectionGroupSummary>("SketchProjectionGroupSummary");
export const SketchProjectionDisplayEdgeSchema = schema<DTO.SketchProjectionDisplayEdge>("SketchProjectionDisplayEdge");
export const SketchProjectionGroupResultSchema = schema<DTO.SketchProjectionGroupResult>("SketchProjectionGroupResult");
export const SketchProjectionResultSchema = schema<DTO.SketchProjectionResult>("SketchProjectionResult");
export const SketchDescriptorSchema = schema<DTO.SketchDescriptor>("SketchDescriptor");
export const FeatureDescriptorSchema = schema<DTO.FeatureDescriptor>("FeatureDescriptor");

export type {
  SketchProjectionSource,
  SketchProjectionDefinition,
  SketchProjectionGroupSummary,
  SketchProjectionDisplayEdge,
  SketchProjectionGroupResult,
  SketchProjectionResult,
  SketchDescriptor,
  FeatureDescriptor,
} from "./generated/session-dtos.js";
export type SketchProjectionPointMm = [number, number, number];
