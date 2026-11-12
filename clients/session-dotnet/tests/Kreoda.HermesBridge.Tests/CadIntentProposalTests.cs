using System.Text.Json;
using System.Text.Json.Serialization;
using Kreoda.ModelingAgent;
using Xunit;

namespace Kreoda.HermesBridge.Tests;

public sealed class CadIntentProposalTests
{
    static AgentCommandCatalog Catalog()
    {
        static object Number() => new { type = "number" };
        static object String() => new { type = "string" };
        static object Create(string id, int type, object properties) => new {
            id, nativeType = type, description = id, creation = new { fixedCount = 1 },
            parameters = new { type = "object", properties },
        };
        var commands = new object[] {
            Create("CreateBox", 3, new { widthMm = Number(), heightMm = Number(), depthMm = Number(), origin = new {
                type = "object", properties = new { x = Number(), y = Number(), z = Number() },
            } }),
            Create("CreateCylinder", 4, new { radiusMm = Number(), heightMm = Number() }),
            Create("CreateSketch", 5, new { planeKind = String(), model = new { type = "object" } }),
            Create("CreateExtrude", 7, new { sketchId = String(), distanceMm = Number() }),
            Create("CreateBoolean", 19, new { op = String(), targetId = String(), toolId = String() }),
            Create("UpdateSketch", 14, new { featureId = String(), model = new { type = "object" } }),
        };
        using var reply = JsonDocument.Parse(JsonSerializer.Serialize(new { commands }));
        return AgentCommandCatalog.FromReply(reply.RootElement);
    }

    static JsonElement Json(string text)
    {
        using var document = JsonDocument.Parse(text);
        return document.RootElement.Clone();
    }

    [Fact]
    public void ProposalRequestRejectsMissingUnknownAndNumericKinds()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<CadIntentRequest>("{}", options));
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<CadIntentRequest>("""
            {"kind":"mountingBlank"}
            """, options));
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<CadIntentRequest>("""
            {"kind":"mountingBlank","expectedContext":{"sessionId":"s","documentId":"d","revision":7},"extra":1}
            """, options));
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<CadIntentRequest>("""
            {"kind":99,"expectedContext":{"sessionId":"s","documentId":"d","revision":7}}
            """, options));
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<CadIntentRequest>("""
            {"kind":1,"expectedContext":{"sessionId":"s","documentId":"d","revision":7}}
            """, options));
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<CadIntentRequest>("""
            {"kind":"mountingBlank","expectedContext":{"sessionId":"s","documentId":"d","revision":7,"extra":true}}
            """, options));
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<CadIntentRequest>("""
            {"kind":"mountingBlank","expectedContext":{"sessionId":"s","documentId":"d","revision":7},"dimensions":{"extra":1}}
            """, options));
    }

    [Fact]
    public void FunctionalIntentFactoriesMapDimensionsToCanonicalNativeCommands()
    {
        var catalog = Catalog();

        var blank = GenerativeIntent.MountingBlank(100, 50, 8, catalog);
        Assert.Equal("CreateBox", blank.Steps.Single().CommandId);
        Assert.Equal(100, blank.Steps.Single().Parameters.GetProperty("widthMm").GetDouble());
        Assert.Equal(50, blank.Steps.Single().Parameters.GetProperty("heightMm").GetDouble());
        Assert.Equal(8, blank.Steps.Single().Parameters.GetProperty("depthMm").GetDouble());

        foreach (var shape in new[] { "L", "U" }) {
            var bracket = GenerativeIntent.Bracket(shape, 100, 50, 40, 5, catalog);
            Assert.Contains("CreateBoolean", bracket.Steps.Select(step => step.CommandId));
            Assert.Equal(shape == "L" ? 3 : 5, bracket.Steps.Count);
        }

        var enclosure = GenerativeIntent.OpenEnclosure(100, 80, 40, 4, catalog);
        Assert.Equal(new[] { "CreateSketch", "CreateExtrude", "CreateSketch", "CreateExtrude", "CreateBoolean" },
            enclosure.Steps.Select(step => step.CommandId));
        Assert.Equal("cut", enclosure.Steps[^1].Parameters.GetProperty("op").GetString());

        var alternatives = GenerativeIntent.ConnectParallelPlates(40, 20, 4, catalog);
        Assert.Equal(new[] { "round-spacer", "rectangular-spacer" }, alternatives.Select(option => option.Id));
        Assert.Equal(new[] { "CreateCylinder", "CreateBox" }, alternatives.Select(option => option.Steps.Single().CommandId));
    }

    [Fact]
    public void MissingFunctionalCatalogSupportDoesNotFabricateCommands()
    {
        var catalog = AgentCommandCatalog.FromReply(Json("""
            {"commands":[
              {"id":"SetDimension","nativeType":6,"creation":{"fixedCount":0},"parameters":{"type":"object"}}
            ]}
            """));
        Assert.Empty(GenerativeIntent.ConnectParallelPlates(40, 20, 4, catalog));
        Assert.Throws<ArgumentException>(() => GenerativeIntent.MountingBlank(100, 50, 8, catalog));
    }
}
