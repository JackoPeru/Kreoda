using System.Text.Json;
using Kreoda.Session;

string Required(string key) => Environment.GetEnvironmentVariable(key) ?? throw new InvalidOperationException("missing probe setting: " + key);
void Check(bool value, string message) { if (!value) throw new InvalidOperationException(message); }

async Task RunLegacyAsync()
{
    await using var client = await SessionClient.ConnectAsync(new Uri(Required("KREODA_SESSION_PROBE_URL")), Required("KREODA_SESSION_PROBE_TOKEN"), "native-dotnet-probe");
    var editedId = Required("KREODA_SESSION_PROBE_FEATURE");
    var instanceId = Required("KREODA_SESSION_PROBE_INSTANCE");
    var untouchedId = Required("KREODA_SESSION_PROBE_UNTOUCHED");
    var before = client.Model ?? throw new InvalidOperationException("join did not seed the typed model");
    var untouched = before.Features.Single(feature => feature.GetProperty("featureId").GetString() == untouchedId);
    var updates = new List<SessionModelUpdate>();
    client.ModelChanged += update => { lock (updates) updates.Add(update); };
    async Task WaitRevision(long revision)
    {
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (true)
        {
            bool observed;
            lock (updates) observed = updates.Any(update => update.Model.Revision == revision);
            if (client.Model?.Revision == revision && observed) return;
            Check(DateTime.UtcNow < deadline, "model recovery timed out at revision " + revision);
            await Task.Delay(10);
        }
    }
    double Volume() => client.Model!.Features.Single(feature => feature.GetProperty("featureId").GetString() == editedId).GetProperty("volumeMm3").GetDouble();
    async Task<JsonElement> Edit(double width) => await client.InvokeAsync(6,
        new Dictionary<string, object?> { ["featureId"] = editedId, ["paramName"] = "widthMm", ["valueMm"] = width });
    var info = await client.InvokeAsync(1, new Dictionary<string, object?>());
    Check(info.GetProperty("occtVersion").GetString() == "8.0.1-native", "probe requires the real native kernel");
    var edit = await Edit(120);
    await WaitRevision(edit.GetProperty("revision").GetInt64());
    Check(Math.Abs(Volume() - 72000) < 1e-5, "typed model did not apply the native parameter edit");
    SessionModelUpdate edited;
    lock (updates) edited = updates.Single(update => update.Model.Revision == client.Model!.Revision);
    Check(edited.Delta is not null && edited.Delta.ChangedMeshIds.Contains(editedId) && edited.Delta.ChangedMeshIds.Contains(instanceId) && !edited.Delta.ChangedMeshIds.Contains(untouchedId), "native incremental mesh invalidation disagrees");
    Check(untouched.Equals(client.Model!.Features.Single(feature => feature.GetProperty("featureId").GetString() == untouchedId)), "untouched model entity was rebuilt");
    var undo = await client.InvokeAsync(8, new Dictionary<string, object?>());
    await WaitRevision(undo.GetProperty("revision").GetInt64());
    Check(Math.Abs(Volume() - 60000) < 1e-5, "Undo did not restore the typed model");
    // The parent injects one dropped outgoing event for this exact edit, then
    // lets the next native revision expose a gap to the actual C# receive loop.
    await Edit(130);
    var recovery = await Edit(150);
    await WaitRevision(recovery.GetProperty("revision").GetInt64());
    Check(Math.Abs(Volume() - 90000) < 1e-5, "gap recovery did not hydrate native state");
    var snapshot = await client.SnapshotAsync();
    Check(snapshot.GetProperty("revision").GetInt64() == client.Model!.Revision, "snapshot revision mismatch");
    Check(snapshot.GetProperty("features").EnumerateArray().Select(feature => feature.GetRawText()).SequenceEqual(client.Model.Features.Select(feature => feature.GetRawText())), "native snapshot and typed feature model differ");
    Console.WriteLine(JsonSerializer.Serialize(new {
        kernel = info.GetProperty("occtVersion").GetString(), initialRevision = before.Revision, finalRevision = client.Model.Revision,
        passed = new[] { "native-join-snapshot", "existing-parameter-edit", "typed-incremental-model", "dependent-instance-invalidation", "untouched-entity-preserved", "native-undo", "lost-event-gap-recovery", "native-snapshot-model-match" },
        boundary = "Actual SessionRelay/OCCT and compiled C# SessionClient over loopback WebSocket; no Unity or Quest device." }));
}

