using Xunit;

namespace ScreenTime.Agent.Tests;

public class PageTitlesTests
{
    [Theory]
    [InlineData("Roblox - Wikipedia - Google Chrome", "Roblox - Wikipedia")]
    [InlineData("YouTube and 3 more pages - Personal - Microsoft\u200B Edge", "YouTube")]
    [InlineData("Home — Mozilla Firefox", "Home")]
    [InlineData("Minecraft - Profile 2 - Google Chrome", "Minecraft - Profile 2")]
    public void Clean_removes_browser_specific_suffixes(string title, string expected) =>
        Assert.Equal(expected, PageTitles.Clean(title));

    [Theory]
    [InlineData("New Tab")]
    [InlineData("New tab")]
    [InlineData("New Private Tab")]
    [InlineData("Start")]
    [InlineData("Untitled")]
    [InlineData("Google Chrome")]
    [InlineData("Microsoft Edge")]
    [InlineData("Mozilla Firefox")]
    [InlineData("Firefox")]
    [InlineData("Brave")]
    [InlineData("Opera")]
    public void Clean_ignores_blank_tabs_and_bare_browser_names(string title) =>
        Assert.Null(PageTitles.Clean(title));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Clean_ignores_missing_titles(string? title) =>
        Assert.Null(PageTitles.Clean(title));

    [Fact]
    public void Clean_limits_titles_to_three_hundred_characters() =>
        Assert.Equal(PageTitles.MaxLength, PageTitles.Clean(new string('x', 400))?.Length);

    [Fact]
    public void Clean_keeps_a_hyphen_inside_the_real_title() =>
        Assert.Equal("A real - page title", PageTitles.Clean("A real - page title - Brave"));

    [Theory]
    [InlineData("Google Chrome", true)]
    [InlineData("microsoft edge", true)]
    [InlineData("Roblox", false)]
    [InlineData(null, false)]
    public void IsBrowser_recognizes_supported_browsers(string? appName, bool expected) =>
        Assert.Equal(expected, PageTitles.IsBrowser(appName));
}
