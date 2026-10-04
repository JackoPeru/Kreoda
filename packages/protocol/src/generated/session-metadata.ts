// Generated from schemas/session-control-v1.json. Do not edit.
// Source SHA256: 41ed0a01287a297f3a6d52e40efb0ffa06270bb9d8debe0fe3f7c0d1a28a4ddb
export const CONTRACT_SCHEMA_SHA256 = "41ed0a01287a297f3a6d52e40efb0ffa06270bb9d8debe0fe3f7c0d1a28a4ddb" as const;
export const SESSION_DTO_NAMES = [
  "StableFeatureId",
  "RequestMetadata",
  "HelloParams",
  "SnapshotParams",
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
  "CoreRestartedEvent"
] as const;
export const SESSION_CONTROL_VERSION = 1 as const;
export const CONTROL_METHODS = [
  "hello",
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
  "previewCancel"
] as const;
export const SESSION_CONTROL_METHODS = [
  "hello",
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
export const REQUIRED_PARAMS: Readonly<Record<string, readonly string[]>> = {
  "hello": [
    "token",
    "protocolVersion"
  ],
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
  "measureArea": [
    "featureId"
  ],
  "getBoundingBox": [
    "featureId"
  ],
  "measureDistance": [
    "a",
    "b"
  ],
  "measureAngle": [
    "a",
    "b"
  ],
  "measureRadius": [
    "featureId"
  ],
  "measureDiameter": [
    "featureId"
  ],
  "validateDocument": [],
  "validateBody": [],
  "validateFeature": [],
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
