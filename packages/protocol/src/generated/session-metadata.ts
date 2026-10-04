// Generated from schemas/session-control-v1.json. Do not edit.
// Source SHA256: d5804785c2840e6cec157bd09648cda36f56ced3cbd1128f352a99352e18d16e
export const CONTRACT_SCHEMA_SHA256 = "d5804785c2840e6cec157bd09648cda36f56ced3cbd1128f352a99352e18d16e" as const;
export const SESSION_DTO_NAMES = [
  "StableFeatureId",
  "RequestMetadata",
  "HelloParams",
  "SnapshotParams",
  "RequestMeshLODParams",
  "MeshHeader",
  "MeshReply",
  "InvokeParams",
  "NamedCommandParams",
  "TxnParams",
  "ErrorReply",
  "SessionRequestEnvelope",
  "HelloReply",
  "FeatureDescriptor",
  "SketchDescriptor",
  "BodyDescriptor",
  "SessionSnapshotPayload",
  "SessionEntityPatch",
  "SessionIncrementalEvent",
  "SessionSnapshotRequiredEvent",
  "SelectionEvent",
  "CoreRestartedEvent",
  "PairParams",
  "AuthenticateParams",
  "PairReply",
  "AuthenticateReply",
  "SessionInfoPayload"
] as const;
export const SESSION_CONTROL_VERSION = 1 as const;
export const CONTROL_METHODS = [
  "pair",
  "authenticate",
  "hello",
  "getSessionInfo",
  "snapshot",
  "invoke",
  "command",
  "txnBegin",
  "txnCommit",
  "txnRollback",
  "txnForceRollback",
  "txnStatus"
] as const;
export const QUERY_METHODS_CONTRACT = [
  "getDocumentInfo",
  "getBodies",
  "requestMeshLOD",
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
  "validateReferences",
  "listCommands",
  "getCommandSchema",
  "getCapabilities",
  "previewBegin",
  "previewUpdate",
  "previewCommit",
  "previewCancel"
] as const;
export const SESSION_CONTROL_METHODS = [
  "pair",
  "authenticate",
  "hello",
  "getSessionInfo",
  "snapshot",
  "invoke",
  "command",
  "txnBegin",
  "txnCommit",
  "txnRollback",
  "txnForceRollback",
  "txnStatus",
  "getDocumentInfo",
  "getBodies",
  "requestMeshLOD",
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
  "validateReferences",
  "listCommands",
  "getCommandSchema",
  "getCapabilities",
  "previewBegin",
  "previewUpdate",
  "previewCommit",
  "previewCancel"
] as const;
export const OPERATION_METHODS = [
  "invoke",
  "command",
  "txnBegin",
  "txnCommit",
  "txnRollback",
  "txnForceRollback",
  "setSelection",
  "clearSelection",
  "previewBegin",
  "previewUpdate",
  "previewCommit",
  "previewCancel"
] as const;
export const SESSION_SERVER_CAPABILITIES = [
  "operation-replay",
  "incremental-deltas",
  "binary-mesh-v1"
] as const;
export const REQUIRED_PARAMS: Readonly<Record<string, readonly string[]>> = {
  "pair": [
    "pairingToken",
    "deviceName"
  ],
  "authenticate": [
    "deviceId",
    "credential"
  ],
  "hello": [
    "token",
    "protocolVersion"
  ],
  "getSessionInfo": [],
  "snapshot": [],
  "invoke": [
    "type"
  ],
  "command": [
    "commandId"
  ],
  "txnBegin": [
    "transactionId"
  ],
  "txnCommit": [
    "transactionId"
  ],
  "txnRollback": [
    "transactionId"
  ],
  "txnForceRollback": [
    "transactionId"
  ],
  "txnStatus": [],
  "getDocumentInfo": [],
  "getBodies": [],
  "requestMeshLOD": [
    "bodyId",
    "quality",
    "documentId",
    "expectedRevision"
  ],
  "getFeatures": [],
  "getFeature": [
    "featureId"
  ],
  "getParameters": [
    "featureId"
  ],
  "getDependencies": [
    "featureId"
  ],
  "getModelTree": [],
  "describeModel": [],
  "getSelection": [],
  "setSelection": [
    "ids"
  ],
  "clearSelection": [],
  "findFaces": [],
  "findEdges": [],
  "findBodies": [],
  "getManipulators": [
    "featureId"
  ],
  "measureVolume": [],
  "measureArea": [],
  "getBoundingBox": [],
  "measureDistance": [
    "a",
    "b"
  ],
  "measureAngle": [
    "a",
    "b"
  ],
  "measureRadius": [],
  "measureDiameter": [],
  "validateDocument": [],
  "validateBody": [
    "bodyId"
  ],
  "validateFeature": [
    "featureId"
  ],
  "validateReferences": [
    "ids"
  ],
  "listCommands": [],
  "getCommandSchema": [],
  "getCapabilities": [],
  "previewBegin": [
    "featureId",
    "paramName"
  ],
  "previewUpdate": [
    "previewId"
  ],
  "previewCommit": [
    "previewId"
  ],
  "previewCancel": [
    "previewId"
  ]
};
export const SERVER_EVENTS = [
  "delta",
  "selection",
  "core-restarted",
  "snapshot-required"
] as const;
export const SESSION_EVENT_METADATA = {
  "delta": {
    "mode": "negotiated",
    "capability": "incremental-deltas",
    "incrementalFields": [
      "baseRevision",
      "newRevision",
      "revision",
      "sessionId",
      "documentId",
      "originClientId",
      "added",
      "updated",
      "removedIds",
      "changedMeshIds",
      "referenceRemaps",
      "warnings"
    ],
    "entityKinds": [
      "feature",
      "sketch",
      "body"
    ],
    "entityFields": [
      "kind",
      "id",
      "index",
      "value"
    ],
    "legacyFields": [
      "features",
      "sketches",
      "bodies",
      "tips",
      "changedBodyIds",
      "changedMeshIds",
      "disappearedIds"
    ]
  },
  "snapshot-required": {
    "fields": [
      "sessionId",
      "documentId",
      "revision",
      "originClientId"
    ]
  }
} as const;
