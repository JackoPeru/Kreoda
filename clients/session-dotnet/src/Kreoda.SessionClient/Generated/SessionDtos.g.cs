// Generated from schemas/session-control-v1.json. Do not edit.
// Source SHA256: fc27989e6b39fd8d12cafa770f72ab89f26e7bb0f9d14b635f687b3ebbdfe6ce
#nullable enable annotations
#nullable disable warnings
namespace Kreoda.Session.Generated
{
    using System;
    using System.Collections.Generic;

    using System.Text.Json;
    using System.Text.Json.Serialization;
    using System.Globalization;

    public partial class RequestMetadata
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("operationId")]
        public string? OperationId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("sessionId")]
        public string? SessionId { get; set; }
    }

    public partial class HelloParams
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("capabilities")]
        [JsonConverter(typeof(PurpleDecodeArrayConverter))]
        public string[]? Capabilities { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("clientId")]
        public string? ClientId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("clientName")]
        public string? ClientName { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("clientType")]
        public string? ClientType { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("deviceId")]
        public string? DeviceId { get; set; }

        [JsonPropertyName("protocolVersion")]
        public long ProtocolVersion { get; set; }

        [JsonPropertyName("token")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string Token { get; set; }
    }

    public partial class SnapshotParams
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("documentId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string? DocumentId { get; set; }
    }

    public partial class RequestMeshLodParams
    {
        [JsonPropertyName("bodyId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string BodyId { get; set; }

        [JsonPropertyName("documentId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string DocumentId { get; set; }

        [JsonPropertyName("expectedRevision")]
        public long ExpectedRevision { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("instanceId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string? InstanceId { get; set; }

        [JsonPropertyName("quality")]
        public long Quality { get; set; }
    }

    public partial class MeshReply
    {
        [JsonPropertyName("result")]
        public MeshHeader Result { get; set; }
    }

    public partial class MeshHeader
    {
        [JsonPropertyName("bodyId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string BodyId { get; set; }

        [JsonPropertyName("byteLength")]
        public long ByteLength { get; set; }

        [JsonPropertyName("documentId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string DocumentId { get; set; }

        [JsonPropertyName("featureId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string FeatureId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("instanceId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string? InstanceId { get; set; }

        [JsonPropertyName("nativeRequestId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string NativeRequestId { get; set; }

        [JsonPropertyName("quality")]
        public long Quality { get; set; }

        [JsonPropertyName("revision")]
        public long Revision { get; set; }

        [JsonPropertyName("sessionId")]
        public string SessionId { get; set; }

        [JsonPropertyName("tipId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string TipId { get; set; }
    }

    public partial class InvokeParams
    {
        [JsonPropertyName("baseRevision")]
        public long? BaseRevision { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("documentId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string? DocumentId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("fields")]
        public Dictionary<string, object>? Fields { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("transactionId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string? TransactionId { get; set; }

        [JsonPropertyName("type")]
        public long Type { get; set; }
    }

    public partial class NamedCommandParams
    {
        [JsonPropertyName("baseRevision")]
        public long? BaseRevision { get; set; }

        [JsonPropertyName("commandId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string CommandId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("documentId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string? DocumentId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("featureId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string? FeatureId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("parameters")]
        public Dictionary<string, object>? Parameters { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("transactionId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string? TransactionId { get; set; }
    }

    public partial class TxnParams
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("documentId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string? DocumentId { get; set; }

        [JsonPropertyName("transactionId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string TransactionId { get; set; }
    }

    public partial class ErrorReply
    {
        [JsonPropertyName("error")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string Error { get; set; }

        [JsonPropertyName("errorCode")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string ErrorCode { get; set; }

        [JsonPropertyName("ok")]
        public bool Ok { get; set; }

        [JsonPropertyName("requestId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string RequestId { get; set; }
    }

    public partial class SessionRequestEnvelope
    {
        [JsonPropertyName("method")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string Method { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("operationId")]
        public string? OperationId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("params")]
        public Dictionary<string, object>? Params { get; set; }

        [JsonPropertyName("requestId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string RequestId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("sessionId")]
        public string? SessionId { get; set; }
    }

    public partial class HelloReply
    {
        [JsonPropertyName("capabilities")]
        [JsonConverter(typeof(PurpleDecodeArrayConverter))]
        public string[] Capabilities { get; set; }

        [JsonPropertyName("clientId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string ClientId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("deviceId")]
        public string? DeviceId { get; set; }

        [JsonPropertyName("documentId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string DocumentId { get; set; }

        [JsonPropertyName("ok")]
        public bool Ok { get; set; }

        [JsonPropertyName("requestId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string RequestId { get; set; }

        [JsonPropertyName("revision")]
        public long Revision { get; set; }

        [JsonPropertyName("sessionId")]
        public string SessionId { get; set; }
    }

    public partial class SessionSnapshotPayload
    {
        [JsonPropertyName("bodies")]
        public BodyDescriptor[] Bodies { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("datums")]
        public DatumDescriptor[]? Datums { get; set; }

        [JsonPropertyName("documentId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string DocumentId { get; set; }

        [JsonPropertyName("features")]
        public FeatureDescriptor[] Features { get; set; }

        [JsonPropertyName("revision")]
        public long Revision { get; set; }

        [JsonPropertyName("sessionId")]
        public string SessionId { get; set; }

        [JsonPropertyName("sketches")]
        public SketchDescriptor[] Sketches { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("tips")]
        [JsonConverter(typeof(PurpleDecodeArrayConverter))]
        public string[]? Tips { get; set; }
    }

    public partial class BodyDescriptor
    {
        [JsonPropertyName("bodyId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string BodyId { get; set; }

        [JsonPropertyName("history")]
        [JsonConverter(typeof(PurpleDecodeArrayConverter))]
        public string[] History { get; set; }

        [JsonPropertyName("tip")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string Tip { get; set; }
    }

    public partial class DatumDescriptor
    {
        [JsonPropertyName("definition")]
        public DatumDefinition Definition { get; set; }

        [JsonPropertyName("dependsOn")]
        [JsonConverter(typeof(TentacledDecodeArrayConverter))]
        public string[] DependsOn { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("error")]
        public string? Error { get; set; }

        [JsonPropertyName("featureId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string FeatureId { get; set; }

        [JsonPropertyName("kind")]
        public DatumDescriptorKind Kind { get; set; }

        [JsonPropertyName("resolved")]
        public DatumGeometry Resolved { get; set; }

        [JsonPropertyName("status")]
        public Status Status { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("type")]
        public DatumDescriptorKind? Type { get; set; }
    }

    public partial class DatumDefinition
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("planeKind")]
        public PlaneKind? PlaneKind { get; set; }

        [JsonPropertyName("type")]
        public DefinitionType Type { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("base")]
        public Base? Base { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("offsetMm")]
        [JsonConverter(typeof(FluffyMinMaxValueCheckConverter))]
        public double? OffsetMm { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("first")]
        public DefinitionFirst? First { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("second")]
        public DefinitionSecond? Second { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("angleDeg")]
        [JsonConverter(typeof(PurpleMinMaxValueCheckConverter))]
        public double? AngleDeg { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("axis")]
        public AxisClass? Axis { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("third")]
        public Third? Third { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("plane")]
        public Plane? Plane { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("through")]
        public Through? Through { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("positionMm")]
        [JsonConverter(typeof(FluffyDecodeArrayConverter))]
        public double[]? PositionMm { get; set; }
    }

    public partial class AxisClass
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("axis")]
        public AxisEnum? Axis { get; set; }

        [JsonPropertyName("type")]
        public AxisType Type { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("featureId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string? FeatureId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("persistentEdgeId")]
        [JsonConverter(typeof(TentacledMinMaxLengthCheckConverter))]
        public string? PersistentEdgeId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("selectionEntry")]
        [JsonConverter(typeof(StickyMinMaxLengthCheckConverter))]
        public string? SelectionEntry { get; set; }
    }

    public partial class Base
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("planeKind")]
        public PlaneKind? PlaneKind { get; set; }

        [JsonPropertyName("type")]
        public BaseType Type { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("featureId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string? FeatureId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("persistentFaceId")]
        [JsonConverter(typeof(TentacledMinMaxLengthCheckConverter))]
        public string? PersistentFaceId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("selectionEntry")]
        [JsonConverter(typeof(StickyMinMaxLengthCheckConverter))]
        public string? SelectionEntry { get; set; }
    }

    public partial class DefinitionFirst
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("planeKind")]
        public PlaneKind? PlaneKind { get; set; }

        [JsonPropertyName("type")]
        public PurpleType Type { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("featureId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string? FeatureId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("persistentFaceId")]
        [JsonConverter(typeof(TentacledMinMaxLengthCheckConverter))]
        public string? PersistentFaceId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("selectionEntry")]
        [JsonConverter(typeof(StickyMinMaxLengthCheckConverter))]
        public string? SelectionEntry { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("positionMm")]
        [JsonConverter(typeof(FluffyDecodeArrayConverter))]
        public double[]? PositionMm { get; set; }
    }

    public partial class Plane
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("planeKind")]
        public PlaneKind? PlaneKind { get; set; }

        [JsonPropertyName("type")]
        public BaseType Type { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("featureId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string? FeatureId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("persistentFaceId")]
        [JsonConverter(typeof(TentacledMinMaxLengthCheckConverter))]
        public string? PersistentFaceId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("selectionEntry")]
        [JsonConverter(typeof(StickyMinMaxLengthCheckConverter))]
        public string? SelectionEntry { get; set; }
    }

    public partial class DefinitionSecond
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("planeKind")]
        public PlaneKind? PlaneKind { get; set; }

        [JsonPropertyName("type")]
        public PurpleType Type { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("featureId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string? FeatureId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("persistentFaceId")]
        [JsonConverter(typeof(TentacledMinMaxLengthCheckConverter))]
        public string? PersistentFaceId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("selectionEntry")]
        [JsonConverter(typeof(StickyMinMaxLengthCheckConverter))]
        public string? SelectionEntry { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("positionMm")]
        [JsonConverter(typeof(FluffyDecodeArrayConverter))]
        public double[]? PositionMm { get; set; }
    }

    public partial class Third
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("positionMm")]
        [JsonConverter(typeof(FluffyDecodeArrayConverter))]
        public double[]? PositionMm { get; set; }

        [JsonPropertyName("type")]
        public ThirdType Type { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("featureId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string? FeatureId { get; set; }
    }

    public partial class Through
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("positionMm")]
        [JsonConverter(typeof(FluffyDecodeArrayConverter))]
        public double[]? PositionMm { get; set; }

        [JsonPropertyName("type")]
        public ThirdType Type { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("featureId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string? FeatureId { get; set; }
    }

    public partial class DatumGeometry
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("normal")]
        public double[]? Normal { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("originMm")]
        public double[]? OriginMm { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("xAxis")]
        public double[]? XAxis { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("yAxis")]
        public double[]? YAxis { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("direction")]
        public double[]? Direction { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("positionMm")]
        public double[]? PositionMm { get; set; }
    }

    public partial class FeatureDescriptor
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("dependsOn")]
        [JsonConverter(typeof(PurpleDecodeArrayConverter))]
        public string[]? DependsOn { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("expressions")]
        public Dictionary<string, string>? Expressions { get; set; }

        [JsonPropertyName("featureId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string FeatureId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("paramsMm")]
        public double[]? ParamsMm { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("refExtra")]
        public string? RefExtra { get; set; }

        [JsonPropertyName("type")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string Type { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("volumeMm3")]
        public double? VolumeMm3 { get; set; }
    }

    public partial class SketchDescriptor
    {
        [JsonPropertyName("featureId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string FeatureId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("id")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string? Id { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("model")]
        public Dictionary<string, object>? Model { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("plane")]
        public SketchPlaneFrame? Plane { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("planeKind")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string? PlaneKind { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("supportRef")]
        public string? SupportRef { get; set; }
    }

    public partial class SketchPlaneFrame
    {
        [JsonPropertyName("normal")]
        public double[] Normal { get; set; }

        [JsonPropertyName("origin")]
        public double[] Origin { get; set; }

        [JsonPropertyName("xAxis")]
        public double[] XAxis { get; set; }

        [JsonPropertyName("yAxis")]
        public double[] YAxis { get; set; }
    }

    public partial class SessionIncrementalEvent
    {
        [JsonPropertyName("added")]
        public SessionEntityPatch[] Added { get; set; }

        [JsonPropertyName("baseRevision")]
        public long BaseRevision { get; set; }

        [JsonPropertyName("changedMeshIds")]
        [JsonConverter(typeof(PurpleDecodeArrayConverter))]
        public string[] ChangedMeshIds { get; set; }

        [JsonPropertyName("documentId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string DocumentId { get; set; }

        [JsonPropertyName("event")]
        public SessionIncrementalEventEvent Event { get; set; }

        [JsonPropertyName("newRevision")]
        public long NewRevision { get; set; }

        [JsonPropertyName("originClientId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string OriginClientId { get; set; }

        [JsonPropertyName("referenceRemaps")]
        public object[] ReferenceRemaps { get; set; }

        [JsonPropertyName("removedIds")]
        [JsonConverter(typeof(PurpleDecodeArrayConverter))]
        public string[] RemovedIds { get; set; }

        [JsonPropertyName("revision")]
        public long Revision { get; set; }

        [JsonPropertyName("sessionId")]
        public string SessionId { get; set; }

        [JsonPropertyName("updated")]
        public SessionEntityPatch[] Updated { get; set; }

        [JsonPropertyName("warnings")]
        public object[] Warnings { get; set; }
    }

    public partial class SessionEntityPatch
    {
        [JsonPropertyName("id")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string Id { get; set; }

        [JsonPropertyName("index")]
        public long Index { get; set; }

        [JsonPropertyName("kind")]
        public SessionEntityPatchKind Kind { get; set; }

        [JsonPropertyName("value")]
        public Dictionary<string, object> Value { get; set; }
    }

    public partial class SessionSnapshotRequiredEvent
    {
        [JsonPropertyName("documentId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string DocumentId { get; set; }

        [JsonPropertyName("event")]
        public SessionSnapshotRequiredEventEvent Event { get; set; }

        [JsonPropertyName("originClientId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string OriginClientId { get; set; }

        [JsonPropertyName("revision")]
        public long Revision { get; set; }

        [JsonPropertyName("sessionId")]
        public string SessionId { get; set; }
    }

    public partial class SelectionEvent
    {
        [JsonPropertyName("clientId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string ClientId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("documentId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string? DocumentId { get; set; }

        [JsonPropertyName("event")]
        public SelectionEventEvent Event { get; set; }

        [JsonPropertyName("ids")]
        [JsonConverter(typeof(PurpleDecodeArrayConverter))]
        public string[] Ids { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("revision")]
        public long? Revision { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("sessionId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string? SessionId { get; set; }
    }

    public partial class CoreRestartedEvent
    {
        [JsonPropertyName("event")]
        public CoreRestartedEventEvent Event { get; set; }

        [JsonPropertyName("sessionId")]
        public string SessionId { get; set; }
    }

    public partial class PairParams
    {
        [JsonPropertyName("deviceName")]
        [JsonConverter(typeof(IndigoMinMaxLengthCheckConverter))]
        public string DeviceName { get; set; }

        [JsonPropertyName("pairingToken")]
        public string PairingToken { get; set; }
    }

    public partial class AuthenticateParams
    {
        [JsonPropertyName("credential")]
        public string Credential { get; set; }

        [JsonPropertyName("deviceId")]
        public string DeviceId { get; set; }
    }

    public partial class PairReply
    {
        [JsonPropertyName("credential")]
        public string Credential { get; set; }

        [JsonPropertyName("deviceId")]
        public string DeviceId { get; set; }

        [JsonPropertyName("sessionToken")]
        public string SessionToken { get; set; }
    }

    public partial class AuthenticateReply
    {
        [JsonPropertyName("deviceId")]
        public string DeviceId { get; set; }

        [JsonPropertyName("sessionToken")]
        public string SessionToken { get; set; }
    }

    public partial class SessionInfoPayload
    {
        [JsonPropertyName("connectedClients")]
        public ConnectedClient[] ConnectedClients { get; set; }

        [JsonPropertyName("documentId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string DocumentId { get; set; }

        [JsonPropertyName("documentRevision")]
        public long? DocumentRevision { get; set; }

        [JsonPropertyName("sessionId")]
        public string SessionId { get; set; }

        [JsonPropertyName("transactionState")]
        public TransactionState? TransactionState { get; set; }
    }

    public partial class ConnectedClient
    {
        [JsonPropertyName("capabilities")]
        [JsonConverter(typeof(PurpleDecodeArrayConverter))]
        public string[] Capabilities { get; set; }

        [JsonPropertyName("clientId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string ClientId { get; set; }

        [JsonPropertyName("clientType")]
        public string ClientType { get; set; }

        [JsonPropertyName("connectionState")]
        public ConnectionState ConnectionState { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("deviceId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string? DeviceId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("name")]
        public string? Name { get; set; }
    }

    public partial class TransactionState
    {
        [JsonPropertyName("ownerClientId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string OwnerClientId { get; set; }

        [JsonPropertyName("ownerConnected")]
        public bool OwnerConnected { get; set; }

        [JsonPropertyName("state")]
        public State State { get; set; }

        [JsonPropertyName("transactionId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string TransactionId { get; set; }
    }

    public partial class RequestPreviewMeshParams
    {
        [JsonPropertyName("documentId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string DocumentId { get; set; }

        [JsonPropertyName("expectedRevision")]
        public long ExpectedRevision { get; set; }

        [JsonPropertyName("generation")]
        public long Generation { get; set; }

        [JsonPropertyName("previewId")]
        [JsonConverter(typeof(IndecentMinMaxLengthCheckConverter))]
        public string PreviewId { get; set; }
    }

    public partial class PreviewMeshHeader
    {
        [JsonPropertyName("baseRevision")]
        public long BaseRevision { get; set; }

        [JsonPropertyName("bodyId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string BodyId { get; set; }

        [JsonPropertyName("byteLength")]
        public long ByteLength { get; set; }

        [JsonPropertyName("documentId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string DocumentId { get; set; }

        [JsonPropertyName("featureId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string FeatureId { get; set; }

        [JsonPropertyName("generation")]
        public long Generation { get; set; }

        [JsonPropertyName("nativeRequestId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string NativeRequestId { get; set; }

        [JsonPropertyName("paramName")]
        [JsonConverter(typeof(IndecentMinMaxLengthCheckConverter))]
        public string ParamName { get; set; }

        [JsonPropertyName("previewId")]
        [JsonConverter(typeof(IndecentMinMaxLengthCheckConverter))]
        public string PreviewId { get; set; }

        [JsonPropertyName("quality")]
        public long Quality { get; set; }

        [JsonPropertyName("sessionId")]
        public string SessionId { get; set; }

        [JsonPropertyName("targetTipId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string TargetTipId { get; set; }
    }

    public partial class ContextCommandsPayload
    {
        [JsonPropertyName("commands")]
        public ContextCommandInfo[] Commands { get; set; }

        [JsonPropertyName("contextValid")]
        public bool ContextValid { get; set; }

        [JsonPropertyName("documentId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string DocumentId { get; set; }

        [JsonPropertyName("revision")]
        public long Revision { get; set; }

        [JsonPropertyName("sessionId")]
        public string SessionId { get; set; }
    }

    public partial class ContextCommandInfo
    {
        [JsonPropertyName("available")]
        public bool Available { get; set; }

        [JsonPropertyName("boundParameters")]
        public Dictionary<string, object> BoundParameters { get; set; }

        [JsonPropertyName("description")]
        public string Description { get; set; }

        [JsonPropertyName("id")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string Id { get; set; }

        [JsonPropertyName("label")]
        public string Label { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("reason")]
        public string? Reason { get; set; }

        [JsonPropertyName("supportsPreview")]
        public bool SupportsPreview { get; set; }
    }

    public partial class ContextCommandsParams
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("beginnerMode")]
        public bool? BeginnerMode { get; set; }

        [JsonPropertyName("documentId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string DocumentId { get; set; }

        [JsonPropertyName("expectedRevision")]
        public long ExpectedRevision { get; set; }

        [JsonPropertyName("selectionIds")]
        [JsonConverter(typeof(StickyDecodeArrayConverter))]
        public string[] SelectionIds { get; set; }
    }

    public partial class DatumPlaneDescriptor
    {
        [JsonPropertyName("definition")]
        public DatumPlaneDefinition Definition { get; set; }

        [JsonPropertyName("dependsOn")]
        [JsonConverter(typeof(TentacledDecodeArrayConverter))]
        public string[] DependsOn { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("error")]
        public string? Error { get; set; }

        [JsonPropertyName("featureId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string FeatureId { get; set; }

        [JsonPropertyName("kind")]
        public DatumPlaneDescriptorKind Kind { get; set; }

        [JsonPropertyName("resolved")]
        public DatumPlaneGeometry Resolved { get; set; }

        [JsonPropertyName("status")]
        public Status Status { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("type")]
        public DatumPlaneDescriptorKind? Type { get; set; }
    }

    public partial class DatumPlaneDefinition
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("planeKind")]
        public PlaneKind? PlaneKind { get; set; }

        [JsonPropertyName("type")]
        public DatumPlaneDefinitionType Type { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("base")]
        public Base? Base { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("offsetMm")]
        [JsonConverter(typeof(FluffyMinMaxValueCheckConverter))]
        public double? OffsetMm { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("first")]
        public DatumPlaneDefinitionFirst? First { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("second")]
        public DatumPlaneDefinitionSecond? Second { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("angleDeg")]
        [JsonConverter(typeof(PurpleMinMaxValueCheckConverter))]
        public double? AngleDeg { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("axis")]
        public AxisClass? Axis { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("third")]
        public Third? Third { get; set; }
    }

    public partial class DatumPlaneDefinitionFirst
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("planeKind")]
        public PlaneKind? PlaneKind { get; set; }

        [JsonPropertyName("type")]
        public PurpleType Type { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("featureId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string? FeatureId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("persistentFaceId")]
        [JsonConverter(typeof(TentacledMinMaxLengthCheckConverter))]
        public string? PersistentFaceId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("selectionEntry")]
        [JsonConverter(typeof(StickyMinMaxLengthCheckConverter))]
        public string? SelectionEntry { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("positionMm")]
        [JsonConverter(typeof(FluffyDecodeArrayConverter))]
        public double[]? PositionMm { get; set; }
    }

    public partial class DatumPlaneDefinitionSecond
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("planeKind")]
        public PlaneKind? PlaneKind { get; set; }

        [JsonPropertyName("type")]
        public PurpleType Type { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("featureId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string? FeatureId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("persistentFaceId")]
        [JsonConverter(typeof(TentacledMinMaxLengthCheckConverter))]
        public string? PersistentFaceId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("selectionEntry")]
        [JsonConverter(typeof(StickyMinMaxLengthCheckConverter))]
        public string? SelectionEntry { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("positionMm")]
        [JsonConverter(typeof(FluffyDecodeArrayConverter))]
        public double[]? PositionMm { get; set; }
    }

    public partial class DatumPlaneGeometry
    {
        [JsonPropertyName("normal")]
        public double[] Normal { get; set; }

        [JsonPropertyName("originMm")]
        public double[] OriginMm { get; set; }

        [JsonPropertyName("xAxis")]
        public double[] XAxis { get; set; }

        [JsonPropertyName("yAxis")]
        public double[] YAxis { get; set; }
    }

    public partial class DatumAxisDescriptor
    {
        [JsonPropertyName("definition")]
        public DatumAxisDefinition Definition { get; set; }

        [JsonPropertyName("dependsOn")]
        [JsonConverter(typeof(TentacledDecodeArrayConverter))]
        public string[] DependsOn { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("error")]
        public string? Error { get; set; }

        [JsonPropertyName("featureId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string FeatureId { get; set; }

        [JsonPropertyName("kind")]
        public DatumAxisDescriptorKind Kind { get; set; }

        [JsonPropertyName("resolved")]
        public DatumAxisGeometry Resolved { get; set; }

        [JsonPropertyName("status")]
        public Status Status { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("type")]
        public DatumAxisDescriptorKind? Type { get; set; }
    }

    public partial class DatumAxisDefinition
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("first")]
        public DatumAxisDefinitionFirst? First { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("second")]
        public DatumAxisDefinitionSecond? Second { get; set; }

        [JsonPropertyName("type")]
        public DatumAxisDefinitionType Type { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("plane")]
        public Plane? Plane { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("through")]
        public Through? Through { get; set; }
    }

    public partial class DatumAxisDefinitionFirst
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("positionMm")]
        [JsonConverter(typeof(FluffyDecodeArrayConverter))]
        public double[]? PositionMm { get; set; }

        [JsonPropertyName("type")]
        public PurpleType Type { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("featureId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string? FeatureId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("planeKind")]
        public PlaneKind? PlaneKind { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("persistentFaceId")]
        [JsonConverter(typeof(TentacledMinMaxLengthCheckConverter))]
        public string? PersistentFaceId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("selectionEntry")]
        [JsonConverter(typeof(StickyMinMaxLengthCheckConverter))]
        public string? SelectionEntry { get; set; }
    }

    public partial class DatumAxisDefinitionSecond
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("positionMm")]
        [JsonConverter(typeof(FluffyDecodeArrayConverter))]
        public double[]? PositionMm { get; set; }

        [JsonPropertyName("type")]
        public PurpleType Type { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("featureId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string? FeatureId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("planeKind")]
        public PlaneKind? PlaneKind { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("persistentFaceId")]
        [JsonConverter(typeof(TentacledMinMaxLengthCheckConverter))]
        public string? PersistentFaceId { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("selectionEntry")]
        [JsonConverter(typeof(StickyMinMaxLengthCheckConverter))]
        public string? SelectionEntry { get; set; }
    }

    public partial class DatumAxisGeometry
    {
        [JsonPropertyName("direction")]
        public double[] Direction { get; set; }

        [JsonPropertyName("originMm")]
        public double[] OriginMm { get; set; }
    }

    public partial class DatumPointDescriptor
    {
        [JsonPropertyName("definition")]
        public DatumPointDefinition Definition { get; set; }

        [JsonPropertyName("dependsOn")]
        [JsonConverter(typeof(TentacledDecodeArrayConverter))]
        public string[] DependsOn { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("error")]
        public string? Error { get; set; }

        [JsonPropertyName("featureId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string FeatureId { get; set; }

        [JsonPropertyName("kind")]
        public DatumPointDescriptorKind Kind { get; set; }

        [JsonPropertyName("resolved")]
        public DatumPointGeometry Resolved { get; set; }

        [JsonPropertyName("status")]
        public Status Status { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("type")]
        public DatumPointDescriptorKind? Type { get; set; }
    }

    public partial class DatumPointDefinition
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("positionMm")]
        [JsonConverter(typeof(FluffyDecodeArrayConverter))]
        public double[]? PositionMm { get; set; }

        [JsonPropertyName("type")]
        public DatumPointDefinitionType Type { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("first")]
        public DatumPointDefinitionFirst? First { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("second")]
        public DatumPointDefinitionSecond? Second { get; set; }
    }

    public partial class DatumPointDefinitionFirst
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("positionMm")]
        [JsonConverter(typeof(FluffyDecodeArrayConverter))]
        public double[]? PositionMm { get; set; }

        [JsonPropertyName("type")]
        public ThirdType Type { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("featureId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string? FeatureId { get; set; }
    }

    public partial class DatumPointDefinitionSecond
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("positionMm")]
        [JsonConverter(typeof(FluffyDecodeArrayConverter))]
        public double[]? PositionMm { get; set; }

        [JsonPropertyName("type")]
        public ThirdType Type { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("featureId")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string? FeatureId { get; set; }
    }

    public partial class DatumPointGeometry
    {
        [JsonPropertyName("positionMm")]
        public double[] PositionMm { get; set; }
    }

    public enum AxisEnum { X, Y, Z };

    public enum AxisType { Datum, Edge, Principal };

    public enum PlaneKind { Xy, Xz, Yz };

    public enum BaseType { Datum, Face, Principal };

    public enum PurpleType { Coordinates, Datum, Face, Principal };

    public enum ThirdType { Coordinates, Datum };

    public enum DefinitionType { Angle, Coordinates, Mid, Midpoint, Offset, PlaneIntersection, PlaneNormal, Principal, ThreePoint, TwoPoint };

    public enum DatumDescriptorKind { DatumAxis, DatumPlane, DatumPoint };

    public enum Status { Broken, Error, Ok };

    public enum SessionEntityPatchKind { Body, Datum, Feature, Sketch };

    public enum SessionIncrementalEventEvent { Delta };

    public enum SessionSnapshotRequiredEventEvent { SnapshotRequired };

    public enum SelectionEventEvent { Selection };

    public enum CoreRestartedEventEvent { CoreRestarted };

    public enum ConnectionState { Closing, Connected, Reconnecting };

    public enum State { Open, Pending };

    public enum DatumPlaneDefinitionType { Angle, Mid, Offset, Principal, ThreePoint };

    public enum DatumPlaneDescriptorKind { DatumPlane };

    public enum DatumAxisDefinitionType { PlaneIntersection, PlaneNormal, TwoPoint };

    public enum DatumAxisDescriptorKind { DatumAxis };

    public enum DatumPointDefinitionType { Coordinates, Midpoint };

    public enum DatumPointDescriptorKind { DatumPoint };

    internal static class Converter
    {
        public static readonly JsonSerializerOptions Settings = new(JsonSerializerDefaults.General)
        {
            Converters =
            {
                AxisEnumConverter.Singleton,
                AxisTypeConverter.Singleton,
                PlaneKindConverter.Singleton,
                BaseTypeConverter.Singleton,
                PurpleTypeConverter.Singleton,
                ThirdTypeConverter.Singleton,
                DefinitionTypeConverter.Singleton,
                DatumDescriptorKindConverter.Singleton,
                StatusConverter.Singleton,
                SessionEntityPatchKindConverter.Singleton,
                SessionIncrementalEventEventConverter.Singleton,
                SessionSnapshotRequiredEventEventConverter.Singleton,
                SelectionEventEventConverter.Singleton,
                CoreRestartedEventEventConverter.Singleton,
                ConnectionStateConverter.Singleton,
                StateConverter.Singleton,
                DatumPlaneDefinitionTypeConverter.Singleton,
                DatumAxisDefinitionTypeConverter.Singleton,
                DatumPointDefinitionTypeConverter.Singleton,
                DatumPlaneDescriptorKindConverter.Singleton,
                DatumAxisDescriptorKindConverter.Singleton,
                DatumPointDescriptorKindConverter.Singleton,
                IsoDateTimeOffsetConverter.Singleton
            },
        };
    }

    internal class PurpleMinMaxLengthCheckConverter : JsonConverter<string>
    {
        public override bool CanConvert(Type t) => t == typeof(string);

        public override string Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            if (value.Length >= 1 && value.Length <= 128)
            {
                return value;
            }
            throw new Exception("Cannot unmarshal type string");
        }

        public override void Write(Utf8JsonWriter writer, string value, JsonSerializerOptions options)
        {
            if (value.Length >= 1 && value.Length <= 128)
            {
                JsonSerializer.Serialize(writer, value, options);
                return;
            }
            throw new Exception("Cannot marshal type string");
        }

        public static readonly PurpleMinMaxLengthCheckConverter Singleton = new PurpleMinMaxLengthCheckConverter();
    }

    internal class PurpleDecodeArrayConverter : JsonConverter<string[]>
    {
        public override bool CanConvert(Type t) => t == typeof(string[]);

        public override string[] Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            reader.Read();
            var value = new List<string>();
            while (reader.TokenType != JsonTokenType.EndArray)
            {
                var converter = FluffyMinMaxLengthCheckConverter.Singleton;
                var arrayItem = (string)converter.Read(ref reader, typeof(string), options);
                value.Add(arrayItem);
                reader.Read();
            }
            return value.ToArray();
        }

        public override void Write(Utf8JsonWriter writer, string[] value, JsonSerializerOptions options)
        {
            writer.WriteStartArray();
            foreach (var arrayItem in value)
            {
                var converter = FluffyMinMaxLengthCheckConverter.Singleton;
                converter.Write(writer, arrayItem, options);
            }
            writer.WriteEndArray();
            return;
        }

        public static readonly PurpleDecodeArrayConverter Singleton = new PurpleDecodeArrayConverter();
    }

    internal class FluffyMinMaxLengthCheckConverter : JsonConverter<string>
    {
        public override bool CanConvert(Type t) => t == typeof(string);

        public override string Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            if (value.Length >= 1)
            {
                return value;
            }
            throw new Exception("Cannot unmarshal type string");
        }

        public override void Write(Utf8JsonWriter writer, string value, JsonSerializerOptions options)
        {
            if (value.Length >= 1)
            {
                JsonSerializer.Serialize(writer, value, options);
                return;
            }
            throw new Exception("Cannot marshal type string");
        }

        public static readonly FluffyMinMaxLengthCheckConverter Singleton = new FluffyMinMaxLengthCheckConverter();
    }

    internal class PurpleMinMaxValueCheckConverter : JsonConverter<double>
    {
        public override bool CanConvert(Type t) => t == typeof(double);

        public override double Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetDouble();
            if (value >= -360 && value <= 360)
            {
                return value;
            }
            throw new Exception("Cannot unmarshal type double");
        }

        public override void Write(Utf8JsonWriter writer, double value, JsonSerializerOptions options)
        {
            if (value >= -360 && value <= 360)
            {
                JsonSerializer.Serialize(writer, value, options);
                return;
            }
            throw new Exception("Cannot marshal type double");
        }

        public static readonly PurpleMinMaxValueCheckConverter Singleton = new PurpleMinMaxValueCheckConverter();
    }

    internal class AxisEnumConverter : JsonConverter<AxisEnum>
    {
        public override bool CanConvert(Type t) => t == typeof(AxisEnum);

        public override AxisEnum Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            switch (value)
            {
                case "X":
                    return AxisEnum.X;
                case "Y":
                    return AxisEnum.Y;
                case "Z":
                    return AxisEnum.Z;
            }
            throw new Exception("Cannot unmarshal type AxisEnum");
        }

        public override void Write(Utf8JsonWriter writer, AxisEnum value, JsonSerializerOptions options)
        {
            switch (value)
            {
                case AxisEnum.X:
                    JsonSerializer.Serialize(writer, "X", options);
                    return;
                case AxisEnum.Y:
                    JsonSerializer.Serialize(writer, "Y", options);
                    return;
                case AxisEnum.Z:
                    JsonSerializer.Serialize(writer, "Z", options);
                    return;
            }
            throw new Exception("Cannot marshal type AxisEnum");
        }

        public static readonly AxisEnumConverter Singleton = new AxisEnumConverter();
    }

    internal class TentacledMinMaxLengthCheckConverter : JsonConverter<string>
    {
        public override bool CanConvert(Type t) => t == typeof(string);

        public override string Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            if (value.Length >= 1 && value.Length <= 512)
            {
                return value;
            }
            throw new Exception("Cannot unmarshal type string");
        }

        public override void Write(Utf8JsonWriter writer, string value, JsonSerializerOptions options)
        {
            if (value.Length >= 1 && value.Length <= 512)
            {
                JsonSerializer.Serialize(writer, value, options);
                return;
            }
            throw new Exception("Cannot marshal type string");
        }

        public static readonly TentacledMinMaxLengthCheckConverter Singleton = new TentacledMinMaxLengthCheckConverter();
    }

    internal class StickyMinMaxLengthCheckConverter : JsonConverter<string>
    {
        public override bool CanConvert(Type t) => t == typeof(string);

        public override string Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            if (value.Length <= 128)
            {
                return value;
            }
            throw new Exception("Cannot unmarshal type string");
        }

        public override void Write(Utf8JsonWriter writer, string value, JsonSerializerOptions options)
        {
            if (value.Length <= 128)
            {
                JsonSerializer.Serialize(writer, value, options);
                return;
            }
            throw new Exception("Cannot marshal type string");
        }

        public static readonly StickyMinMaxLengthCheckConverter Singleton = new StickyMinMaxLengthCheckConverter();
    }

    internal class AxisTypeConverter : JsonConverter<AxisType>
    {
        public override bool CanConvert(Type t) => t == typeof(AxisType);

        public override AxisType Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            switch (value)
            {
                case "datum":
                    return AxisType.Datum;
                case "edge":
                    return AxisType.Edge;
                case "principal":
                    return AxisType.Principal;
            }
            throw new Exception("Cannot unmarshal type AxisType");
        }

        public override void Write(Utf8JsonWriter writer, AxisType value, JsonSerializerOptions options)
        {
            switch (value)
            {
                case AxisType.Datum:
                    JsonSerializer.Serialize(writer, "datum", options);
                    return;
                case AxisType.Edge:
                    JsonSerializer.Serialize(writer, "edge", options);
                    return;
                case AxisType.Principal:
                    JsonSerializer.Serialize(writer, "principal", options);
                    return;
            }
            throw new Exception("Cannot marshal type AxisType");
        }

        public static readonly AxisTypeConverter Singleton = new AxisTypeConverter();
    }

    internal class PlaneKindConverter : JsonConverter<PlaneKind>
    {
        public override bool CanConvert(Type t) => t == typeof(PlaneKind);

        public override PlaneKind Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            switch (value)
            {
                case "XY":
                    return PlaneKind.Xy;
                case "XZ":
                    return PlaneKind.Xz;
                case "YZ":
                    return PlaneKind.Yz;
            }
            throw new Exception("Cannot unmarshal type PlaneKind");
        }

        public override void Write(Utf8JsonWriter writer, PlaneKind value, JsonSerializerOptions options)
        {
            switch (value)
            {
                case PlaneKind.Xy:
                    JsonSerializer.Serialize(writer, "XY", options);
                    return;
                case PlaneKind.Xz:
                    JsonSerializer.Serialize(writer, "XZ", options);
                    return;
                case PlaneKind.Yz:
                    JsonSerializer.Serialize(writer, "YZ", options);
                    return;
            }
            throw new Exception("Cannot marshal type PlaneKind");
        }

        public static readonly PlaneKindConverter Singleton = new PlaneKindConverter();
    }

    internal class BaseTypeConverter : JsonConverter<BaseType>
    {
        public override bool CanConvert(Type t) => t == typeof(BaseType);

        public override BaseType Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            switch (value)
            {
                case "datum":
                    return BaseType.Datum;
                case "face":
                    return BaseType.Face;
                case "principal":
                    return BaseType.Principal;
            }
            throw new Exception("Cannot unmarshal type BaseType");
        }

        public override void Write(Utf8JsonWriter writer, BaseType value, JsonSerializerOptions options)
        {
            switch (value)
            {
                case BaseType.Datum:
                    JsonSerializer.Serialize(writer, "datum", options);
                    return;
                case BaseType.Face:
                    JsonSerializer.Serialize(writer, "face", options);
                    return;
                case BaseType.Principal:
                    JsonSerializer.Serialize(writer, "principal", options);
                    return;
            }
            throw new Exception("Cannot marshal type BaseType");
        }

        public static readonly BaseTypeConverter Singleton = new BaseTypeConverter();
    }

    internal class FluffyDecodeArrayConverter : JsonConverter<double[]>
    {
        public override bool CanConvert(Type t) => t == typeof(double[]);

        public override double[] Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            reader.Read();
            var value = new List<double>();
            while (reader.TokenType != JsonTokenType.EndArray)
            {
                var converter = FluffyMinMaxValueCheckConverter.Singleton;
                var arrayItem = (double)converter.Read(ref reader, typeof(double), options);
                value.Add(arrayItem);
                reader.Read();
            }
            return value.ToArray();
        }

        public override void Write(Utf8JsonWriter writer, double[] value, JsonSerializerOptions options)
        {
            writer.WriteStartArray();
            foreach (var arrayItem in value)
            {
                var converter = FluffyMinMaxValueCheckConverter.Singleton;
                converter.Write(writer, arrayItem, options);
            }
            writer.WriteEndArray();
            return;
        }

        public static readonly FluffyDecodeArrayConverter Singleton = new FluffyDecodeArrayConverter();
    }

    internal class FluffyMinMaxValueCheckConverter : JsonConverter<double>
    {
        public override bool CanConvert(Type t) => t == typeof(double);

        public override double Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetDouble();
            if (value >= -1000000 && value <= 1000000)
            {
                return value;
            }
            throw new Exception("Cannot unmarshal type double");
        }

        public override void Write(Utf8JsonWriter writer, double value, JsonSerializerOptions options)
        {
            if (value >= -1000000 && value <= 1000000)
            {
                JsonSerializer.Serialize(writer, value, options);
                return;
            }
            throw new Exception("Cannot marshal type double");
        }

        public static readonly FluffyMinMaxValueCheckConverter Singleton = new FluffyMinMaxValueCheckConverter();
    }

    internal class PurpleTypeConverter : JsonConverter<PurpleType>
    {
        public override bool CanConvert(Type t) => t == typeof(PurpleType);

        public override PurpleType Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            switch (value)
            {
                case "coordinates":
                    return PurpleType.Coordinates;
                case "datum":
                    return PurpleType.Datum;
                case "face":
                    return PurpleType.Face;
                case "principal":
                    return PurpleType.Principal;
            }
            throw new Exception("Cannot unmarshal type PurpleType");
        }

        public override void Write(Utf8JsonWriter writer, PurpleType value, JsonSerializerOptions options)
        {
            switch (value)
            {
                case PurpleType.Coordinates:
                    JsonSerializer.Serialize(writer, "coordinates", options);
                    return;
                case PurpleType.Datum:
                    JsonSerializer.Serialize(writer, "datum", options);
                    return;
                case PurpleType.Face:
                    JsonSerializer.Serialize(writer, "face", options);
                    return;
                case PurpleType.Principal:
                    JsonSerializer.Serialize(writer, "principal", options);
                    return;
            }
            throw new Exception("Cannot marshal type PurpleType");
        }

        public static readonly PurpleTypeConverter Singleton = new PurpleTypeConverter();
    }

    internal class ThirdTypeConverter : JsonConverter<ThirdType>
    {
        public override bool CanConvert(Type t) => t == typeof(ThirdType);

        public override ThirdType Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            switch (value)
            {
                case "coordinates":
                    return ThirdType.Coordinates;
                case "datum":
                    return ThirdType.Datum;
            }
            throw new Exception("Cannot unmarshal type ThirdType");
        }

        public override void Write(Utf8JsonWriter writer, ThirdType value, JsonSerializerOptions options)
        {
            switch (value)
            {
                case ThirdType.Coordinates:
                    JsonSerializer.Serialize(writer, "coordinates", options);
                    return;
                case ThirdType.Datum:
                    JsonSerializer.Serialize(writer, "datum", options);
                    return;
            }
            throw new Exception("Cannot marshal type ThirdType");
        }

        public static readonly ThirdTypeConverter Singleton = new ThirdTypeConverter();
    }

    internal class DefinitionTypeConverter : JsonConverter<DefinitionType>
    {
        public override bool CanConvert(Type t) => t == typeof(DefinitionType);

        public override DefinitionType Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            switch (value)
            {
                case "angle":
                    return DefinitionType.Angle;
                case "coordinates":
                    return DefinitionType.Coordinates;
                case "mid":
                    return DefinitionType.Mid;
                case "midpoint":
                    return DefinitionType.Midpoint;
                case "offset":
                    return DefinitionType.Offset;
                case "planeIntersection":
                    return DefinitionType.PlaneIntersection;
                case "planeNormal":
                    return DefinitionType.PlaneNormal;
                case "principal":
                    return DefinitionType.Principal;
                case "threePoint":
                    return DefinitionType.ThreePoint;
                case "twoPoint":
                    return DefinitionType.TwoPoint;
            }
            throw new Exception("Cannot unmarshal type DefinitionType");
        }

        public override void Write(Utf8JsonWriter writer, DefinitionType value, JsonSerializerOptions options)
        {
            switch (value)
            {
                case DefinitionType.Angle:
                    JsonSerializer.Serialize(writer, "angle", options);
                    return;
                case DefinitionType.Coordinates:
                    JsonSerializer.Serialize(writer, "coordinates", options);
                    return;
                case DefinitionType.Mid:
                    JsonSerializer.Serialize(writer, "mid", options);
                    return;
                case DefinitionType.Midpoint:
                    JsonSerializer.Serialize(writer, "midpoint", options);
                    return;
                case DefinitionType.Offset:
                    JsonSerializer.Serialize(writer, "offset", options);
                    return;
                case DefinitionType.PlaneIntersection:
                    JsonSerializer.Serialize(writer, "planeIntersection", options);
                    return;
                case DefinitionType.PlaneNormal:
                    JsonSerializer.Serialize(writer, "planeNormal", options);
                    return;
                case DefinitionType.Principal:
                    JsonSerializer.Serialize(writer, "principal", options);
                    return;
                case DefinitionType.ThreePoint:
                    JsonSerializer.Serialize(writer, "threePoint", options);
                    return;
                case DefinitionType.TwoPoint:
                    JsonSerializer.Serialize(writer, "twoPoint", options);
                    return;
            }
            throw new Exception("Cannot marshal type DefinitionType");
        }

        public static readonly DefinitionTypeConverter Singleton = new DefinitionTypeConverter();
    }

    internal class TentacledDecodeArrayConverter : JsonConverter<string[]>
    {
        public override bool CanConvert(Type t) => t == typeof(string[]);

        public override string[] Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            reader.Read();
            var value = new List<string>();
            while (reader.TokenType != JsonTokenType.EndArray)
            {
                var converter = PurpleMinMaxLengthCheckConverter.Singleton;
                var arrayItem = (string)converter.Read(ref reader, typeof(string), options);
                value.Add(arrayItem);
                reader.Read();
            }
            return value.ToArray();
        }

        public override void Write(Utf8JsonWriter writer, string[] value, JsonSerializerOptions options)
        {
            writer.WriteStartArray();
            foreach (var arrayItem in value)
            {
                var converter = PurpleMinMaxLengthCheckConverter.Singleton;
                converter.Write(writer, arrayItem, options);
            }
            writer.WriteEndArray();
            return;
        }

        public static readonly TentacledDecodeArrayConverter Singleton = new TentacledDecodeArrayConverter();
    }

    internal class DatumDescriptorKindConverter : JsonConverter<DatumDescriptorKind>
    {
        public override bool CanConvert(Type t) => t == typeof(DatumDescriptorKind);

        public override DatumDescriptorKind Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            switch (value)
            {
                case "DatumAxis":
                    return DatumDescriptorKind.DatumAxis;
                case "DatumPlane":
                    return DatumDescriptorKind.DatumPlane;
                case "DatumPoint":
                    return DatumDescriptorKind.DatumPoint;
            }
            throw new Exception("Cannot unmarshal type DatumDescriptorKind");
        }

        public override void Write(Utf8JsonWriter writer, DatumDescriptorKind value, JsonSerializerOptions options)
        {
            switch (value)
            {
                case DatumDescriptorKind.DatumAxis:
                    JsonSerializer.Serialize(writer, "DatumAxis", options);
                    return;
                case DatumDescriptorKind.DatumPlane:
                    JsonSerializer.Serialize(writer, "DatumPlane", options);
                    return;
                case DatumDescriptorKind.DatumPoint:
                    JsonSerializer.Serialize(writer, "DatumPoint", options);
                    return;
            }
            throw new Exception("Cannot marshal type DatumDescriptorKind");
        }

        public static readonly DatumDescriptorKindConverter Singleton = new DatumDescriptorKindConverter();
    }

    internal class StatusConverter : JsonConverter<Status>
    {
        public override bool CanConvert(Type t) => t == typeof(Status);

        public override Status Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            switch (value)
            {
                case "broken":
                    return Status.Broken;
                case "error":
                    return Status.Error;
                case "ok":
                    return Status.Ok;
            }
            throw new Exception("Cannot unmarshal type Status");
        }

        public override void Write(Utf8JsonWriter writer, Status value, JsonSerializerOptions options)
        {
            switch (value)
            {
                case Status.Broken:
                    JsonSerializer.Serialize(writer, "broken", options);
                    return;
                case Status.Error:
                    JsonSerializer.Serialize(writer, "error", options);
                    return;
                case Status.Ok:
                    JsonSerializer.Serialize(writer, "ok", options);
                    return;
            }
            throw new Exception("Cannot marshal type Status");
        }

        public static readonly StatusConverter Singleton = new StatusConverter();
    }

    internal class SessionEntityPatchKindConverter : JsonConverter<SessionEntityPatchKind>
    {
        public override bool CanConvert(Type t) => t == typeof(SessionEntityPatchKind);

        public override SessionEntityPatchKind Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            switch (value)
            {
                case "body":
                    return SessionEntityPatchKind.Body;
                case "datum":
                    return SessionEntityPatchKind.Datum;
                case "feature":
                    return SessionEntityPatchKind.Feature;
                case "sketch":
                    return SessionEntityPatchKind.Sketch;
            }
            throw new Exception("Cannot unmarshal type SessionEntityPatchKind");
        }

        public override void Write(Utf8JsonWriter writer, SessionEntityPatchKind value, JsonSerializerOptions options)
        {
            switch (value)
            {
                case SessionEntityPatchKind.Body:
                    JsonSerializer.Serialize(writer, "body", options);
                    return;
                case SessionEntityPatchKind.Datum:
                    JsonSerializer.Serialize(writer, "datum", options);
                    return;
                case SessionEntityPatchKind.Feature:
                    JsonSerializer.Serialize(writer, "feature", options);
                    return;
                case SessionEntityPatchKind.Sketch:
                    JsonSerializer.Serialize(writer, "sketch", options);
                    return;
            }
            throw new Exception("Cannot marshal type SessionEntityPatchKind");
        }

        public static readonly SessionEntityPatchKindConverter Singleton = new SessionEntityPatchKindConverter();
    }

    internal class SessionIncrementalEventEventConverter : JsonConverter<SessionIncrementalEventEvent>
    {
        public override bool CanConvert(Type t) => t == typeof(SessionIncrementalEventEvent);

        public override SessionIncrementalEventEvent Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            if (value == "delta")
            {
                return SessionIncrementalEventEvent.Delta;
            }
            throw new Exception("Cannot unmarshal type SessionIncrementalEventEvent");
        }

        public override void Write(Utf8JsonWriter writer, SessionIncrementalEventEvent value, JsonSerializerOptions options)
        {
            if (value == SessionIncrementalEventEvent.Delta)
            {
                JsonSerializer.Serialize(writer, "delta", options);
                return;
            }
            throw new Exception("Cannot marshal type SessionIncrementalEventEvent");
        }

        public static readonly SessionIncrementalEventEventConverter Singleton = new SessionIncrementalEventEventConverter();
    }

    internal class SessionSnapshotRequiredEventEventConverter : JsonConverter<SessionSnapshotRequiredEventEvent>
    {
        public override bool CanConvert(Type t) => t == typeof(SessionSnapshotRequiredEventEvent);

        public override SessionSnapshotRequiredEventEvent Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            if (value == "snapshot-required")
            {
                return SessionSnapshotRequiredEventEvent.SnapshotRequired;
            }
            throw new Exception("Cannot unmarshal type SessionSnapshotRequiredEventEvent");
        }

        public override void Write(Utf8JsonWriter writer, SessionSnapshotRequiredEventEvent value, JsonSerializerOptions options)
        {
            if (value == SessionSnapshotRequiredEventEvent.SnapshotRequired)
            {
                JsonSerializer.Serialize(writer, "snapshot-required", options);
                return;
            }
            throw new Exception("Cannot marshal type SessionSnapshotRequiredEventEvent");
        }

        public static readonly SessionSnapshotRequiredEventEventConverter Singleton = new SessionSnapshotRequiredEventEventConverter();
    }

    internal class SelectionEventEventConverter : JsonConverter<SelectionEventEvent>
    {
        public override bool CanConvert(Type t) => t == typeof(SelectionEventEvent);

        public override SelectionEventEvent Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            if (value == "selection")
            {
                return SelectionEventEvent.Selection;
            }
            throw new Exception("Cannot unmarshal type SelectionEventEvent");
        }

        public override void Write(Utf8JsonWriter writer, SelectionEventEvent value, JsonSerializerOptions options)
        {
            if (value == SelectionEventEvent.Selection)
            {
                JsonSerializer.Serialize(writer, "selection", options);
                return;
            }
            throw new Exception("Cannot marshal type SelectionEventEvent");
        }

        public static readonly SelectionEventEventConverter Singleton = new SelectionEventEventConverter();
    }

    internal class CoreRestartedEventEventConverter : JsonConverter<CoreRestartedEventEvent>
    {
        public override bool CanConvert(Type t) => t == typeof(CoreRestartedEventEvent);

        public override CoreRestartedEventEvent Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            if (value == "core-restarted")
            {
                return CoreRestartedEventEvent.CoreRestarted;
            }
            throw new Exception("Cannot unmarshal type CoreRestartedEventEvent");
        }

        public override void Write(Utf8JsonWriter writer, CoreRestartedEventEvent value, JsonSerializerOptions options)
        {
            if (value == CoreRestartedEventEvent.CoreRestarted)
            {
                JsonSerializer.Serialize(writer, "core-restarted", options);
                return;
            }
            throw new Exception("Cannot marshal type CoreRestartedEventEvent");
        }

        public static readonly CoreRestartedEventEventConverter Singleton = new CoreRestartedEventEventConverter();
    }

    internal class IndigoMinMaxLengthCheckConverter : JsonConverter<string>
    {
        public override bool CanConvert(Type t) => t == typeof(string);

        public override string Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            if (value.Length >= 1 && value.Length <= 80)
            {
                return value;
            }
            throw new Exception("Cannot unmarshal type string");
        }

        public override void Write(Utf8JsonWriter writer, string value, JsonSerializerOptions options)
        {
            if (value.Length >= 1 && value.Length <= 80)
            {
                JsonSerializer.Serialize(writer, value, options);
                return;
            }
            throw new Exception("Cannot marshal type string");
        }

        public static readonly IndigoMinMaxLengthCheckConverter Singleton = new IndigoMinMaxLengthCheckConverter();
    }

    internal class ConnectionStateConverter : JsonConverter<ConnectionState>
    {
        public override bool CanConvert(Type t) => t == typeof(ConnectionState);

        public override ConnectionState Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            switch (value)
            {
                case "closing":
                    return ConnectionState.Closing;
                case "connected":
                    return ConnectionState.Connected;
                case "reconnecting":
                    return ConnectionState.Reconnecting;
            }
            throw new Exception("Cannot unmarshal type ConnectionState");
        }

        public override void Write(Utf8JsonWriter writer, ConnectionState value, JsonSerializerOptions options)
        {
            switch (value)
            {
                case ConnectionState.Closing:
                    JsonSerializer.Serialize(writer, "closing", options);
                    return;
                case ConnectionState.Connected:
                    JsonSerializer.Serialize(writer, "connected", options);
                    return;
                case ConnectionState.Reconnecting:
                    JsonSerializer.Serialize(writer, "reconnecting", options);
                    return;
            }
            throw new Exception("Cannot marshal type ConnectionState");
        }

        public static readonly ConnectionStateConverter Singleton = new ConnectionStateConverter();
    }

    internal class StateConverter : JsonConverter<State>
    {
        public override bool CanConvert(Type t) => t == typeof(State);

        public override State Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            switch (value)
            {
                case "open":
                    return State.Open;
                case "pending":
                    return State.Pending;
            }
            throw new Exception("Cannot unmarshal type State");
        }

        public override void Write(Utf8JsonWriter writer, State value, JsonSerializerOptions options)
        {
            switch (value)
            {
                case State.Open:
                    JsonSerializer.Serialize(writer, "open", options);
                    return;
                case State.Pending:
                    JsonSerializer.Serialize(writer, "pending", options);
                    return;
            }
            throw new Exception("Cannot marshal type State");
        }

        public static readonly StateConverter Singleton = new StateConverter();
    }

    internal class IndecentMinMaxLengthCheckConverter : JsonConverter<string>
    {
        public override bool CanConvert(Type t) => t == typeof(string);

        public override string Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            if (value.Length >= 1 && value.Length <= 128)
            {
                return value;
            }
            throw new Exception("Cannot unmarshal type string");
        }

        public override void Write(Utf8JsonWriter writer, string value, JsonSerializerOptions options)
        {
            if (value.Length >= 1 && value.Length <= 128)
            {
                JsonSerializer.Serialize(writer, value, options);
                return;
            }
            throw new Exception("Cannot marshal type string");
        }

        public static readonly IndecentMinMaxLengthCheckConverter Singleton = new IndecentMinMaxLengthCheckConverter();
    }

    internal class StickyDecodeArrayConverter : JsonConverter<string[]>
    {
        public override bool CanConvert(Type t) => t == typeof(string[]);

        public override string[] Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            reader.Read();
            var value = new List<string>();
            while (reader.TokenType != JsonTokenType.EndArray)
            {
                var converter = TentacledMinMaxLengthCheckConverter.Singleton;
                var arrayItem = (string)converter.Read(ref reader, typeof(string), options);
                value.Add(arrayItem);
                reader.Read();
            }
            return value.ToArray();
        }

        public override void Write(Utf8JsonWriter writer, string[] value, JsonSerializerOptions options)
        {
            writer.WriteStartArray();
            foreach (var arrayItem in value)
            {
                var converter = TentacledMinMaxLengthCheckConverter.Singleton;
                converter.Write(writer, arrayItem, options);
            }
            writer.WriteEndArray();
            return;
        }

        public static readonly StickyDecodeArrayConverter Singleton = new StickyDecodeArrayConverter();
    }

    internal class DatumPlaneDefinitionTypeConverter : JsonConverter<DatumPlaneDefinitionType>
    {
        public override bool CanConvert(Type t) => t == typeof(DatumPlaneDefinitionType);

        public override DatumPlaneDefinitionType Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            switch (value)
            {
                case "angle":
                    return DatumPlaneDefinitionType.Angle;
                case "mid":
                    return DatumPlaneDefinitionType.Mid;
                case "offset":
                    return DatumPlaneDefinitionType.Offset;
                case "principal":
                    return DatumPlaneDefinitionType.Principal;
                case "threePoint":
                    return DatumPlaneDefinitionType.ThreePoint;
            }
            throw new Exception("Cannot unmarshal type DatumPlaneDefinitionType");
        }

        public override void Write(Utf8JsonWriter writer, DatumPlaneDefinitionType value, JsonSerializerOptions options)
        {
            switch (value)
            {
                case DatumPlaneDefinitionType.Angle:
                    JsonSerializer.Serialize(writer, "angle", options);
                    return;
                case DatumPlaneDefinitionType.Mid:
                    JsonSerializer.Serialize(writer, "mid", options);
                    return;
                case DatumPlaneDefinitionType.Offset:
                    JsonSerializer.Serialize(writer, "offset", options);
                    return;
                case DatumPlaneDefinitionType.Principal:
                    JsonSerializer.Serialize(writer, "principal", options);
                    return;
                case DatumPlaneDefinitionType.ThreePoint:
                    JsonSerializer.Serialize(writer, "threePoint", options);
                    return;
            }
            throw new Exception("Cannot marshal type DatumPlaneDefinitionType");
        }

        public static readonly DatumPlaneDefinitionTypeConverter Singleton = new DatumPlaneDefinitionTypeConverter();
    }

    internal class DatumAxisDefinitionTypeConverter : JsonConverter<DatumAxisDefinitionType>
    {
        public override bool CanConvert(Type t) => t == typeof(DatumAxisDefinitionType);

        public override DatumAxisDefinitionType Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            switch (value)
            {
                case "planeIntersection":
                    return DatumAxisDefinitionType.PlaneIntersection;
                case "planeNormal":
                    return DatumAxisDefinitionType.PlaneNormal;
                case "twoPoint":
                    return DatumAxisDefinitionType.TwoPoint;
            }
            throw new Exception("Cannot unmarshal type DatumAxisDefinitionType");
        }

        public override void Write(Utf8JsonWriter writer, DatumAxisDefinitionType value, JsonSerializerOptions options)
        {
            switch (value)
            {
                case DatumAxisDefinitionType.PlaneIntersection:
                    JsonSerializer.Serialize(writer, "planeIntersection", options);
                    return;
                case DatumAxisDefinitionType.PlaneNormal:
                    JsonSerializer.Serialize(writer, "planeNormal", options);
                    return;
                case DatumAxisDefinitionType.TwoPoint:
                    JsonSerializer.Serialize(writer, "twoPoint", options);
                    return;
            }
            throw new Exception("Cannot marshal type DatumAxisDefinitionType");
        }

        public static readonly DatumAxisDefinitionTypeConverter Singleton = new DatumAxisDefinitionTypeConverter();
    }

    internal class DatumPointDefinitionTypeConverter : JsonConverter<DatumPointDefinitionType>
    {
        public override bool CanConvert(Type t) => t == typeof(DatumPointDefinitionType);

        public override DatumPointDefinitionType Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            switch (value)
            {
                case "coordinates":
                    return DatumPointDefinitionType.Coordinates;
                case "midpoint":
                    return DatumPointDefinitionType.Midpoint;
            }
            throw new Exception("Cannot unmarshal type DatumPointDefinitionType");
        }

        public override void Write(Utf8JsonWriter writer, DatumPointDefinitionType value, JsonSerializerOptions options)
        {
            switch (value)
            {
                case DatumPointDefinitionType.Coordinates:
                    JsonSerializer.Serialize(writer, "coordinates", options);
                    return;
                case DatumPointDefinitionType.Midpoint:
                    JsonSerializer.Serialize(writer, "midpoint", options);
                    return;
            }
            throw new Exception("Cannot marshal type DatumPointDefinitionType");
        }

        public static readonly DatumPointDefinitionTypeConverter Singleton = new DatumPointDefinitionTypeConverter();
    }

    internal class DatumPlaneDescriptorKindConverter : JsonConverter<DatumPlaneDescriptorKind>
    {
        public override bool CanConvert(Type t) => t == typeof(DatumPlaneDescriptorKind);

        public override DatumPlaneDescriptorKind Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            if (value == "DatumPlane")
            {
                return DatumPlaneDescriptorKind.DatumPlane;
            }
            throw new Exception("Cannot unmarshal type DatumPlaneDescriptorKind");
        }

        public override void Write(Utf8JsonWriter writer, DatumPlaneDescriptorKind value, JsonSerializerOptions options)
        {
            if (value == DatumPlaneDescriptorKind.DatumPlane)
            {
                JsonSerializer.Serialize(writer, "DatumPlane", options);
                return;
            }
            throw new Exception("Cannot marshal type DatumPlaneDescriptorKind");
        }

        public static readonly DatumPlaneDescriptorKindConverter Singleton = new DatumPlaneDescriptorKindConverter();
    }

    internal class DatumAxisDescriptorKindConverter : JsonConverter<DatumAxisDescriptorKind>
    {
        public override bool CanConvert(Type t) => t == typeof(DatumAxisDescriptorKind);

        public override DatumAxisDescriptorKind Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            if (value == "DatumAxis")
            {
                return DatumAxisDescriptorKind.DatumAxis;
            }
            throw new Exception("Cannot unmarshal type DatumAxisDescriptorKind");
        }

        public override void Write(Utf8JsonWriter writer, DatumAxisDescriptorKind value, JsonSerializerOptions options)
        {
            if (value == DatumAxisDescriptorKind.DatumAxis)
            {
                JsonSerializer.Serialize(writer, "DatumAxis", options);
                return;
            }
            throw new Exception("Cannot marshal type DatumAxisDescriptorKind");
        }

        public static readonly DatumAxisDescriptorKindConverter Singleton = new DatumAxisDescriptorKindConverter();
    }

    internal class DatumPointDescriptorKindConverter : JsonConverter<DatumPointDescriptorKind>
    {
        public override bool CanConvert(Type t) => t == typeof(DatumPointDescriptorKind);

        public override DatumPointDescriptorKind Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            if (value == "DatumPoint")
            {
                return DatumPointDescriptorKind.DatumPoint;
            }
            throw new Exception("Cannot unmarshal type DatumPointDescriptorKind");
        }

        public override void Write(Utf8JsonWriter writer, DatumPointDescriptorKind value, JsonSerializerOptions options)
        {
            if (value == DatumPointDescriptorKind.DatumPoint)
            {
                JsonSerializer.Serialize(writer, "DatumPoint", options);
                return;
            }
            throw new Exception("Cannot marshal type DatumPointDescriptorKind");
        }

        public static readonly DatumPointDescriptorKindConverter Singleton = new DatumPointDescriptorKindConverter();
    }

    internal class IsoDateTimeOffsetConverter : JsonConverter<DateTimeOffset>
    {
        public override bool CanConvert(Type t) => t == typeof(DateTimeOffset);

        private const string DefaultDateTimeFormat = "yyyy'-'MM'-'dd'T'HH':'mm':'ss.FFFFFFFK";

        private DateTimeStyles _dateTimeStyles = DateTimeStyles.RoundtripKind;
        private string? _dateTimeFormat;
        private CultureInfo? _culture;

        public DateTimeStyles DateTimeStyles
        {
                get => _dateTimeStyles;
                set => _dateTimeStyles = value;
        }

        public string? DateTimeFormat
        {
                get => _dateTimeFormat ?? string.Empty;
                set => _dateTimeFormat = (string.IsNullOrEmpty(value)) ? null : value;
        }

        public CultureInfo Culture
        {
                get => _culture ?? CultureInfo.CurrentCulture;
                set => _culture = value;
        }

        public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options)
        {
                string text;


                if ((_dateTimeStyles & DateTimeStyles.AdjustToUniversal) == DateTimeStyles.AdjustToUniversal
                        || (_dateTimeStyles & DateTimeStyles.AssumeUniversal) == DateTimeStyles.AssumeUniversal)
                {
                        value = value.ToUniversalTime();
                }

                text = value.ToString(_dateTimeFormat ?? DefaultDateTimeFormat, Culture);

                writer.WriteStringValue(text);
        }

        public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
                string? dateText = reader.GetString();

                if (string.IsNullOrEmpty(dateText) == false)
                {
                        if (!string.IsNullOrEmpty(_dateTimeFormat))
                        {
                                return DateTimeOffset.ParseExact(dateText, _dateTimeFormat, Culture, _dateTimeStyles);
                        }
                        else
                        {
                                return DateTimeOffset.Parse(dateText, Culture, _dateTimeStyles);
                        }
                }
                else
                {
                        return default(DateTimeOffset);
                }
        }


        public static readonly IsoDateTimeOffsetConverter Singleton = new IsoDateTimeOffsetConverter();
    }
}

