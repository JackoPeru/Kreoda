// Slice 7: session-control.ts stays pinned to schemas/session-control-v1.json
// (single source of truth), and the fixed-message DTOs validate fixtures.
import { describe, expect, it } from "vitest";
import {
  ErrorReplySchema,
  HelloParamsSchema,
  InvokeParamsSchema,
  MeshHeaderSchema,
  MeshReplySchema,
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
    expect(RequestMeshLODParamsSchema.parse({
      bodyId: "body-root",
      quality: 2,
      documentId: "doc-phase1",
      expectedRevision: 7,
    })).toBeTruthy();
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
  });
});
