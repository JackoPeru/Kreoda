using System.Text;
using Kreoda.ModelingAgent.Benchmark;
using Xunit;
namespace Kreoda.ModelingAgent.Benchmark.Tests;
public class FrozenRequirementsTests
{
    static string Source() => File.ReadAllText(Path.Combine(AppContext.BaseDirectory,"phase14-requirements.json")).Replace("\r\n","\n",StringComparison.Ordinal);
    [Theory] [InlineData(false)] [InlineData(true)]
    public void CheckoutLineEndingsDoNotChangeFrozenContent(bool crlf) {
        var source=Source();if(crlf)source=source.Replace("\n","\r\n",StringComparison.Ordinal);
        Assert.Equal(FrozenRequirements.Sha256,FrozenRequirements.Verify(Encoding.UTF8.GetBytes(source)));
    }
    [Fact] public void ChangedGeometryStillFailsFreeze() {
        var source=Source();var changed=source.Replace("39607.30091830128","39608.30091830128",StringComparison.Ordinal);
        Assert.NotEqual(source,changed);
        Assert.Throws<InvalidOperationException>(()=>FrozenRequirements.Verify(Encoding.UTF8.GetBytes(changed)));
    }
}
