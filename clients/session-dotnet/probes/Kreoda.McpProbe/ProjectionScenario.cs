using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text;
using Kreoda.Session;
using ModelContextProtocol.Client;

internal static class ProjectionScenario
{
    private const string DocumentId = "doc-phase1";
    private const double RadiusFiveVolume = Math.PI * 25 * 10;
    private const double RadiusSixVolume = Math.PI * 36 * 10;

    private static void Check(bool value, string message)
    {
        if (!value) throw new InvalidOperationException(message);
    }

    private static object Sketch(double radius, bool includeCircle = true, bool includeSpare = true)
    {
        var points = new List<object> { new { id = "center", x = 0d, y = 0d, @fixed = true } };
        var circles = new List<object>();
        if (includeCircle) circles.Add(new { id = "circle", center = "center", r = radius });
        if (includeSpare)
        {
            points.Add(new { id = "spare-center", x = 20d, y = 0d, @fixed = true });
            circles.Add(new { id = "spare", center = "spare-center", r = 2d });
        }
        return new
        {
            points = points.ToArray(), lines = Array.Empty<object>(), circles = circles.ToArray(),
            arcs = Array.Empty<object>(), constraints = Array.Empty<object>(),
        };
    }

    private static object Definition(string sourceId, string entityId = "circle") => new
    {
        version = 1, operation = "projectEdges",
        sources = new[] { new { type = "sketchEntities", featureId = sourceId, entityIds = new[] { entityId } } },
    };

    private static int Count(byte[] bytes, byte[] value)
    {
        var count = 0;
        for (var index = 0; index <= bytes.Length - value.Length; index++)
        {
            var matched = true;
            for (var offset = 0; offset < value.Length; offset++)
                if (bytes[index + offset] != value[offset]) { matched = false; break; }
            if (matched) count++;
        }
        return count;
    }

    private static int CountAligned(byte[] bytes, byte[] value, int alignment)
    {
        var count = 0;
        for (var index = alignment; index <= bytes.Length - value.Length; index += 2)
        {
            var matched = true;
            for (var offset = 0; offset < value.Length; offset++)
                if (bytes[index + offset] != value[offset]) { matched = false; break; }
            if (matched) count++;
        }
        return count;
    }

    private static int ReplaceExactlyOne(byte[] bytes, byte[] oldValue, byte[] newValue)
    {
        if (oldValue.Length != newValue.Length) throw new InvalidOperationException("archive rewrite must preserve byte length");
        var found = -1;
        for (var index = 0; index <= bytes.Length - oldValue.Length; index++)
        {
            var matched = true;
            for (var offset = 0; offset < oldValue.Length; offset++)
                if (bytes[index + offset] != oldValue[offset]) { matched = false; break; }
            if (!matched) continue;
            if (found >= 0) throw new InvalidOperationException("serialized authored entity token is not unique");
            found = index;
        }
        if (found < 0) throw new InvalidOperationException("serialized authored entity token was not found");
        Buffer.BlockCopy(newValue, 0, bytes, found, newValue.Length);
        return found;
    }

