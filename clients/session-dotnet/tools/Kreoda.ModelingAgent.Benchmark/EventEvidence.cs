using System.Text.Json;
namespace Kreoda.ModelingAgent.Benchmark;
public static class EventEvidence
{
    public static string? ToolName(JsonElement item) {
        var data=item.TryGetProperty("data",out var nested)?nested:item;
        return GeometryCheck.Text(data,"tool_name")??GeometryCheck.Text(data,"tool")??GeometryCheck.Text(data,"name");
    }
    public static JsonElement[] Parse(string text)
    {
        var items=new List<JsonElement>();
        foreach(var frame in text.Replace("\r\n","\n").Split("\n\n",StringSplitOptions.RemoveEmptyEntries)) {
            var data=string.Join("\n",frame.Split('\n').Where(l=>l.StartsWith("data:",StringComparison.Ordinal)).Select(l=>l[5..].TrimStart()));
            if(data.Length==0)continue;
            using var document=JsonDocument.Parse(data);var item=document.RootElement;
            var type=GeometryCheck.Text(item,"type");
            // Never retain reasoning, final answer or unrelated lifecycle text.
            if(type is "tool.started" or "tool.completed" or "replay.truncated")items.Add(item.Clone());
        }
        return items.ToArray();
    }
}
