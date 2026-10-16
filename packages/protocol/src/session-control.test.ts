// Slice 7: session-control.ts stays pinned to schemas/session-control-v1.json
// (single source of truth), and the fixed-message DTOs validate fixtures.
import { describe, expect, it } from "vitest";
import {
  ErrorReplySchema,
  HelloParamsSchema,
  InvokeParamsSchema,
  MeshHeaderSchema,
  MeshReplySchema,
  PairParamsSchema,
  AuthenticateParamsSchema,
  RequestMeshLODParamsSchema,
  REQUIRED_PARAMS,
  SESSION_SERVER_CAPABILITIES,
  SERVER_EVENTS,
  SESSION_EVENT_METADATA,
  SESSION_CONTROL_METHODS,
  SESSION_CONTROL_VERSION,
  TxnParamsSchema,
} from "./session-control.js";
import contract from "../../../schemas/session-control-v1.json" with { type: "json" };
import * as ContractMirror from "./session-control.js";
import {
  FeatureDescriptorSchema,
  SketchDescriptorSchema,
  SketchProjectionDefinitionSchema,
  SketchProjectionResultSchema,
} from "./sketch-projection.js";

const methods = contract.methods as { method: string; required: string[] }[];

describe("session control contract", () => {
  it("mirrors the JSON contract (methods + required fields + version)", () => {
    expect(SESSION_CONTROL_VERSION).toBe(contract.protocolVersion);
    expect([...SESSION_CONTROL_METHODS]).toEqual(
      methods.map((m) => m.method),
    );
    for (const m of methods) {
      expect(REQUIRED_PARAMS[m.method], m.method).toEqual(m.required);
    }
    expect(Object.keys(REQUIRED_PARAMS).sort()).toEqual(
      methods.map((m) => m.method).sort(),
    );
    expect([...SERVER_EVENTS]).toEqual(contract.serverEvents);
    expect(SESSION_EVENT_METADATA).toEqual(contract.serverEventMetadata);
    expect([...SESSION_SERVER_CAPABILITIES]).toEqual(contract.serverCapabilities);
  });

  it("validates fixed-message fixtures (and rejects missing required)", () => {
    expect(
      HelloParamsSchema.parse({ token: "t", protocolVersion: 1 }),
    ).toBeTruthy();
    expect(() =>
      HelloParamsSchema.parse({ protocolVersion: 1 }),
    ).toThrow();
    expect(InvokeParamsSchema.parse({ type: 3 })).toBeTruthy();
    expect(() => InvokeParamsSchema.parse({})).toThrow();
    expect(TxnParamsSchema.parse({ transactionId: "t1" })).toBeTruthy();
    expect(() => TxnParamsSchema.parse({})).toThrow();
    expect(
      ErrorReplySchema.parse({
        requestId: "r1",
        ok: false,
        errorCode: "BAD_PARAMS",
        error: "nope",
      }),
    ).toBeTruthy();
    expect(() =>
      ErrorReplySchema.parse({ requestId: "r1", ok: false }),
    ).toThrow();
  });

  it("accepts exact eight digit pairing codes without widening credential auth", () => {
    expect(PairParamsSchema.parse({ pairingToken: "00000007", deviceName: "Quest" })).toMatchObject({ pairingToken: "00000007" });
    expect(PairParamsSchema.parse({ pairingToken: "p".repeat(43), deviceName: "Quest" })).toBeTruthy();
    expect(() => PairParamsSchema.parse({ pairingToken: "1234567", deviceName: "Quest" })).toThrow();
    expect(() => AuthenticateParamsSchema.parse({ deviceId: "device-00000000-0000-0000-0000-000000000000", credential: "00000007" })).toThrow();
  });

  it("contracts operation metadata, stable client identity, capabilities, and replay errors", () => {
    const request = contract.envelope.request as {
      optional?: string[];
    };
    expect(request.optional).toEqual(["operationId", "sessionId"]);
    const hello = methods.find((method) => method.method === "hello") as {
      optional?: string[];
    };
    expect(hello.optional).toContain("clientId");
    expect(hello.optional).toContain("capabilities");
    expect(contract.wireErrorCodes).toEqual(expect.arrayContaining([
      "CLIENT_DISCONNECTED",
      "CONFLICT",
    ]));

    expect(ContractMirror.HelloParamsSchema.parse({
      token: "t",
      protocolVersion: 1,
      clientId: "client-550e8400-e29b-41d4-a716-446655440000",
      capabilities: ["operation-replay"],
    })).toBeTruthy();
    expect(() => ContractMirror.HelloParamsSchema.parse({
      token: "t",
      protocolVersion: 1,
      clientId: "client-desktop",
    })).toThrow();

    const metadataSchema = (ContractMirror as unknown as {
      RequestMetadataSchema?: { parse(value: unknown): unknown };
    }).RequestMetadataSchema;
    expect(metadataSchema).toBeDefined();
    expect(metadataSchema?.parse({
      operationId: "11111111-1111-4111-8111-111111111111",
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    })).toBeTruthy();
    expect(() => metadataSchema?.parse({ operationId: "invalid" })).toThrow();
  });

  it("validates typed requestMeshLOD identity and quality", () => {
    const params = {
      bodyId: "body-root",
      quality: 2,
      documentId: "doc-phase1",
      expectedRevision: 7,
    };
    expect(RequestMeshLODParamsSchema.parse(params)).toBeTruthy();
    for (const quality of [-1, 3, 1.5, "2"]) {
      expect(() => RequestMeshLODParamsSchema.parse({
        bodyId: "body-root",
        quality,
        documentId: "doc-phase1",
        expectedRevision: 7,
      })).toThrow();
    }
    expect(() => RequestMeshLODParamsSchema.parse({
      bodyId: "body-root",
      quality: 2,
      documentId: "doc-phase1",
      expectedRevision: -1,
    })).toThrow();
    const header = {
      nativeRequestId: "relay-7",
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      documentId: "doc-phase1",
      revision: 7,
      bodyId: "body-root",
      featureId: "tip-1",
      tipId: "tip-1",
      quality: 2,
      byteLength: 128,
    };
    expect(MeshHeaderSchema.parse(header)).toEqual(header);
    expect(MeshReplySchema.parse({ result: header })).toEqual({ result: header });
    expect(() => MeshHeaderSchema.parse({ ...header, byteLength: 67108865 })).toThrow();
    const instanceHeader = { ...header, instanceId: "instance-1", featureId: "instance-1", tipId: "instance-1" };
    expect(MeshHeaderSchema.parse(instanceHeader)).toEqual(instanceHeader);
    expect(RequestMeshLODParamsSchema.parse({ ...params, instanceId: "instance-1" })).toMatchObject({ instanceId: "instance-1" });
  });
});

