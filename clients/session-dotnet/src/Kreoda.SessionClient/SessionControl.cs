// Slice 7: typed mirror of schemas/session-control-v1.json (session CONTROL
// plane: WebSocket JSON, protocolVersion = 1). The JSON file is the single
// source of truth; SessionControlContractTests pins this mirror to it.
// The wire stays Dictionary-built JSON inside one place (ToDictionary);
// open-ended query params keep using CallAsync directly (follow-up).
namespace Kreoda.Session;

/// <summary>Control-plane method names (contract order).</summary>
public static class SessionMethods
{
    public const string Hello = "hello";
    public const string Snapshot = "snapshot";
    public const string Invoke = "invoke";
    public const string TxnBegin = "txnBegin";
    public const string TxnCommit = "txnCommit";
    public const string TxnRollback = "txnRollback";
    public const string TxnForceRollback = "txnForceRollback";
    public const string TxnStatus = "txnStatus";

    public static readonly string[] All =
    [
        "hello", "snapshot", "invoke",
        "txnBegin", "txnCommit", "txnRollback", "txnForceRollback", "txnStatus",
        "getDocumentInfo", "getBodies", "getFeatures", "getFeature",
        "getParameters", "getDependencies", "getModelTree", "describeModel",
        "getSelection", "setSelection", "clearSelection",
        "findFaces", "findEdges", "findBodies",
        "getManipulators", "measureVolume", "measureArea", "getBoundingBox",
        "measureDistance", "measureAngle", "measureRadius", "measureDiameter",
        "validateDocument", "validateBody", "validateFeature",
        "listCommands", "getCommandSchema", "getCapabilities",
        "previewBegin", "previewUpdate", "previewCommit", "previewCancel",
    ];

    /// <summary>Relay/query-enforced required params per method.</summary>
    public static readonly IReadOnlyDictionary<string, string[]> RequiredParams =
        new Dictionary<string, string[]>
        {
            ["hello"] = ["token", "protocolVersion"],
            ["snapshot"] = [],
            ["invoke"] = ["type"],
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
            ["measureArea"] = ["featureId"],
            ["getBoundingBox"] = ["featureId"],
            ["measureDistance"] = ["a", "b"],
            ["measureAngle"] = ["a", "b"],
            ["measureRadius"] = ["featureId"],
            ["measureDiameter"] = ["featureId"],
            ["validateDocument"] = [],
            ["validateBody"] = [],
            ["validateFeature"] = [],
            ["listCommands"] = [],
            ["getCommandSchema"] = [],
            ["getCapabilities"] = [],
            ["previewBegin"] = ["featureId", "paramName"],
            ["previewUpdate"] = ["previewId"],
            ["previewCommit"] = ["previewId"],
            ["previewCancel"] = ["previewId"],
        };
}

/// <summary>Typed <c>invoke</c> params (fields stay open: core command payloads).</summary>
public sealed record InvokeRequest(
    int Type,
    IDictionary<string, object?> Fields,
    string DocumentId = "doc-phase1",
    double? BaseRevision = null,
    string? TransactionId = null)
{
    public Dictionary<string, object?> ToDictionary()
    {
        var p = new Dictionary<string, object?>
        {
            ["documentId"] = DocumentId,
            ["type"] = Type,
            ["fields"] = Fields,
        };
        if (BaseRevision.HasValue) p["baseRevision"] = BaseRevision.Value;
        if (TransactionId is not null) p["transactionId"] = TransactionId;
        return p;
    }
}

/// <summary>Typed transaction-control params.</summary>
public sealed record TxnRequest(string TransactionId, string DocumentId = "doc-phase1")
{
    public Dictionary<string, object?> ToDictionary() => new()
    {
        ["documentId"] = DocumentId,
        ["transactionId"] = TransactionId,
    };
}
