using System.Net;
using Xunit;

namespace ScreenTime.Agent.Tests;

public class UpdateCheckerTests
{
    private const string ValidManifest = """
        {
          "version": "1.5.0",
          "url": "https://github.com/shaihi/screen-time/releases/download/agent-v1.5.0/ScreenTimeAgent-1.5.0.zip",
          "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        }
        """;

    [Theory]
    [InlineData("1.5.0", "1.4.0.0", true)]
    [InlineData("1.4.1", "1.4.0.0", true)]
    [InlineData("1.4.0", "1.4.0.0", false)]
    [InlineData("1.3.9", "1.4.0.0", false)]
    [InlineData("not-a-version", "1.4.0.0", false)]
    public void Version_comparison_detects_only_newer_versions(
        string candidate,
        string current,
        bool expected) =>
        Assert.Equal(expected, UpdateChecker.IsNewerVersion(candidate, Version.Parse(current)));

    [Fact]
    public void Manifest_parser_accepts_and_normalizes_a_valid_manifest()
    {
        var manifest = Assert.IsType<UpdateManifest>(UpdateChecker.ParseManifest(ValidManifest));

        Assert.Equal("1.5.0", manifest.Version);
        Assert.Equal(
            "https://github.com/shaihi/screen-time/releases/download/agent-v1.5.0/ScreenTimeAgent-1.5.0.zip",
            manifest.Url);
        Assert.Equal(64, manifest.Sha256.Length);
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("{\"version\":\"bad\",\"url\":\"https://example.com/a.zip\",\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}")]
    [InlineData("{\"version\":\"1.5.0\",\"url\":\"http://example.com/a.zip\",\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}")]
    [InlineData("{\"version\":\"1.5.0\",\"url\":\"https://example.com/a.zip\",\"sha256\":\"too-short\"}")]
    [InlineData("{\"version\":null,\"url\":\"https://example.com/a.zip\",\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}")]
    public void Manifest_parser_rejects_invalid_input(string json) =>
        Assert.Null(UpdateChecker.ParseManifest(json));

    [Fact]
    public async Task Check_uses_http_response_and_raises_update_event()
    {
        using var client = new HttpClient(new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(ValidManifest),
        }));
        using var checker = new UpdateChecker(client);
        UpdateManifest? announced = null;
        checker.UpdateAvailable += manifest => announced = manifest;

        var result = await checker.CheckAsync(new Version(1, 4, 0, 0));

        Assert.Equal(UpdateCheckStatus.UpdateAvailable, result.Status);
        Assert.NotNull(result.Manifest);
        Assert.Equal("1.5.0", announced?.Version);
    }

    [Fact]
    public async Task Check_does_not_raise_an_event_for_the_current_version()
    {
        using var client = new HttpClient(new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(ValidManifest),
        }));
        using var checker = new UpdateChecker(client);
        var announced = false;
        checker.UpdateAvailable += _ => announced = true;

        var result = await checker.CheckAsync(new Version(1, 5, 0, 0));

        Assert.Equal(UpdateCheckStatus.UpToDate, result.Status);
        Assert.False(announced);
    }

    [Fact]
    public async Task Network_failures_are_returned_without_throwing()
    {
        using var client = new HttpClient(new StubHandler(_ => throw new HttpRequestException("offline")));
        using var checker = new UpdateChecker(client);

        var result = await checker.CheckAsync(new Version(1, 4, 0, 0));

        Assert.Equal(UpdateCheckStatus.Unavailable, result.Status);
        Assert.Null(result.Manifest);
    }

    [Fact]
    public async Task Non_success_manifest_response_is_returned_without_throwing()
    {
        using var client = new HttpClient(new StubHandler(_ =>
            new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)));
        using var checker = new UpdateChecker(client);

        var result = await checker.CheckAsync(new Version(1, 4, 0, 0));

        Assert.Equal(UpdateCheckStatus.Unavailable, result.Status);
        Assert.Null(result.Manifest);
    }

    [Fact]
    public async Task Install_rejects_a_download_whose_hash_does_not_match_the_manifest()
    {
        using var client = new HttpClient(new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent("not the expected zip"u8.ToArray()),
        }));
        using var checker = new UpdateChecker(client);
        var manifest = new UpdateManifest(
            "1.5.0",
            "https://example.com/update.zip",
            new string('a', 64));
        var config = new AgentConfig(
            "https://example.com/api/ingest",
            new string('s', 32),
            "test-device");

        var exception = await Assert.ThrowsAsync<InvalidDataException>(
            () => checker.StartInstallAsync(manifest, config));

        Assert.Contains("SHA-256", exception.Message);
    }

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> response) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) =>
            Task.FromResult(response(request));
    }
}