describe("projection DTO contract", () => {
  const definition = {
    version: 1,
    operation: "projectEdges",
    sources: [{ type: "sketchEntities", featureId: "source", entityIds: ["circle"] }],
  };

  it("accepts strict healthy and broken query results with bounded display points", () => {
    const healthy = {
      featureId: "target",
      plane: { origin: [1, 2, 3], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
      geometryCurrent: true,
      status: "ok",
      error: "",
      blockingSourceIds: [],
      groups: [{ groupId: "linked", definition,
        sourceFeatureIds: ["source"], status: "ok", error: "",
        blockingSourceIds: [], generation: 2,
        edges: [{ memberIndex: 0, curveType: "circle", firstParameter: 0,
          lastParameter: 6.28, closed: true,
          pointsMm: Array.from({ length: 129 }, () => [0, 0, 0]) }] }],
    };
    expect(SketchProjectionResultSchema.parse(healthy)).toEqual(healthy);
    expect(SketchProjectionResultSchema.parse({ ...healthy, geometryCurrent: false,
      status: "unavailable", error: "missing geometry source source",
      blockingSourceIds: ["source"], groups: [{ ...healthy.groups[0],
        status: "broken", error: "source unavailable", edges: [] }] })).toBeTruthy();
    expect(() => SketchProjectionResultSchema.parse({ ...healthy, privateBindings: [] })).toThrow();
    expect(() => SketchProjectionResultSchema.parse({ ...healthy, groups: [{
      ...healthy.groups[0], edges: [{ ...healthy.groups[0].edges[0],
        pointsMm: Array.from({ length: 130 }, () => [0, 0, 0]) }],
    }] })).toThrow();
  });

  it("keeps legacy descriptors valid and validates optional current-geometry state", () => {
    expect(SketchDescriptorSchema.parse({ featureId: "legacy-sketch" })).toEqual({ featureId: "legacy-sketch" });
    expect(SketchDescriptorSchema.parse({ featureId: "target", projectionGroups: [] })).toBeTruthy();
    expect(FeatureDescriptorSchema.parse({ featureId: "solid", type: "Extrude",
      geometryCurrent: false, status: "unavailable", error: "blocked by source",
      blockingSourceIds: ["source"] })).toBeTruthy();
  });

  it("rejects private, unknown, duplicate and wrong-kind definitions plus UTF-8 overflow", () => {
    expect(SketchProjectionDefinitionSchema.parse(definition)).toEqual(definition);
    for (const invalid of [
      { ...definition, bindings: { version: 1, entries: [] } },
      { ...definition, sources: [definition.sources[0], definition.sources[0]] },
      { ...definition, sources: [{ type: "shape", featureId: "source" }] },
    ]) expect(() => SketchProjectionDefinitionSchema.parse(invalid)).toThrow();

    const sources = Array.from({ length: 128 }, (_, index) => ({ type: "edge",
      featureId: "source", persistentEdgeId: `source:${"é".repeat(236)}:${index}` }));
    const large = { version: 1, operation: "projectEdges", sources };
    expect(JSON.stringify(large).length).toBeLessThan(65536);
    expect(new TextEncoder().encode(JSON.stringify(large)).length).toBeGreaterThan(65536);
    expect(() => SketchProjectionDefinitionSchema.parse(large)).toThrow(/UTF-8 bytes/);
  });
});
