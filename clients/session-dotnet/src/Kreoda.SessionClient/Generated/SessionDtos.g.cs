// Generated from schemas/session-control-v1.json. Do not edit.
// Source SHA256: 93e9e8283b745c4ea77c001d2093ec711161c16ad847705b1c5b194f8fb67ef5
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
        [JsonConverter(typeof(DecodeArrayConverter))]
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
        [JsonConverter(typeof(DecodeArrayConverter))]
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
        [JsonConverter(typeof(DecodeArrayConverter))]
        public string[]? Tips { get; set; }
    }

    public partial class BodyDescriptor
    {
        [JsonPropertyName("bodyId")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string BodyId { get; set; }

        [JsonPropertyName("history")]
        [JsonConverter(typeof(DecodeArrayConverter))]
        public string[] History { get; set; }

        [JsonPropertyName("tip")]
        [JsonConverter(typeof(PurpleMinMaxLengthCheckConverter))]
        public string Tip { get; set; }
    }

    public partial class FeatureDescriptor
    {
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("dependsOn")]
        [JsonConverter(typeof(DecodeArrayConverter))]
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
        public Dictionary<string, object>? Plane { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("planeKind")]
        [JsonConverter(typeof(FluffyMinMaxLengthCheckConverter))]
        public string? PlaneKind { get; set; }

        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        [JsonPropertyName("supportRef")]
        public string? SupportRef { get; set; }
    }

    public partial class SessionIncrementalEvent
    {
        [JsonPropertyName("added")]
        public SessionEntityPatch[] Added { get; set; }

        [JsonPropertyName("baseRevision")]
        public long BaseRevision { get; set; }

        [JsonPropertyName("changedMeshIds")]
        [JsonConverter(typeof(DecodeArrayConverter))]
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
        [JsonConverter(typeof(DecodeArrayConverter))]
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
        public Kind Kind { get; set; }

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

        [JsonPropertyName("event")]
        public SelectionEventEvent Event { get; set; }

        [JsonPropertyName("ids")]
        [JsonConverter(typeof(DecodeArrayConverter))]
        public string[] Ids { get; set; }
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
        [JsonConverter(typeof(TentacledMinMaxLengthCheckConverter))]
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

    public enum Kind { Body, Feature, Sketch };

    public enum SessionIncrementalEventEvent { Delta };

    public enum SessionSnapshotRequiredEventEvent { SnapshotRequired };

    public enum SelectionEventEvent { Selection };

    public enum CoreRestartedEventEvent { CoreRestarted };

    internal static class Converter
    {
        public static readonly JsonSerializerOptions Settings = new(JsonSerializerDefaults.General)
        {
            Converters =
            {
                KindConverter.Singleton,
                SessionIncrementalEventEventConverter.Singleton,
                SessionSnapshotRequiredEventEventConverter.Singleton,
                SelectionEventEventConverter.Singleton,
                CoreRestartedEventEventConverter.Singleton,
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

    internal class DecodeArrayConverter : JsonConverter<string[]>
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

        public static readonly DecodeArrayConverter Singleton = new DecodeArrayConverter();
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

    internal class KindConverter : JsonConverter<Kind>
    {
        public override bool CanConvert(Type t) => t == typeof(Kind);

        public override Kind Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            switch (value)
            {
                case "body":
                    return Kind.Body;
                case "feature":
                    return Kind.Feature;
                case "sketch":
                    return Kind.Sketch;
            }
            throw new Exception("Cannot unmarshal type Kind");
        }

        public override void Write(Utf8JsonWriter writer, Kind value, JsonSerializerOptions options)
        {
            switch (value)
            {
                case Kind.Body:
                    JsonSerializer.Serialize(writer, "body", options);
                    return;
                case Kind.Feature:
                    JsonSerializer.Serialize(writer, "feature", options);
                    return;
                case Kind.Sketch:
                    JsonSerializer.Serialize(writer, "sketch", options);
                    return;
            }
            throw new Exception("Cannot marshal type Kind");
        }

        public static readonly KindConverter Singleton = new KindConverter();
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

    internal class TentacledMinMaxLengthCheckConverter : JsonConverter<string>
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

        public static readonly TentacledMinMaxLengthCheckConverter Singleton = new TentacledMinMaxLengthCheckConverter();
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