async Task RunMeshAsync()
{
    var url = new Uri(Required("KREODA_SESSION_PROBE_URL"));
    var pair = await SessionClient.PairAsync(url, Required("KREODA_SESSION_PROBE_PAIR"), "compiled-dotnet-mesh-probe", "session-mesh-probe");
    var editedId = Required("KREODA_SESSION_PROBE_FEATURE");
    var untouchedId = Required("KREODA_SESSION_PROBE_UNTOUCHED");
    var passed = new List<string>();
    var meshHeaders = new List<SessionMeshHeader>();
    var meshHashes = new List<string>();
    var client = pair.Client;

    try
    {
        var before = client.Model ?? throw new InvalidOperationException("pair did not hydrate the managed model");
        Check(before.Bodies.Count == 2, "probe requires two native bodies");
        var edited = before.Features.Single(feature => feature.GetProperty("featureId").GetString() == editedId);
        var untouched = before.Features.Single(feature => feature.GetProperty("featureId").GetString() == untouchedId);
        var editedBody = before.Bodies.Single(body => body.GetProperty("history").EnumerateArray().Any(id => id.GetString() == editedId));
        var untouchedBody = before.Bodies.Single(body => body.GetProperty("history").EnumerateArray().Any(id => id.GetString() == untouchedId));
        var editedBodyId = editedBody.GetProperty("bodyId").GetString()!;
        var untouchedBodyId = untouchedBody.GetProperty("bodyId").GetString()!;
        var initialWidth = edited.GetProperty("paramsMm")[0].GetDouble();
        var initialVolume = edited.GetProperty("volumeMm3").GetDouble();
        var originalSessionId = client.SessionId;

        async Task<SessionMeshResult> Request(string bodyId, string expectedFeatureId, int quality, long revision)
        {
            var mesh = await client.RequestMeshLodAsync(bodyId, quality, before.DocumentId, revision);
            Check(mesh.Header.BodyId == bodyId && mesh.Header.FeatureId == expectedFeatureId && mesh.Header.TipId == expectedFeatureId,
                "mesh header did not preserve body-root/tip identity");
            Check(mesh.Header.Revision == revision && mesh.Header.Quality == quality && mesh.RawByteLength == mesh.Header.ByteLength,
                "mesh header freshness or raw length mismatch");
            Check(mesh.Positions.Length > 0 && mesh.Positions.Length == mesh.Normals.Length && mesh.Indices.Length > 0,
                "decoded native mesh buffers are empty or inconsistent");
            meshHeaders.Add(mesh.Header);
            meshHashes.Add(mesh.RawPayloadSha256);
            return mesh;
        }

        foreach (var quality in Enumerable.Range(0, 3))
            await Request(editedBodyId, editedId, quality, before.Revision);
        await Request(untouchedBodyId, untouchedId, 1, before.Revision);
        passed.Add("real-native-mesh-headers-and-flatbuffers-at-all-lods-for-two-bodies");

        var edits = new List<SessionModelUpdate>();
        var nextRevision = new TaskCompletionSource<long>(TaskCreationOptions.RunContinuationsAsynchronously);
        client.ModelChanged += update =>
        {
            lock (edits) edits.Add(update);
            if (update.Model.Revision > before.Revision) nextRevision.TrySetResult(update.Model.Revision);
        };
        var edit = await client.InvokeAsync(6, new Dictionary<string, object?>
        {
            ["featureId"] = editedId,
            ["paramName"] = "widthMm",
            ["valueMm"] = initialWidth + 5,
        });
        var editedRevision = edit.GetProperty("revision").GetInt64();
        if (client.Model?.Revision != editedRevision)
            Check(await nextRevision.Task.WaitAsync(TimeSpan.FromSeconds(10)) == editedRevision, "managed client did not apply the native edit delta");
        var changed = client.Model ?? throw new InvalidOperationException("edited model was lost");
        var editedUpdate = changed.Features.Single(feature => feature.GetProperty("featureId").GetString() == editedId);
        Check(Math.Abs(editedUpdate.GetProperty("volumeMm3").GetDouble() - initialVolume * (initialWidth + 5) / initialWidth) < 1e-5,
            "native parameter edit did not change the target volume");
        var editDelta = edits.Single(update => update.Model.Revision == editedRevision).Delta;
        Check(editDelta is not null && editDelta.ChangedMeshIds.SequenceEqual(new[] { editedId }),
            "edit invalidated an unexpected body mesh");
        Check(untouched.GetRawText() == changed.Features.Single(feature => feature.GetProperty("featureId").GetString() == untouchedId).GetRawText(),
            "untouched entity changed during the native edit");
        await Request(editedBodyId, editedId, 1, editedRevision);
        Check(meshHeaders.Count(header => header.Revision == editedRevision && header.BodyId == untouchedBodyId) == 0,
            "the unchanged body was queried again after the edit");
        passed.Add("real-native-edit-invalidates-and-refetches-only-the-changed-body");

        var undoEvent = new TaskCompletionSource<long>(TaskCreationOptions.RunContinuationsAsynchronously);
        client.ModelChanged += update => { if (update.Model.Revision > editedRevision) undoEvent.TrySetResult(update.Model.Revision); };
        var undo = await client.InvokeAsync(8, new Dictionary<string, object?>());
        var undoRevision = undo.GetProperty("revision").GetInt64();
        if (client.Model?.Revision != undoRevision)
            Check(await undoEvent.Task.WaitAsync(TimeSpan.FromSeconds(10)) == undoRevision, "managed client did not apply Undo");
        var restored = client.Model!.Features.Single(feature => feature.GetProperty("featureId").GetString() == editedId);
        Check(Math.Abs(restored.GetProperty("volumeMm3").GetDouble() - initialVolume) < 1e-5, "native Undo did not restore the original volume");
        await Request(editedBodyId, editedId, 1, undoRevision);
        passed.Add("real-native-undo-refreshes-the-restored-body-mesh");

        await client.DisposeAsync();
        client = await SessionClient.ConnectDeviceAsync(url, pair.DeviceId, pair.Credential, "session-mesh-probe-reconnect");
        Check(client.SessionId == originalSessionId && client.Model?.Revision == undoRevision,
            "device reconnect did not recover the current session lineage and revision");
        SessionException? stale = null;
        try { await client.RequestMeshLodAsync(editedBodyId, 1, before.DocumentId, before.Revision); }
        catch (SessionException error) { stale = error; }
        Check(stale?.Code == "NEED_FULL_SNAPSHOT", "reconnected client accepted the pre-edit model revision");
        passed.Add("credential-reconnect-recovers-current-lineage-and-rejects-stale-revision");

        Console.WriteLine(JsonSerializer.Serialize(new
        {
            kernel = (await client.InvokeAsync(1, new Dictionary<string, object?>())).GetProperty("occtVersion").GetString(),
            sessionId = client.SessionId,
            initialRevision = before.Revision,
            editedRevision,
            undoRevision,
            meshHeaders,
            meshHashes,
            passed,
            credentialsLogged = false,
            boundary = "Actual Desktop session relay and native OCCT over WebSocket with compiled C# SessionClient; no Unity or Quest hardware.",
        }));
    }
    finally
    {
        await client.DisposeAsync();
    }
}

