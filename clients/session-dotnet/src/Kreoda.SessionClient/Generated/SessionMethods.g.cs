// Generated from schemas/session-control-v1.json. Do not edit.
// Source SHA256: 469759d65430c8f8ad5b910da45fe80637728b8d60e9f294fcca2eca7587e705
namespace Kreoda.Session;

public static class SessionMethods
{
    public const int ProtocolVersion = 1;
    public const string ContractSchemaSha256 = "469759d65430c8f8ad5b910da45fe80637728b8d60e9f294fcca2eca7587e705";
    public const string OperationReplayCapability = "operation-replay";
    public const string Pair = "pair";
    public const string Authenticate = "authenticate";
    public const string Hello = "hello";
    public const string GetSessionInfo = "getSessionInfo";
    public const string Snapshot = "snapshot";
    public const string Invoke = "invoke";
    public const string Command = "command";
    public const string TxnBegin = "txnBegin";
    public const string TxnCommit = "txnCommit";
    public const string TxnRollback = "txnRollback";
    public const string TxnForceRollback = "txnForceRollback";
    public const string TxnStatus = "txnStatus";
    public const string GetDocumentInfo = "getDocumentInfo";
    public const string GetBodies = "getBodies";
    public const string GetFeatures = "getFeatures";
    public const string GetFeature = "getFeature";
    public const string GetParameters = "getParameters";
    public const string GetDependencies = "getDependencies";
    public const string GetModelTree = "getModelTree";
    public const string DescribeModel = "describeModel";
    public const string GetSelection = "getSelection";
    public const string SetSelection = "setSelection";
    public const string ClearSelection = "clearSelection";
    public const string FindFaces = "findFaces";
    public const string FindEdges = "findEdges";
    public const string FindBodies = "findBodies";
    public const string GetManipulators = "getManipulators";
    public const string MeasureVolume = "measureVolume";
    public const string MeasureArea = "measureArea";
    public const string GetBoundingBox = "getBoundingBox";
    public const string MeasureDistance = "measureDistance";
    public const string MeasureAngle = "measureAngle";
    public const string MeasureRadius = "measureRadius";
    public const string MeasureDiameter = "measureDiameter";
    public const string ValidateDocument = "validateDocument";
    public const string ValidateBody = "validateBody";
    public const string ValidateFeature = "validateFeature";
    public const string ValidateReferences = "validateReferences";
    public const string ListCommands = "listCommands";
    public const string GetCommandSchema = "getCommandSchema";
    public const string GetCapabilities = "getCapabilities";
    public const string PreviewBegin = "previewBegin";
    public const string PreviewUpdate = "previewUpdate";
    public const string PreviewCommit = "previewCommit";
    public const string PreviewCancel = "previewCancel";
    public static readonly string[] All = ["pair", "authenticate", "hello", "getSessionInfo", "snapshot", "invoke", "command", "txnBegin", "txnCommit", "txnRollback", "txnForceRollback", "txnStatus", "getDocumentInfo", "getBodies", "getFeatures", "getFeature", "getParameters", "getDependencies", "getModelTree", "describeModel", "getSelection", "setSelection", "clearSelection", "findFaces", "findEdges", "findBodies", "getManipulators", "measureVolume", "measureArea", "getBoundingBox", "measureDistance", "measureAngle", "measureRadius", "measureDiameter", "validateDocument", "validateBody", "validateFeature", "validateReferences", "listCommands", "getCommandSchema", "getCapabilities", "previewBegin", "previewUpdate", "previewCommit", "previewCancel"];
    public static readonly string[] OperationReplayMethods = ["invoke", "command", "txnBegin", "txnCommit", "txnRollback", "txnForceRollback", "setSelection", "clearSelection", "previewBegin", "previewUpdate", "previewCommit", "previewCancel"];
    public static bool SupportsOperationReplay(string method) => Array.IndexOf(OperationReplayMethods, method) >= 0;
    public static readonly IReadOnlyDictionary<string, string[]> RequiredParams = new Dictionary<string, string[]>
    {
        ["pair"] = ["pairingToken", "deviceName"],
        ["authenticate"] = ["deviceId", "credential"],
        ["hello"] = ["token", "protocolVersion"],
        ["getSessionInfo"] = [],
        ["snapshot"] = [],
        ["invoke"] = ["type"],
        ["command"] = ["commandId"],
        ["txnBegin"] = ["transactionId"],
        ["txnCommit"] = ["transactionId"],
        ["txnRollback"] = ["transactionId"],
        ["txnForceRollback"] = ["transactionId"],
        ["txnStatus"] = [],
        ["getDocumentInfo"] = [],
        ["getBodies"] = [],
        ["getFeatures"] = [],
        ["getFeature"] = ["featureId"],
        ["getParameters"] = ["featureId"],
        ["getDependencies"] = ["featureId"],
        ["getModelTree"] = [],
        ["describeModel"] = [],
        ["getSelection"] = [],
        ["setSelection"] = ["ids"],
        ["clearSelection"] = [],
        ["findFaces"] = [],
        ["findEdges"] = [],
        ["findBodies"] = [],
        ["getManipulators"] = ["featureId"],
        ["measureVolume"] = [],
        ["measureArea"] = [],
        ["getBoundingBox"] = [],
        ["measureDistance"] = ["a", "b"],
        ["measureAngle"] = ["a", "b"],
        ["measureRadius"] = [],
        ["measureDiameter"] = [],
        ["validateDocument"] = [],
        ["validateBody"] = ["bodyId"],
        ["validateFeature"] = ["featureId"],
        ["validateReferences"] = ["ids"],
        ["listCommands"] = [],
        ["getCommandSchema"] = [],
        ["getCapabilities"] = [],
        ["previewBegin"] = ["featureId", "paramName"],
        ["previewUpdate"] = ["previewId"],
        ["previewCommit"] = ["previewId"],
        ["previewCancel"] = ["previewId"],
    };
}

