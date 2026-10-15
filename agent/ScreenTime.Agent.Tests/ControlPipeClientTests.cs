using System.IO.Pipes;
using System.Text.Json;
using ScreenTime.Agent;
using Xunit;

namespace ScreenTime.Agent.Tests;

public class ControlPipeClientTests
{
    [Fact]
    public async Task Sends_only_observation_and_reads_bounded_status()
    {
        var name = "st" + Guid.NewGuid().ToString("N")[..12];
        await using var server = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
        var accept = server.WaitForConnectionAsync();
        var client = new ControlPipeClient(name);
        var pending = client.ObserveAsync(ActivityState.Media);
        await accept;
        using var reader = new StreamReader(server, leaveOpen: true);
        using var writer = new StreamWriter(server, leaveOpen: true) { AutoFlush = true };
        var line = await reader.ReadLineAsync();
        using var json = JsonDocument.Parse(line!);
        Assert.Equal(3, json.RootElement.EnumerateObject().Count());
        Assert.Equal("observe", json.RootElement.GetProperty("type").GetString());
        Assert.Equal("media", json.RootElement.GetProperty("state").GetString());
        Assert.Equal(1, json.RootElement.GetProperty("sequence").GetInt64());
        await writer.WriteLineAsync("{\"state\":\"warning\",\"remainingSeconds\":60,\"reason\":\"Save your work\",\"warningSeconds\":60}");
        var status = await pending;
        Assert.Equal("warning", status?.State);
        Assert.Equal(60, status?.WarningSeconds);
    }

    [Fact]
    public async Task Unavailable_service_is_best_effort_and_does_not_hang_sensor()
    {
        var client = new ControlPipeClient("st" + Guid.NewGuid().ToString("N")[..12], TimeSpan.FromMilliseconds(30));
        Assert.Null(await client.ObserveAsync(ActivityState.Active));
    }

    [Theory]
    [InlineData("{\"state\":\"allowed\",\"remainingSeconds\":-1,\"reason\":\"ok\"}")]
    [InlineData("{\"state\":\"doSomething\",\"reason\":\"ok\"}")]
    [InlineData("{\"state\":\"warning\",\"reason\":\"ok\",\"warningSeconds\":42}")]
    [InlineData("{}")]
    public void Rejects_invalid_status(string json) => Assert.Null(ControlPipeClient.ParseStatus(json));

    [Fact]
    public void Rejects_oversized_status() => Assert.Null(ControlPipeClient.ParseStatus(new string('x', 4097)));
}
