using System.Text.Json;
using ScreenTime.Control;
using Xunit;

public class ProtocolInteropTests
{
    private static JsonDocument Fixture() => JsonDocument.Parse(File.ReadAllText(
        Path.Combine(AppContext.BaseDirectory, "Fixtures", "node-protocol.json")));

    [Fact]
    public void VerifiesEnvelopeSignedByNodeBackend()
    {
        using var fixture = Fixture();
        var data = fixture.RootElement;
        var envelope = data.GetProperty("envelope").Deserialize<SignedEnvelope>(ControlJson.Options)!;
        var verified = PolicyVerifier.Verify(envelope, data.GetProperty("publicKey").GetString()!,
            "interop-test", "fixture-pc", "S-1-5-21-1-2-3-1001");
        Assert.Equal(7200, verified.Policy.DailyLimitSeconds);
        Assert.Equal("Asia/Jerusalem", verified.Policy.TimeZone);
    }

    [Fact]
    public void UnicodeRequestSignatureMatchesNodeBackend()
    {
        using var fixture = Fixture();
        var data = fixture.RootElement;
        var actual = RequestAuthentication.Sign(data.GetProperty("credential").GetString()!, "fixture-pc",
            data.GetProperty("timestamp").GetInt64(), data.GetProperty("nonce").GetString()!,
            data.GetProperty("body").GetString()!);
        Assert.Equal(data.GetProperty("expectedSignature").GetString(), actual);
    }
}
