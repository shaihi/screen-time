using Xunit;

namespace ScreenTime.Agent.Tests;

public class AppNamesTests
{
    [Theory]
    [InlineData("ApplicationFrameHost")]
    [InlineData("explorer")]
    [InlineData("SearchHost")]
    [InlineData("PickerHost")]
    [InlineData("gamingservicesui")]
    [InlineData("ScreenTime.Agent")]
    public void System_processes_are_recognised(string processName) =>
        Assert.True(AppNames.IsSystemProcess(processName));

    [Theory]
    [InlineData("RobloxPlayerBeta")]
    [InlineData("Windows10Universal")]
    [InlineData("chrome")]
    public void User_apps_are_not_system_processes(string processName) =>
        Assert.False(AppNames.IsSystemProcess(processName));

    [Theory]
    [InlineData("ROBLOXCORPORATION.ROBLOX_2.690.0.0_x64__55nm5eh3cm0pr", "Roblox")]
    [InlineData("RobloxPlayerBeta", "Roblox")]
    [InlineData("chrome", "Google Chrome")]
    [InlineData("Code", "Visual Studio Code")]
    [InlineData("Chrome", "Google Chrome")]
    [InlineData("308046B0AF4A39CB", "Firefox")]
    public void Known_apps_get_curated_names(string identifier, string expected) =>
        Assert.Equal(expected, AppNames.Known(identifier));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Windows10Universal")]
    public void Unknown_identifiers_return_null(string? identifier) =>
        Assert.Null(AppNames.Known(identifier));

    [Theory]
    [InlineData("Microsoft.ZuneVideo_8wekyb3d8bbwe!Microsoft.ZuneVideo", "ZuneVideo")]
    [InlineData("Contoso.Player_abc123!App", "Player")]
    [InlineData(@"C:\Program Files\Foo\foo.exe", "foo")]
    [InlineData("SomePlayer", "SomePlayer")]
    public void App_user_model_ids_are_shortened(string aumid, string expected) =>
        Assert.Equal(expected, AppNames.FromAppUserModelId(aumid));

    [Fact]
    public void Clean_rejects_unresolved_resources_and_truncates()
    {
        Assert.Null(AppNames.Clean("ms-resource:AppName"));
        Assert.Null(AppNames.Clean("   "));
        Assert.Equal(AppNames.MaxLength, AppNames.Clean(new string('x', 200))!.Length);
        Assert.Equal("Roblox", AppNames.Clean("  Roblox "));
    }
}
