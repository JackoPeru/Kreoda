import { expect, it } from "vitest";
import { HelloParamsSchema, InvokeParamsSchema, NamedCommandParamsSchema, RequestMetadataSchema } from "./session-control.js";
import { CONTRACT_SCHEMA_SHA256, SESSION_CONTROL_METHODS } from "./generated/session-metadata.js";
import validators from "./generated/session-validators.js";

it("uses generated schemas without coercing transport fields", () => {
  expect(CONTRACT_SCHEMA_SHA256).toMatch(/^[a-f0-9]{64}$/);
  expect(SESSION_CONTROL_METHODS).toContain("command");
  for (const baseRevision of [-1, 0.5, "1"]) {
    expect(InvokeParamsSchema.safeParse({ type: 6, baseRevision }).success).toBe(false);
    expect(NamedCommandParamsSchema.safeParse({ commandId: "Undo", baseRevision }).success).toBe(false);
  }
  expect(HelloParamsSchema.safeParse({ token: "t", protocolVersion: "1" }).success).toBe(false);
  expect(RequestMetadataSchema.safeParse({ operationId: "11111111-1111-4111-8111-111111111111" }).success).toBe(false);
});

it("validates snapshot and delta wire shapes generated from the same source", () => {
  const snapshot = { sessionId: "11111111-1111-4111-8111-111111111111", documentId: "doc", revision: 1,
    features: [], sketches: [], bodies: [] };
  expect(validators.SessionSnapshotPayload(snapshot)).toBe(true);
  expect(validators.SessionSnapshotPayload({ ...snapshot, revision: -1 })).toBe(false);
  const delta = { event: "delta", sessionId: snapshot.sessionId, documentId: "doc", originClientId: "local",
    revision: 2, baseRevision: 1, newRevision: 2, added: [], updated: [], removedIds: [], changedMeshIds: [], referenceRemaps: [], warnings: [] };
  expect(validators.SessionIncrementalEvent(delta)).toBe(true);
  expect(validators.SessionIncrementalEvent({ ...delta, added: [{ kind: "unknown", id: "a", index: 0, value: {} }] })).toBe(false);
  expect(validators.SessionIncrementalEvent({ ...delta, changedMeshIds: [3] })).toBe(false);
});