    internal static object BreakPersistedProjectionBindingArchive(string healthyPath, string brokenPath)
    {
        if (!File.Exists(healthyPath)) throw new FileNotFoundException("healthy native project archive is missing", healthyPath);
        if (File.Exists(brokenPath)) throw new IOException("broken archive target already exists");
        if (Path.GetFullPath(healthyPath).Equals(Path.GetFullPath(brokenPath), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("source and target archive paths must differ");

        byte[] originalXbf;
        using (var source = ZipFile.OpenRead(healthyPath))
        {
            var entry = source.GetEntry("document.xbf") ?? throw new InvalidDataException("native .icad archive has no document.xbf entry");
            using var input = entry.Open();
            using var memory = new MemoryStream();
            input.CopyTo(memory);
            originalXbf = memory.ToArray();
        }

        var encodings = new (string Name, Encoding Encoding)[]
        {
            ("utf8", new UTF8Encoding(false, true)),
            ("utf16-le", Encoding.Unicode),
            ("utf16-be", Encoding.BigEndianUnicode),
        };
        var candidates = encodings.Select(candidate =>
        {
            var oldToken = candidate.Encoding.GetBytes("\"id\":\"circle\"");
            var binding = candidate.Encoding.GetBytes("\"entityIds\":[\"circle\"]");
            var authoredRecord = candidate.Encoding.GetBytes("{\"id\":\"circle\"");
            var bindingProperty = candidate.Encoding.GetBytes("[{\"entityIds\":[\"circle\"]");
            return new
            {
                candidate.Name, candidate.Encoding, OldToken = oldToken, Binding = binding,
                AuthoredOccurrences = candidate.Name == "utf8" ? Count(originalXbf, oldToken) : CountAligned(originalXbf, oldToken, 0),
                BindingOccurrences = candidate.Name == "utf8" ? Count(originalXbf, binding) : CountAligned(originalXbf, binding, 0),
                AuthoredRecordOccurrences = candidate.Name == "utf8" ? Count(originalXbf, authoredRecord) : CountAligned(originalXbf, authoredRecord, 0),
                BindingPropertyOccurrences = candidate.Name == "utf8" ? Count(originalXbf, bindingProperty) : CountAligned(originalXbf, bindingProperty, 0),
            };
        }).Where(candidate => candidate.AuthoredOccurrences == 1 && candidate.BindingOccurrences >= 1 &&
            candidate.AuthoredRecordOccurrences == 1 && candidate.BindingPropertyOccurrences >= 1).ToArray();
        Check(candidates.Length == 1,
            $"expected one encoding with a unique authored circle token and retained binding; found {candidates.Length}; " +
            string.Join("; ", encodings.Select(candidate =>
            {
                var token = candidate.Encoding.GetBytes("\"id\":\"circle\"");
                var binding = candidate.Encoding.GetBytes("\"entityIds\":[\"circle\"]");
                var authoredRecord = candidate.Encoding.GetBytes("{\"id\":\"circle\"");
                var bindingProperty = candidate.Encoding.GetBytes("[{\"entityIds\":[\"circle\"]");
                int CandidateCount(byte[] value) => candidate.Name == "utf8"
                    ? Count(originalXbf, value) : CountAligned(originalXbf, value, 0);
                return $"{candidate.Name}: authored={CandidateCount(token)}, binding={CandidateCount(binding)}, " +
                    $"authored-record={CandidateCount(authoredRecord)}, binding-property={CandidateCount(bindingProperty)}";
            })));
        var selected = candidates[0];
        var replacement = selected.Encoding.GetBytes("\"id\":\"circlX\"");
        var brokenXbf = (byte[])originalXbf.Clone();
        var replacedOffset = ReplaceExactlyOne(brokenXbf, selected.OldToken, replacement);
        Check(Count(brokenXbf, selected.OldToken) == 0 && Count(brokenXbf, selected.Encoding.GetBytes("\"id\":\"circlX\"")) == 1,
            "archive rewrite did not replace exactly the authored circle id");
        Check(Count(brokenXbf, selected.Binding) == selected.BindingOccurrences,
            "archive rewrite changed the projection definition binding");

        using (var output = File.Create(brokenPath))
        using (var destination = new ZipArchive(output, ZipArchiveMode.Create))
        using (var source = ZipFile.OpenRead(healthyPath))
        {
            var xbfEntries = 0;
            foreach (var entry in source.Entries)
            {
                var copy = destination.CreateEntry(entry.FullName, CompressionLevel.Optimal);
                copy.LastWriteTime = entry.LastWriteTime;
                using var target = copy.Open();
                using var content = entry.Open();
                if (entry.FullName == "document.xbf")
                {
                    xbfEntries++;
                    target.Write(brokenXbf);
                }
                else content.CopyTo(target);
            }
            Check(xbfEntries == 1, "native .icad archive must contain exactly one document.xbf entry");
        }

        using (var verify = ZipFile.OpenRead(brokenPath))
        {
            var entry = verify.GetEntry("document.xbf") ?? throw new InvalidDataException("rewritten project archive lost document.xbf");
            using var input = entry.Open();
            using var memory = new MemoryStream();
            input.CopyTo(memory);
            var reread = memory.ToArray();
            Check(reread.Length == originalXbf.Length && SHA256.HashData(reread).SequenceEqual(SHA256.HashData(brokenXbf)),
                "rewritten XBF bytes failed the post-write hash/length check");
            Check(Count(reread, selected.OldToken) == 0 && Count(reread, selected.Binding) == selected.BindingOccurrences,
                "rewritten XBF lost or changed its broken-reference fixture");
        }

        return new
        {
            scenario = "projection-archive-break", status = "rewritten",
            encoding = selected.Name, archiveEntry = "document.xbf", replacedOffset,
            replacementCount = 1, oldToken = "circle", newToken = "circlX",
            projectionBindingOccurrences = selected.BindingOccurrences,
            xbfBytesBefore = originalXbf.Length, xbfBytesAfter = brokenXbf.Length,
            healthyArchiveSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(healthyPath))).ToLowerInvariant(),
            brokenArchiveSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(brokenPath))).ToLowerInvariant(),
            healthyXbfSha256 = Convert.ToHexString(SHA256.HashData(originalXbf)).ToLowerInvariant(),
            brokenXbfSha256 = Convert.ToHexString(SHA256.HashData(brokenXbf)).ToLowerInvariant(),
            bindingUnchanged = true,
        };
    }

    private static string Text(JsonElement value) => value.ValueKind == JsonValueKind.String
        ? value.GetString() ?? "" : "";

    private static double Measure(JsonElement value) => value.ValueKind == JsonValueKind.Number
        ? value.GetDouble() : double.NaN;

    private static async Task<JsonElement> Describe(Func<string, Dictionary<string, object?>, Task<JsonElement>> tool) =>
        await tool("kreoda_describe_model", new());

    internal static async Task<object> CreateAndExerciseAsync(McpClient mcp,
        Func<string, Dictionary<string, object?>, Task<JsonElement>> tool)
    {
        var commands = await tool("kreoda_query", new() { ["method"] = "getCommandSchema", ["parameters"] = new Dictionary<string, object?>() });
        var commandMetadata = new[] { "CreateSketch", "CreateExtrude", "CreateBox", "UpdateSketch", "SetSketchProjection", "RemoveSketchProjection", "RequestSketchProjection" }
            .Select(id => commands.GetProperty("commands").EnumerateArray().Single(value => value.GetProperty("id").GetString() == id))
            .Select(value => new { id = value.GetProperty("id").GetString(), nativeType = value.GetProperty("nativeType").GetInt32(),
                creation = value.GetProperty("creation").Clone() }).ToArray();
        Check(commandMetadata.Single(item => item.id == "SetSketchProjection").nativeType == 36, "SetSketchProjection is not native type 36");
        Check(commandMetadata.Single(item => item.id == "RemoveSketchProjection").nativeType == 37, "RemoveSketchProjection is not native type 37");
        Check(commandMetadata.Single(item => item.id == "RequestSketchProjection").nativeType == 38, "RequestSketchProjection is not native type 38");
        foreach (var id in new[] { "SetSketchProjection", "RemoveSketchProjection", "RequestSketchProjection" })
            Check(commandMetadata.Single(item => item.id == id).creation.GetProperty("fixedCount").GetInt32() == 0,
                $"{id} unexpectedly allocates a feature");

        var initial = await Describe(tool);
        Check(initial.GetProperty("sketches").GetArrayLength() == 0 && initial.GetProperty("bodies").GetArrayLength() == 0,
            "projection proof requires a fresh document");
        var initialRevision = initial.GetProperty("revision").GetInt64();
        var opened = await tool("kreoda_begin_request", new()
        {
            ["goal"] = "Project one analytic circle into a second sketch, extrude it, and preserve an unrelated healthy box",
            ["checks"] = new object[]
            {
                new { method = "measureVolume", parameters = new Dictionary<string, object?> { ["featureId"] = "$solid" },
                    path = "volumeMm3", expected = RadiusFiveVolume, tolerance = .01 },
                new { method = "measureVolume", parameters = new Dictionary<string, object?> { ["featureId"] = "$healthy" },
                    path = "volumeMm3", expected = 1000d, tolerance = .01 },
            },
        });
        var requestId = Text(opened.GetProperty("requestId"));
        var source = await tool("kreoda_command", new() { ["requestId"] = requestId, ["commandId"] = "CreateSketch",
            ["newFeatureAlias"] = "source", ["parameters"] = new Dictionary<string, object?> { ["planeKind"] = "XY", ["model"] = Sketch(5) } });
        var sourceId = Text(source.GetProperty("featureId"));
        var target = await tool("kreoda_command", new() { ["requestId"] = requestId, ["commandId"] = "CreateSketch",
            ["newFeatureAlias"] = "target", ["parameters"] = new Dictionary<string, object?> { ["planeKind"] = "XY", ["model"] = Sketch(5, includeCircle: false, includeSpare: false) } });
        var targetId = Text(target.GetProperty("featureId"));
        var groupId = Guid.NewGuid().ToString("D");
        var definition = Definition(sourceId);
        await tool("kreoda_command", new() { ["requestId"] = requestId, ["commandId"] = "SetSketchProjection",
            ["parameters"] = new Dictionary<string, object?> { ["featureId"] = targetId, ["groupId"] = groupId, ["definition"] = definition } });
        var solid = await tool("kreoda_command", new() { ["requestId"] = requestId, ["commandId"] = "CreateExtrude",
            ["newFeatureAlias"] = "solid", ["parameters"] = new Dictionary<string, object?> { ["sketchId"] = "$target", ["distanceMm"] = 10d } });
        var solidId = Text(solid.GetProperty("featureId"));
        var healthy = await tool("kreoda_command", new() { ["requestId"] = requestId, ["commandId"] = "CreateBox",
            ["newFeatureAlias"] = "healthy", ["parameters"] = new Dictionary<string, object?> { ["widthMm"] = 10d, ["heightMm"] = 10d, ["depthMm"] = 10d } });
        var healthyId = Text(healthy.GetProperty("featureId"));
        var committed = await tool("kreoda_commit_request", new() { ["requestId"] = requestId });
        Check(Text(committed.GetProperty("status")) == "committed", "native projection/sketch/extrude transaction did not commit");
        var createdRevision = committed.GetProperty("result").GetProperty("revision").GetInt64();
        Check(createdRevision == initialRevision + 1, "projection transaction did not produce one revision");

        var queryBefore = await Describe(tool);
        for (var attempt = 0; attempt < 40 && queryBefore.GetProperty("revision").GetInt64() < createdRevision; attempt++)
        {
            await Task.Delay(50);
            queryBefore = await Describe(tool);
        }
        Check(queryBefore.GetProperty("revision").GetInt64() == createdRevision,
            "MCP managed client did not observe the committed projection snapshot before typed query");
        var projection = await tool("kreoda_query", new() { ["method"] = "getSketchProjection",
            ["parameters"] = new Dictionary<string, object?> { ["featureId"] = targetId, ["groupId"] = groupId } });
        Check(Text(projection.GetProperty("featureId")) == targetId && projection.GetProperty("geometryCurrent").GetBoolean() &&
            Text(projection.GetProperty("status")) == "ok", "native type38 query did not return current projection geometry");
        var projectedGroup = projection.GetProperty("groups").EnumerateArray().Single(group => Text(group.GetProperty("groupId")) == groupId);
        Check(Text(projectedGroup.GetProperty("status")) == "ok" && projectedGroup.GetProperty("edges").GetArrayLength() == 1,
            $"native type38 query omitted the projected circle edge: {JsonSerializer.Serialize(projection)}");
        var readOnlyAfter = await Describe(tool);
        Check(readOnlyAfter.GetProperty("revision").GetInt64() == queryBefore.GetProperty("revision").GetInt64(),
            "projection query changed the committed model revision");
        var initialVolume = await tool("kreoda_query", new() { ["method"] = "measureVolume",
            ["parameters"] = new Dictionary<string, object?> { ["featureId"] = solidId } });
        var initialHealthyVolume = await tool("kreoda_query", new() { ["method"] = "measureVolume",
            ["parameters"] = new Dictionary<string, object?> { ["featureId"] = healthyId } });
        Check(Math.Abs(Measure(initialVolume.GetProperty("volumeMm3")) - RadiusFiveVolume) < .01, "projected circle extrusion has the wrong analytic volume");
        Check(Math.Abs(Measure(initialHealthyVolume.GetProperty("volumeMm3")) - 1000) < .01, "unrelated healthy branch has the wrong volume");

        var pairToken = Environment.GetEnvironmentVariable("KREODA_MCP_SECOND_PAIR") ?? throw new InvalidOperationException("second device pairing token missing");
        var sessionUrl = new Uri(Environment.GetEnvironmentVariable("KREODA_CAD_SESSION_URL") ?? throw new InvalidOperationException("session URL missing"));
        var paired = await SessionClient.PairAsync(sessionUrl, pairToken, "Projection E2E Peer", "projection-e2e");
        await using var peer = paired.Client;
        var peerProjection = await peer.GetSketchProjectionAsync(targetId, groupId, createdRevision);
        Check(peerProjection.Result.GeometryCurrent && peerProjection.Revision == createdRevision, "managed typed projection query lost its lineage fence");

        var rollback = await tool("kreoda_begin_request", new() { ["goal"] = "Prove projection edit ownership and rollback",
            ["checks"] = new[] { new { method = "measureVolume", parameters = new Dictionary<string, object?> { ["featureId"] = healthyId }, path = "volumeMm3", expected = 1000d, tolerance = .01 } } });
        var rollbackId = Text(rollback.GetProperty("requestId"));
        await tool("kreoda_command", new() { ["requestId"] = rollbackId, ["commandId"] = "UpdateSketch",
            ["parameters"] = new Dictionary<string, object?> { ["featureId"] = sourceId, ["model"] = Sketch(6) } });
        var ownerProjection = await tool("kreoda_query", new() { ["requestId"] = rollbackId, ["method"] = "getSketchProjection",
            ["parameters"] = new Dictionary<string, object?> { ["featureId"] = targetId } });
        Check(ownerProjection.GetProperty("geometryCurrent").GetBoolean() &&
            ownerProjection.GetProperty("groups").EnumerateArray().Any(group => Text(group.GetProperty("groupId")) == groupId),
            "transaction owner did not observe its uncommitted source edit and retained group");
        var ownerVolume = await tool("kreoda_query", new() { ["requestId"] = rollbackId, ["method"] = "measureVolume",
            ["parameters"] = new Dictionary<string, object?> { ["featureId"] = solidId } });
        Check(Math.Abs(Measure(ownerVolume.GetProperty("volumeMm3")) - RadiusSixVolume) < .01,
            "transaction owner did not observe the staged analytic downstream volume");
        string? ownershipCode = null;
        try { _ = await peer.GetSketchProjectionAsync(targetId, groupId, createdRevision); }
        catch (SessionException error) { ownershipCode = error.Code; }
        Check(ownershipCode == "BUSY", $"non-owner projection query was not fenced: {ownershipCode}");
        var canceled = await tool("kreoda_cancel_request", new() { ["requestId"] = rollbackId });
        Check(Text(canceled.GetProperty("status")) == "cancelled", "projection rollback request did not cancel");
        var restored = await peer.GetSketchProjectionAsync(targetId, groupId, createdRevision);
        var restoredVolume = await tool("kreoda_query", new() { ["method"] = "measureVolume",
            ["parameters"] = new Dictionary<string, object?> { ["featureId"] = solidId } });
        Check(restored.Result.GeometryCurrent && restored.Result.Groups.Any(group => group.GroupId == groupId) &&
            Math.Abs(Measure(restoredVolume.GetProperty("volumeMm3")) - RadiusFiveVolume) < .01,
            "transaction rollback did not restore the original projection geometry and volume");

        var editTransaction = Guid.NewGuid().ToString("D");
        await peer.TxnBeginAsync(editTransaction, DocumentId);
        await peer.CommandAsync("UpdateSketch", new Dictionary<string, object?> { ["featureId"] = sourceId, ["model"] = Sketch(6) },
            DocumentId, transactionId: editTransaction);
        var operationId = Guid.NewGuid().ToString("D");
        var signal = Environment.GetEnvironmentVariable("KREODA_DROP_ACK_SIGNAL_FILE") ?? throw new InvalidOperationException("lost-ack signal file missing");
        if (File.Exists(signal)) File.Delete(signal);
        using var canceledCommit = new CancellationTokenSource();
        var commitParameters = new Dictionary<string, object?> { ["transactionId"] = editTransaction, ["documentId"] = DocumentId };
        var firstCommit = peer.CallAsync(SessionMethods.TxnCommit, commitParameters, canceledCommit.Token,
            operationId, peer.SessionId);
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(20);
        while (!File.Exists(signal) && DateTime.UtcNow < deadline) await Task.Delay(10);
        Check(File.Exists(signal), "the real session relay did not produce the intercepted lost commit acknowledgement");
        canceledCommit.Cancel();
        string? lostAckCode = null;
        try { _ = await firstCommit; }
        catch (SessionException error) { lostAckCode = error.Code; }
        Check(lostAckCode == "CANCELLED", $"lost acknowledgement was not observed by the client: {lostAckCode}");
        var replay = await peer.ReplayOperationAsync(SessionMethods.TxnCommit, commitParameters, operationId, peer.SessionId!);
        Check(Text(replay.GetProperty("status")) == "ok" && replay.GetProperty("revision").GetInt64() == createdRevision + 1,
            $"retry with the same operation identity did not return the one committed edit: {replay.GetRawText()}");
        await peer.SnapshotAsync(DocumentId);

        var refreshed = await Describe(tool);
        for (var attempt = 0; attempt < 40 && refreshed.GetProperty("revision").GetInt64() < createdRevision + 1; attempt++)
        {
            await Task.Delay(50);
            refreshed = await Describe(tool);
        }
        Check(refreshed.GetProperty("revision").GetInt64() == createdRevision + 1, "MCP session client did not observe the replayed commit delta");
        var editedVolume = await tool("kreoda_query", new() { ["method"] = "measureVolume", ["parameters"] = new Dictionary<string, object?> { ["featureId"] = solidId } });
        var editedProjection = await tool("kreoda_query", new() { ["method"] = "getSketchProjection", ["parameters"] = new Dictionary<string, object?> { ["featureId"] = targetId, ["groupId"] = groupId } });
        Check(Math.Abs(Measure(editedVolume.GetProperty("volumeMm3")) - RadiusSixVolume) < .01, "same-ID source edit did not change analytic downstream volume");
        Check(Text(editedProjection.GetProperty("groups")[0].GetProperty("groupId")) == groupId && editedProjection.GetProperty("geometryCurrent").GetBoolean(),
            "same-ID source edit lost the persistent projection group");
        var finalModel = await Describe(tool);
        foreach (var id in new[] { sourceId, targetId, solidId, healthyId })
            Check(finalModel.GetProperty("features").EnumerateArray().Any(feature => Text(feature.GetProperty("featureId")) == id) ||
                finalModel.GetProperty("sketches").EnumerateArray().Any(sketch => Text(sketch.GetProperty("featureId")) == id),
                $"source edit replaced stable feature identity {id}");

        return new
        {
            scenario = "projection", status = "committed",
            passed = new[]
            {
                "official-mcp-native-circle-projection-extrude-transaction",
                "type38-read-only-and-generated-command-metadata36-38",
                "typed-managed-query-lineage-and-valid-source-edit-owner-rollback",
                "same-id-analytic-source-edit-with-real-lost-ack-operation-replay",
                "healthy-unrelated-branch-preserved",
            },
            commandMetadata, featureIds = new { source = sourceId, target = targetId, solid = solidId, healthy = healthyId, group = groupId },
            initialRevision, createdRevision, editedRevision = createdRevision + 1,
            volumeBeforeMm3 = Measure(initialVolume.GetProperty("volumeMm3")),
            volumeAfterMm3 = Measure(editedVolume.GetProperty("volumeMm3")),
            healthyVolumeMm3 = Measure(initialHealthyVolume.GetProperty("volumeMm3")),
            projectedEdgeCount = projectedGroup.GetProperty("edges").GetArrayLength(),
            rollbackOwnerError = ownershipCode, lostAcknowledgementError = lostAckCode, replayRevision = replay.GetProperty("revision"),
        };
    }

    internal static async Task<object> InspectAndRepairAsync(McpClient mcp,
        Func<string, Dictionary<string, object?>, Task<JsonElement>> tool)
    {
        var sourceId = Environment.GetEnvironmentVariable("KREODA_PROJECTION_SOURCE_ID") ?? throw new InvalidOperationException("source ID missing");
        var targetId = Environment.GetEnvironmentVariable("KREODA_PROJECTION_TARGET_ID") ?? throw new InvalidOperationException("target ID missing");
        var solidId = Environment.GetEnvironmentVariable("KREODA_PROJECTION_SOLID_ID") ?? throw new InvalidOperationException("solid ID missing");
        var healthyId = Environment.GetEnvironmentVariable("KREODA_PROJECTION_HEALTHY_ID") ?? throw new InvalidOperationException("healthy ID missing");
        var groupId = Environment.GetEnvironmentVariable("KREODA_PROJECTION_GROUP_ID") ?? throw new InvalidOperationException("group ID missing");
        var before = await Describe(tool);
        if (long.TryParse(Environment.GetEnvironmentVariable("KREODA_PROJECTION_EXPECTED_REVISION"), out var expectedBrokenRevision))
        {
            for (var attempt = 0; attempt < 40 && before.GetProperty("revision").GetInt64() != expectedBrokenRevision; attempt++)
            {
                await Task.Delay(50);
                before = await Describe(tool);
            }
            Check(before.GetProperty("revision").GetInt64() == expectedBrokenRevision,
                "MCP managed client did not observe the persisted broken-document lineage");
        }
        var broken = await tool("kreoda_query", new() { ["method"] = "getSketchProjection",
            ["parameters"] = new Dictionary<string, object?> { ["featureId"] = targetId, ["groupId"] = groupId } });
        Check(!broken.GetProperty("geometryCurrent").GetBoolean() && Text(broken.GetProperty("status")) == "unavailable",
            "saved broken projection was reported current");
        var brokenGroup = broken.GetProperty("groups").EnumerateArray().Single(group => Text(group.GetProperty("groupId")) == groupId);
        Check(Text(brokenGroup.GetProperty("status")) == "broken" &&
            (Text(brokenGroup.GetProperty("error")).Length > 0 || brokenGroup.GetProperty("blockingSourceIds").GetArrayLength() > 0),
            "persisted broken projection omitted its diagnostic");
        var feature = before.GetProperty("features").EnumerateArray().Single(value => Text(value.GetProperty("featureId")) == solidId);
        Check(Text(feature.GetProperty("status")) == "unavailable" && !feature.TryGetProperty("volumeMm3", out _),
            "unavailable extrusion leaked a stale analytic volume");
        var healthyVolume = await tool("kreoda_query", new() { ["method"] = "measureVolume", ["parameters"] = new Dictionary<string, object?> { ["featureId"] = healthyId } });
        Check(Math.Abs(Measure(healthyVolume.GetProperty("volumeMm3")) - 1000) < .01, "healthy sibling branch lost its measurement");
        var deniedMeasurement = await mcp.CallToolAsync("kreoda_query", new Dictionary<string, object?>
            { ["method"] = "measureVolume", ["parameters"] = new Dictionary<string, object?> { ["featureId"] = solidId } });
        Check(deniedMeasurement.IsError == true, "unavailable solid returned a measurement");

        var sessionUrl = new Uri(Environment.GetEnvironmentVariable("KREODA_CAD_SESSION_URL") ?? throw new InvalidOperationException("session URL missing"));
        var pairToken = Environment.GetEnvironmentVariable("KREODA_MCP_SECOND_PAIR") ?? throw new InvalidOperationException("second device pairing token missing");
        var paired = await SessionClient.PairAsync(sessionUrl, pairToken, "Projection Mesh Probe", "projection-e2e");
        await using var peer = paired.Client;
        var model = peer.Model ?? throw new InvalidOperationException("paired client did not load the broken snapshot");
        var expectedRevision = model.Revision;
        var body = model.Bodies.Select(value => new
            {
                BodyId = value.TryGetProperty("bodyId", out var id) ? id.GetString() : null,
                Tip = value.TryGetProperty("tip", out var tip) ? Text(tip) : null,
            })
            .SingleOrDefault(value => value.Tip == solidId)?.BodyId;
        Check(body is not null, "broken persisted model omitted the unavailable extrude body descriptor");
        string? meshError = null;
        try { _ = await peer.RequestMeshLodAsync(body!, 1, model.DocumentId, expectedRevision); }
        catch (SessionException error) { meshError = error.Code; }
        Check(meshError == "GEOMETRY_UNAVAILABLE", $"unavailable downstream mesh returned {meshError}");
        var typedBroken = await peer.GetSketchProjectionAsync(targetId, groupId, expectedRevision);
        Check(!typedBroken.Result.GeometryCurrent && typedBroken.Result.Status == "unavailable", "managed typed result lost unavailable state");

        var opened = await tool("kreoda_begin_request", new() { ["goal"] = "Restore the same circle and projection IDs while preserving the healthy sibling branch",
            ["checks"] = new object[]
            {
                new { method = "measureVolume", parameters = new Dictionary<string, object?> { ["featureId"] = solidId }, path = "volumeMm3", expected = RadiusSixVolume, tolerance = .01 },
                new { method = "measureVolume", parameters = new Dictionary<string, object?> { ["featureId"] = healthyId }, path = "volumeMm3", expected = 1000d, tolerance = .01 },
            } });
        var requestId = Text(opened.GetProperty("requestId"));
        await tool("kreoda_command", new() { ["requestId"] = requestId, ["commandId"] = "SetSketchProjection",
            ["parameters"] = new Dictionary<string, object?> { ["featureId"] = targetId, ["groupId"] = groupId,
                ["definition"] = Definition(sourceId, Environment.GetEnvironmentVariable("KREODA_PROJECTION_SOURCE_ENTITY_ID") ?? "circle") } });
        var committed = await tool("kreoda_commit_request", new() { ["requestId"] = requestId });
        Check(Text(committed.GetProperty("status")) == "committed", "same-ID projection repair failed native validation");
        var repaired = await tool("kreoda_query", new() { ["method"] = "getSketchProjection",
            ["parameters"] = new Dictionary<string, object?> { ["featureId"] = targetId, ["groupId"] = groupId } });
        var repairedVolume = await tool("kreoda_query", new() { ["method"] = "measureVolume", ["parameters"] = new Dictionary<string, object?> { ["featureId"] = solidId } });
        Check(repaired.GetProperty("geometryCurrent").GetBoolean() && Text(repaired.GetProperty("status")) == "ok" &&
            repaired.GetProperty("groups").EnumerateArray().Any(group => Text(group.GetProperty("groupId")) == groupId),
            "repair replaced or lost the projection group identity");
        Check(Math.Abs(Measure(repairedVolume.GetProperty("volumeMm3")) - RadiusSixVolume) < .01, "repaired downstream extrusion volume differs");
        var after = await Describe(tool);
        foreach (var id in new[] { sourceId, targetId, solidId, healthyId })
            Check(after.GetProperty("features").EnumerateArray().Any(value => Text(value.GetProperty("featureId")) == id) ||
                after.GetProperty("sketches").EnumerateArray().Any(value => Text(value.GetProperty("featureId")) == id),
                $"repair replaced stable feature identity {id}");

        return new
        {
            scenario = "projection-repair", status = "committed",
            passed = new[]
            {
                "saved-broken-binding-is-unavailable-without-stale-volume-or-mesh",
                "healthy-unrelated-branch-remains-measurable",
                "official-mcp-repair-preserves-source-target-group-and-downstream-ids",
            },
            featureIds = new { source = sourceId, target = targetId, solid = solidId, healthy = healthyId, group = groupId },
            brokenRevision = before.GetProperty("revision").GetInt64(), repairRevision = committed.GetProperty("result").GetProperty("revision").GetInt64(),
            brokenProjection = broken, staleMeasurementDenied = deniedMeasurement.IsError == true, meshError,
            healthyVolumeMm3 = Measure(healthyVolume.GetProperty("volumeMm3")), repairedVolumeMm3 = Measure(repairedVolume.GetProperty("volumeMm3")),
        };
    }
}
