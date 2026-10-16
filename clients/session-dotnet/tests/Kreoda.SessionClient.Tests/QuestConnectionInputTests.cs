using Kreoda.QuestFoundation;
using Xunit;

namespace Kreoda.SessionClient.Tests;

public sealed class QuestConnectionInputTests
{
    [Theory]
    [InlineData("ws://192.168.1.7:49152/", true)]
    [InlineData(" ws://10.20.30.40:9000/ ", true)]
    [InlineData("ws://172.16.0.1:9000/", true)]
    [InlineData("ws://172.31.255.254:9000/", true)]
    [InlineData("ws://172.32.0.1:9000/", false)]
    [InlineData("ws://8.8.8.8:9000/", false)]
    [InlineData("ws://127.0.0.1:9000/", true)]
    [InlineData("ws://169.254.0.1:9000/", false)]
    [InlineData("ws://pc.local:9000/", false)]
    [InlineData("ws://[::1]:9000/", false)]
    [InlineData("ws://secret@192.168.1.7:9000/", false)]
    [InlineData("ws://192.168.1.7:9000/?token=secret", false)]
    [InlineData("https://192.168.1.7:9000/", false)]
    public void EndpointAcceptsExplicitPrivateLanOrUsbLoopbackIpv4WithoutSecrets(string text, bool allowed)
    {
        Assert.Equal(allowed, QuestConnectionInput.TryEndpoint(text, out var endpoint));
        if (allowed) Assert.Equal("ws", endpoint!.Scheme);
        else Assert.Null(endpoint);
    }

    [Theory]
    [InlineData("0000 0007", "00000007")]
    [InlineData(" 1234\t5678 ", "12345678")]
    [InlineData("1234567", null)]
    [InlineData("123456789", null)]
    [InlineData("１２３４５６７８", null)]
    [InlineData("1234-5678", null)]
    public void PairingCodeRemovesPresentationWhitespaceButKeepsEightAsciiDigits(string text, string? expected)
    {
        Assert.Equal(expected is not null, QuestConnectionInput.TryPairingCode(text, out var code));
        Assert.Equal(expected, code);
    }
}
