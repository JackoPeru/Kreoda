using Kreoda.Session;
using Kreoda.Session.Generated;
using Xunit;

namespace Kreoda.SessionClient.Tests;

public sealed class SketchProjectionStateTests
{
    private static SessionSketchProjectionDisplay Display(string message) => new(
        "target", "group", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "doc", 7,
        new SketchProjectionResult
        {
            FeatureId = "target", GeometryCurrent = true, Status = "ok", Error = message,
            BlockingSourceIds = Array.Empty<string>(), Groups = Array.Empty<SketchProjectionGroupResult>(),
            Plane = new SketchPlaneFrame { Origin = [0, 0, 0], XAxis = [1, 0, 0], YAxis = [0, 1, 0], Normal = [0, 0, 1] },
        });

    [Fact]
    public void StaleFailedRequestCannotClearNewerSuccessfulDisplay()
    {
        var state = new SessionSketchProjectionState();
        var oldRequest = state.BeginRequest("target", "group");
        var latestRequest = state.BeginRequest("target", "group");
        Assert.True(state.TryPublish(latestRequest, Display("newer success"), () => true));

        Assert.False(state.TryClear("target", "group", oldRequest, () => true));
        Assert.Equal("newer success", Assert.Single(state.Current).Result.Error);
    }

    [Fact]
    public void ClearingLineageInvalidatesBothDisplayAndInFlightRequestToken()
    {
        var state = new SessionSketchProjectionState();
        var request = state.BeginRequest("target", "group");
        state.Clear();

        Assert.False(state.TryPublish(request, Display("stale"), () => true));
        Assert.Empty(state.Current);
    }

    [Fact]
    public void ClearDoesNotLetDelayedPublishReuseANewerRequestToken()
    {
        var state = new SessionSketchProjectionState();
        var oldRequest = state.BeginRequest("target", "group");
        state.Clear();
        var newRequest = state.BeginRequest("target", "group");
        Assert.True(newRequest > oldRequest);
        Assert.True(state.TryPublish(newRequest, Display("new result"), () => true));

        Assert.False(state.TryPublish(oldRequest, Display("delayed old result"), () => true));
        Assert.Equal("new result", Assert.Single(state.Current).Result.Error);
    }

    [Fact]
    public void ClearDoesNotLetDelayedFailureCleanupEraseANewerDisplay()
    {
        var state = new SessionSketchProjectionState();
        var oldRequest = state.BeginRequest("target", "group");
        state.Clear();
        var newRequest = state.BeginRequest("target", "group");
        Assert.True(state.TryPublish(newRequest, Display("new result"), () => true));

        Assert.False(state.TryClear("target", "group", oldRequest, () => true));
        Assert.Equal("new result", Assert.Single(state.Current).Result.Error);
    }
}
