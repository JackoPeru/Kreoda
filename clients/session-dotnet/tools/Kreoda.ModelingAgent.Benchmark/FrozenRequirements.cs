using System.Security.Cryptography;
using System.Text;
namespace Kreoda.ModelingAgent.Benchmark;
public static class FrozenRequirements
{
    public const string Sha256="78f72a3026a93c7ccf2102f29ab943b71c8c19b12e89007681cafd31a93af24a";
    public static string Verify(byte[] bytes)
    {
        // Git Windows checkouts may convert line endings; no JSON content is relaxed.
        var utf8=new UTF8Encoding(false,true);
        var canonical=utf8.GetBytes(utf8.GetString(bytes).Replace("\r\n","\n",StringComparison.Ordinal));
        var hash=Convert.ToHexString(SHA256.HashData(canonical)).ToLowerInvariant();
        if(hash!=Sha256)throw new InvalidOperationException("Frozen requirements changed");
        return hash;
    }
}