async Task RunInstanceAsync()
{
    var url = new Uri(Required("KREODA_SESSION_PROBE_URL"));
    var pair = await SessionClient.PairAsync(url, Required("KREODA_SESSION_PROBE_PAIR"), "native-instance-probe", "instance-probe");
    var client = pair.Client;
    var sourceId = Required("KREODA_SESSION_PROBE_FEATURE");
    var holeId = "probe-hole-" + Guid.NewGuid().ToString("N");
    var instanceId = "probe-instance-" + Guid.NewGuid().ToString("N");
    var hashes = new List<string>();
    int cleanupUndos = 0;
    try
    {
        var original = client.Model!;
        var bodyId = original.Bodies.Single(b => b.GetProperty("history").EnumerateArray().Any(id => id.GetString() == sourceId))
            .GetProperty("bodyId").GetString()!;
        var source = original.Features.Single(f => f.GetProperty("featureId").GetString() == sourceId);
        var width = source.GetProperty("paramsMm")[0].GetDouble();
        async Task Wait(long revision)
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            while (client.Model!.Revision != revision) await Task.Delay(10, timeout.Token);
        }
        async Task Invoke(ushort type, Dictionary<string, object?> fields)
        {
            var reply = await client.InvokeAsync(type, fields);
            Check(reply.GetProperty("status").GetString() == "ok", "native instance probe mutation failed");
            await Wait(reply.GetProperty("revision").GetInt64());
        }
        await Invoke(20, new() { ["featureId"] = holeId, ["targetId"] = sourceId, ["faceRole"] = "box.+Z",
            ["xMm"] = width / 2, ["yMm"] = 15, ["diameterMm"] = 4, ["depthMode"] = "blind", ["depthMm"] = 3 });
        cleanupUndos++;
        await Invoke(24, new() { ["featureId"] = instanceId, ["targetId"] = sourceId,
            ["txMm"] = 60, ["tyMm"] = 0, ["tzMm"] = 0, ["rzDeg"] = 90 });
        cleanupUndos++;
        async Task<SessionMeshResult> Mesh(bool instance)
        {
            var model = client.Model!;
            var mesh = await client.RequestMeshLodAsync(bodyId, 1, model.DocumentId, model.Revision,
                instanceId: instance ? instanceId : null);
            Check(mesh.Header.FeatureId == (instance ? instanceId : holeId) && mesh.Header.BodyId == bodyId &&
                mesh.Header.InstanceId == (instance ? instanceId : null), "body-tip/instance identity was conflated");
            hashes.Add(mesh.RawPayloadSha256);
            return mesh;
        }
        var tip = await Mesh(false);
        var placed = await Mesh(true);
        Check(tip.VolumeMm3 < placed.VolumeMm3 && Math.Abs(placed.VolumeMm3 - source.GetProperty("volumeMm3").GetDouble()) < 1e-5,
            "instance of older Box source incorrectly uses later Hole tip");
        Check(Math.Abs(placed.BboxMm[0] - 30) < .001 && Math.Abs(placed.BboxMm[3] - 60) < .001 &&
            Math.Abs(placed.BboxMm[4] - width) < .001, "native instance placement is missing or applied twice");
        await Invoke(6, new() { ["featureId"] = sourceId, ["paramName"] = "widthMm", ["valueMm"] = width + 5 });
        cleanupUndos++;
        var changed = await Mesh(true);
        Check(Math.Abs(changed.BboxMm[4] - width - 5) < .001 && changed.RawPayloadSha256 != placed.RawPayloadSha256,
            "source edit did not refresh placed instance");
        await Invoke(8, new()); cleanupUndos--;
        var restored = await Mesh(true);
        Check(restored.BboxMm.SequenceEqual(placed.BboxMm) && Math.Abs(restored.VolumeMm3 - placed.VolumeMm3) < 1e-5,
            "Undo failed to restore instance geometry");
        await client.DisposeAsync();
        client = await SessionClient.ConnectDeviceAsync(url, pair.DeviceId, pair.Credential, "instance-reconnect");
        var reconnected = await Mesh(true);
        Check(reconnected.BboxMm.SequenceEqual(placed.BboxMm), "credential reconnect lost instance placement/source");
        Console.WriteLine(JsonSerializer.Serialize(new { passed = new[] { "older-source-instance-not-body-tip", "native-placement-once",
            "source-edit-instance-refresh", "undo-instance-restore", "credential-reconnect-instance" }, hashes,
            boundary = "Actual OCCT/Desktop relay and compiled managed client; no Unity or physical Quest." }));
    }
    finally
    {
        for (int i = 0; i < cleanupUndos; i++) await client.InvokeAsync(8, new Dictionary<string, object?>());
        await client.DisposeAsync();
    }
}

if (Environment.GetEnvironmentVariable("KREODA_SESSION_PROBE_INSTANCE_MESH") == "1")
    await RunInstanceAsync();
else if (Environment.GetEnvironmentVariable("KREODA_SESSION_PROBE_MESH") == "1")
    await RunMeshAsync();
else
    await RunLegacyAsync();
