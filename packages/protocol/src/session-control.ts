// Slice 7: typed mirror of schemas/session-control-v1.json (the session
// CONTROL plane: WebSocket JSON, protocolVersion = 1). The JSON file is the
// single source of truth; session-control.test.ts pins this mirror to it.
// Data plane (binary mesh) stays in schemas/cad_protocol.fbs + decodeMesh*.

import { z } from "zod";

export const SESSION_CONTROL_VERSION = 1 as const;

/** Relay control methods (flat replies). */
export const CONTROL_METHODS = [
  "hello",
  "snapshot",
  "invoke",
  "txnBegin",
  "txnCommit",
  "txnRollback",
  "txnForceRollback",
  "txnStatus",
] as const;
export type ControlMethod = (typeof CONTROL_METHODS)[number];

/** Read-only query methods ({result} replies; txn-adjacent previews included). */
export const QUERY_METHODS_CONTRACT = [
  "getDocumentInfo",
  "getBodies",
  "getFeatures",
  "getFeature",
  "getParameters",
  "getDependencies",
  "getModelTree",
  "describeModel",
  "getSelection",
  "setSelection",
  "clearSelection",
  "findFaces",
  "findEdges",
  "findBodies",
  "getManipulators",
  "measureVolume",
  "measureArea",
  "getBoundingBox",
  "measureDistance",
  "measureAngle",
  "measureRadius",
  "measureDiameter",
  "validateDocument",
  "validateBody",
  "validateFeature",
  "listCommands",
  "getCommandSchema",
  "getCapabilities",
  "previewBegin",
  "previewUpdate",
  "previewCommit",
  "previewCancel",
] as const;
export type QueryMethodContract = (typeof QUERY_METHODS_CONTRACT)[number];

/** Every control-plane method, in contract order. */
export const SESSION_CONTROL_METHODS: readonly string[] = [
  ...CONTROL_METHODS,
  ...QUERY_METHODS_CONTRACT,
];

/** Relay/query-enforced required params per method (missing → coded error). */
export const REQUIRED_PARAMS: Record<string, readonly string[]> = {
  hello: ["token", "protocolVersion"],
  snapshot: [],
  invoke: ["type"],
  txnBegin: ["transactionId"],
  txnCommit: ["transactionId"],
  txnRollback: ["transactionId"],
  txnForceRollback: ["transactionId"],
  txnStatus: [],
  getDocumentInfo: [],
  getBodies: [],
  getFeatures: [],
  getFeature: ["featureId"],
  getParameters: ["featureId"],
  getDependencies: ["featureId"],
  getModelTree: [],
  describeModel: [],
  getSelection: [],
  setSelection: ["ids"],
  clearSelection: [],
  findFaces: [],
  findEdges: [],
  findBodies: [],
  getManipulators: ["featureId"],
  measureVolume: [],
  measureArea: ["featureId"],
  getBoundingBox: ["featureId"],
  measureDistance: ["a", "b"],
  measureAngle: ["a", "b"],
  measureRadius: ["featureId"],
  measureDiameter: ["featureId"],
  validateDocument: [],
  validateBody: [],
  validateFeature: [],
  listCommands: [],
  getCommandSchema: [],
  getCapabilities: [],
  previewBegin: ["featureId", "paramName"],
  previewUpdate: ["previewId"],
  previewCommit: ["previewId"],
  previewCancel: ["previewId"],
};

export const SERVER_EVENTS = ["delta", "selection", "core-restarted"] as const;

// ── Typed DTOs for the fixed control messages (top 8; open-ended query
// params stay Record<string, unknown> — follow-up, not half-migrated). ──

export const HelloParamsSchema = z.object({
  token: z.string().min(1),
  protocolVersion: z.literal(SESSION_CONTROL_VERSION),
  clientType: z.string().optional(),
  clientName: z.string().optional(),
});
export type HelloParams = z.infer<typeof HelloParamsSchema>;

export const SnapshotParamsSchema = z.object({
  documentId: z.string().min(1).optional(),
});
export type SnapshotParams = z.infer<typeof SnapshotParamsSchema>;

export const InvokeParamsSchema = z.object({
  documentId: z.string().min(1).optional(),
  type: z.number().int(),
  fields: z.record(z.unknown()).optional(),
  baseRevision: z.number().nullable().optional(),
  transactionId: z.string().min(1).optional(),
});
export type InvokeParams = z.infer<typeof InvokeParamsSchema>;

export const TxnParamsSchema = z.object({
  documentId: z.string().min(1).optional(),
  transactionId: z.string().min(1),
});
export type TxnParams = z.infer<typeof TxnParamsSchema>;

export const ErrorReplySchema = z.object({
  requestId: z.string().min(1),
  ok: z.literal(false),
  errorCode: z.string().min(1),
  error: z.string().min(1),
});
export type ErrorReply = z.infer<typeof ErrorReplySchema>;
