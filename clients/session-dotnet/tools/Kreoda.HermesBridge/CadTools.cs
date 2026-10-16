using System.ComponentModel;
using System.Text.Json;
using Kreoda.Session;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Kreoda.HermesBridge;

[McpServerToolType]
public sealed class CadTools(CadBridge cad)
{
    [McpServerTool(Name = "kreoda_project_context", ReadOnly = true), Description("Read the Kreoda project brief and operating rules, including when the CAD app is disconnected. Hermes retains planning and memory.")]
    public static string ProjectContext() => ProjectResources.Brief;
    static async Task<CallToolResult> Reply(Func<Task<JsonElement>> action)
    {
        try { return new() { Content = [new TextContentBlock { Text = (await action()).GetRawText() }] }; }
        catch (CadRecoveryRequiredException error) {
            return new() { IsError = true, Content = [new TextContentBlock { Text = JsonSerializer.Serialize(new {
                status = "uncertain", errorCode = "ROLLBACK_UNCONFIRMED", recovery = error.Recovery,
                recoveryPersisted = error.RecoveryPersisted,
            }) }] };
        }
        catch (Exception error) when (error is SessionException or ArgumentException or Kreoda.ModelingAgent.AgentBudgetExceededException) {
            var code = error is SessionException session ? session.Code : error is Kreoda.ModelingAgent.AgentBudgetExceededException ? "BUDGET_EXHAUSTED" : "BAD_PARAMS";
            return new() { IsError = true, Content = [new TextContentBlock { Text = JsonSerializer.Serialize(new { status = "error", errorCode = code, message = error.Message }) }] };
        }
    }
    [McpServerTool(Name = "kreoda_describe_model", ReadOnly = true), Description("Describe the current committed Kreoda CAD document. Units are mm; do not invent persistent face/edge IDs.")]
    public Task<CallToolResult> Describe(CancellationToken ct) => Reply(() => cad.DescribeAsync(ct));

    [McpServerTool(Name = "kreoda_query", ReadOnly = true), Description("Read canonical CAD metadata/measurements/references. Discover commands with method getCommandSchema; inspect real faces/edges before mutation. Include requestId while your transaction is active.")]
    public Task<CallToolResult> Query(string method, Dictionary<string, JsonElement> parameters, string? requestId = null, CancellationToken ct = default) =>
        Reply(() => cad.QueryAsync(requestId, method, JsonSerializer.SerializeToElement(parameters), ct));

    [McpServerTool(Name = "kreoda_begin_request", Destructive = false), Description("Begin one bounded CAD request and one Undo group. Supply immutable numeric goal checks (query method, parameters, dot path, expected, tolerance). New feature references may use $alias; later command newFeatureAlias assigns that alias. Do not guess ambiguous goals.")]
    public Task<CallToolResult> Begin(string goal, CadCheck[] checks, string? originRequestId = null, CancellationToken ct = default) => Reply(async () =>
        JsonSerializer.SerializeToElement(new { requestId = await cad.BeginAsync(goal, checks, ct: ct, originRequestId: originRequestId), status = "open" }));

    [McpServerTool(Name = "kreoda_command", Destructive = true), Description("Execute a command from getCommandSchema inside your owned request, using its actual parameter schema and semantic references. Set newFeatureAlias for one new feature; $alias resolves to its real allocated UUID. Raw invoke, Undo and Redo are unavailable.")]
    public Task<CallToolResult> Command(string requestId, string commandId, Dictionary<string, JsonElement> parameters, string? newFeatureAlias = null, CancellationToken ct = default) =>
        Reply(() => cad.CommandAsync(requestId, commandId, JsonSerializer.SerializeToElement(parameters), newFeatureAlias, ct));

    [McpServerTool(Name = "kreoda_commit_request", Destructive = true), Description("Validate actual B-Rep and all original numeric goal checks, then commit one shared Undo group. validation_failed rolls back. uncertain means reconcile and do not repeat with a new request.")]
    public Task<CallToolResult> Commit(string requestId, CancellationToken ct) => Reply(() => cad.CommitAsync(requestId, ct));

    [McpServerTool(Name = "kreoda_cancel_request", Destructive = false), Description("Cancel and roll back your owned CAD request. Idle requests also expire automatically.")]
    public Task<CallToolResult> Cancel(string requestId, CancellationToken ct) => Reply(async () => {
        await cad.CancelAsync(requestId, ct);return JsonSerializer.SerializeToElement(new { status = "cancelled", requestId });
    });
}

[McpServerResourceType]
public sealed class ProjectResources
{
    public const string Brief = """
        # Kreoda
        Kreoda is an editable parametric CAD application with an authoritative PC/OCCT document,
        a Desktop client and a Quest mixed-reality client sharing the same session and Undo history.
        Hermes owns the planning, memory and tool loop. This MCP only exposes canonical CAD tools.
        Query the current document, command schemas, actual features and semantic references first.
        Never fabricate persistent face/edge IDs, select the first ambiguous match, or report success
        without B-Rep validation and measured goal conditions. Numeric dimensions use millimetres;
        each angle parameter declares degrees or radians. Use one bounded request per user intent,
        preserve the document and original goal checks, and cancel/roll back on failure.
        For a voice turn, pass its context voiceRequestId as originRequestId when beginning CAD.
        Never repeat a cancelled voice origin or create a second Undo group for that turn.
        The same tools are available from Hermes outside the Quest app while the PC session is running.
        If CAD is disconnected, report that state and keep this project context; do not fake execution.
        Physical Quest comfort, contact and complete gesture acceptance remain separately unverified.
        """;
    [McpServerResource(UriTemplate = "kreoda://project", Name = "Kreoda project context", MimeType = "text/markdown")]
    public static string Project() => Brief;
}