public static class SessionContract
{
    public const long MaximumRevision = 9007199254740991;
    public static readonly IReadOnlyDictionary<string, string[]> DtoRequiredFields = new Dictionary<string, string[]>
    {
        ["StableFeatureId"] = [],
        ["RequestMetadata"] = [],
        ["HelloParams"] = ["token", "protocolVersion"],
        ["SnapshotParams"] = [],
        ["InvokeParams"] = ["type"],
        ["NamedCommandParams"] = ["commandId"],
        ["TxnParams"] = ["transactionId"],
        ["ErrorReply"] = ["requestId", "ok", "errorCode", "error"],
        ["SessionRequestEnvelope"] = ["requestId", "method"],
        ["HelloReply"] = ["requestId", "ok", "clientId", "sessionId", "documentId", "revision", "capabilities"],
        ["FeatureDescriptor"] = ["featureId", "type"],
        ["SketchDescriptor"] = ["featureId"],
        ["BodyDescriptor"] = ["bodyId", "tip", "history"],
        ["SessionSnapshotPayload"] = ["sessionId", "documentId", "revision", "features", "sketches", "bodies"],
        ["SessionEntityPatch"] = ["kind", "id", "index", "value"],
        ["SessionIncrementalEvent"] = ["event", "baseRevision", "newRevision", "revision", "sessionId", "documentId", "originClientId", "added", "updated", "removedIds", "changedMeshIds", "referenceRemaps", "warnings"],
        ["SessionSnapshotRequiredEvent"] = ["event", "sessionId", "documentId", "revision", "originClientId"],
        ["SelectionEvent"] = ["event", "clientId", "ids"],
        ["CoreRestartedEvent"] = ["event", "sessionId"],
        ["PairParams"] = ["pairingToken", "deviceName"],
        ["AuthenticateParams"] = ["deviceId", "credential"],
        ["PairReply"] = ["deviceId", "credential", "sessionToken"],
        ["AuthenticateReply"] = ["deviceId", "sessionToken"],
        ["SessionInfoPayload"] = ["sessionId", "documentId", "documentRevision", "connectedClients", "transactionState"],
    };
}
