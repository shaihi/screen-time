# Codex: add browser page titles to the Windows agent (1.3), then install it

Work in PowerShell on this Windows PC, from the repository root. Follow the steps in order. Stop and report if a step fails and the fix is not obvious.

The dashboard side is already deployed. It accepts an optional `pageTitle` on each sample and shows them in a **Pages viewed** panel. Your job is the agent side.

## Goal

While a browser is the active foreground app, also report the title of its window (the tab in front), once per minute per title, with the seconds it was in front.

- Browsers only: Google Chrome, Microsoft Edge, Firefox, Brave, Opera (the names `AppNames` already produces, plus `Brave` and `Opera`).
- Only in the `Active` state. Never for `Idle`, `Media`, `Locked`, or `Background`.
- Titles only. Never read URLs, the address bar, page content, or keystrokes.
- A page-title sample is **extra detail**, sent **in addition to** the normal `active` sample for the browser. The server stores it in a separate table and never adds it to totals.

## Wire format (already supported by the server)

Each page sample is a normal sample with `pageTitle` set:

```json
{ "startedAt": "2026-09-17T14:05:00+00:00", "durationSeconds": 42, "state": "active", "appName": "Google Chrome", "pageTitle": "Roblox - Wikipedia" }
```

Rules the server applies, so the agent must match them:

- `state` must be `active`; `appName` must be set; `pageTitle` must be non-empty after trimming (the server trims and cuts it to 300 characters).
- Like the other samples, values are running totals for the minute. The server keeps the largest value per device/minute/browser/title, so re-sending a minute is safe.
- Samples without `pageTitle` (or with `null`) are the usual activity samples. Nothing about them changes.

## 1. Get the code

```powershell
git fetch origin
git checkout main
git pull
git checkout -b feat/agent-page-titles
```

## 2. Make the changes

All paths are under `agent\`. Keep the existing style: small records, `internal` types, no new NuGet packages.

### 2a. `ScreenTime.Agent\Models.cs`

- `Classification`: add a last optional parameter `string? PageTitle = null` (the cleaned title of the foreground browser window).
- `ActivitySample`: add a last optional parameter `string? PageTitle = null`. It serializes as `pageTitle`. Old `pending.json` files have no such field and must still load (they will, because the parameter is optional).

### 2b. New file `ScreenTime.Agent\PageTitles.cs` (pure code, no Windows APIs)

```csharp
namespace ScreenTime.Agent;

internal static class PageTitles
{
    public const int MaxLength = 300;
    public static bool IsBrowser(string? appName);          // true for the browser names above, case-insensitive
    public static string? Clean(string? windowTitle);       // null when there is nothing worth reporting
}
```

`Clean` must:

1. Return `null` for null/whitespace.
2. Remove control characters and the zero-width space U+200B (Edge writes "Microsoft", U+200B, " Edge"), then trim.
3. Remove the browser suffix at the end, in this order (case-insensitive; `[-–—]` covers hyphen, en dash and em dash):
   1. `\s[-–—]\s(?:Google Chrome|Microsoft Edge|Mozilla Firefox|Firefox|Brave|Opera)$`
   2. Edge only: a profile part `\s[-–—]\s(?:Personal|Work|Profile \d+)$`
   3. Edge only: its tab count `\s+and \d+ more pages?$`

   Do not use one combined pattern with an optional "anything" profile part: it would cut real titles that contain ` - `. Examples (all must pass as tests):
   - `Roblox - Wikipedia - Google Chrome` → `Roblox - Wikipedia`
   - `YouTube and 3 more pages - Personal - Microsoft` + U+200B + ` Edge` → `YouTube`
   - `Home — Mozilla Firefox` → `Home`
   - `Minecraft - Profile 2 - Google Chrome` → `Minecraft - Profile 2` (Chrome titles have no profile part)
4. Return `null` if what is left is empty or is a blank-tab title: `New Tab`, `New tab`, `New Private Tab`, `Start`, `Untitled`, or a bare browser name (`Google Chrome`, `Microsoft Edge`, `Mozilla Firefox`, `Firefox`, `Brave`, `Opera`).
5. Cut to `MaxLength` characters.

### 2c. `ScreenTime.Agent\MinuteAggregator.cs`

- Keep a second dictionary for the minute: `Dictionary<(string App, string Title), int> _pages`.
- In `Observe`, when `classification.State == ActivityState.Active` and `AppName` and `PageTitle` are both non-empty, add the seconds to `_pages[(AppName, PageTitle)]`. Keep the existing activity and background handling unchanged.
- `Snapshot()` returns the existing samples plus one sample per page:
  `new ActivitySample(minute, Math.Min(60, seconds), "active", app, title)`.
  It must still return an empty list when nothing was observed.
- `Flush()` also clears `_pages`.

### 2d. `ScreenTime.Agent\WindowsActivity.cs`

- Add P/Invoke for `GetWindowTextLengthW` and `GetWindowTextW` (user32, `CharSet.Unicode`), next to the existing user32 imports.
- Where the foreground window is resolved, also read its title (a `StringBuilder` or `char[]` sized `length + 1`; return `null` on 0 or on any exception).
- In `ClassifyAsync`, only for the `Active` result: when `PageTitles.IsBrowser(foregroundApp)`, set `PageTitle = PageTitles.Clean(title)`. Otherwise leave it `null`.
- Accept a `bool collectPageTitles` argument (see 2e) and skip reading the title entirely when it is `false`.
- Do not cache titles; they change with every tab switch.

### 2e. `ScreenTime.Agent\AgentConfig.cs`, `appsettings.example.json`, `install.ps1`

- `AgentConfig`: add `bool CollectPageTitles = true` as the last parameter. Pass it from `MonitorContext` into `ClassifyAsync`.
- `appsettings.example.json`: add `"CollectPageTitles": true`.
- `install.ps1`: where it writes `appsettings.json`, keep an existing `CollectPageTitles` value if the old file has one, otherwise write `true`. Do not touch how the API URL, secret, and device ID are reused.

### 2f. `ScreenTime.Agent\UploadQueue.cs`

- Change the User-Agent version from `1.2` to `1.3`. Nothing else.

### 2g. Tests: `ScreenTime.Agent.Tests\`

- In `ScreenTime.Agent.Tests.csproj`, link the new file like the others:
  `<Compile Include="..\ScreenTime.Agent\PageTitles.cs" Link="Agent\PageTitles.cs" />`
- New `PageTitlesTests.cs`: the three suffix examples above; blank-tab titles → `null`; whitespace → `null`; a 400-character title → 300 characters; a title containing ` - ` in the middle keeps it; `IsBrowser` true for `Google Chrome`/`microsoft edge`, false for `Roblox` and `null`.
- In `MinuteAggregatorTests.cs`:
  - Active browser with a title → the snapshot has the normal active sample **and** a page sample with the same seconds.
  - Two titles in one minute → two page samples with their own seconds.
  - Idle state with a title → no page sample.
  - `Flush()` clears pages; the next minute starts empty.

### 2h. Docs

- `README.md`, section **How activity is classified**: add one line saying agent 1.3 reports the foreground browser tab title (not the address) and that `CollectPageTitles: false` in `appsettings.json` turns it off.

## 3. Test and build

```powershell
dotnet test agent\ScreenTime.Agent.Tests\ScreenTime.Agent.Tests.csproj
dotnet build agent\ScreenTime.Agent\ScreenTime.Agent.csproj -c Release
```

Both must succeed with 0 failures and 0 errors. (If `dotnet` is missing, see step 2 of `docs/codex-windows-update.md`.)

## 4. Commit, open a PR, merge

```powershell
git add -A
git commit -m "feat: agent 1.3 reports foreground browser page titles"
git push -u origin feat/agent-page-titles
gh pr create --fill --base main
gh pr checks --watch
```

When all checks pass (`dashboard`, `windows-agent`), merge and update local `main`:

```powershell
gh pr merge --squash --delete-branch
git checkout main
git pull
```

If a check fails, fix it on the same branch and push again. Do not merge with a failing check.

## 5. Install (restarts the agent)

The installer reuses the existing settings, stops the running agent, copies the new build, and starts it again.

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\agent\install.ps1
```

Expected last line: `Installed. The agent is running in the notification tray and will start at sign-in.`

## 6. Verify

```powershell
Get-Process ScreenTime.Agent | Select-Object Id, StartTime, Path
Get-Content "$env:LOCALAPPDATA\ScreenTimeAgent\appsettings.json" | Select-String "CollectPageTitles|Interval"
```

Expected: one process started just now from `%LOCALAPPDATA%\ScreenTimeAgent`; `CollectPageTitles` is `true`; sample interval `2`, upload interval `1`.

Then ask the user to:

1. Open a browser, visit two or three pages for about 30 seconds each.
2. Right-click the Screen Time tray icon → **Send now**.
3. Refresh the dashboard. **Pages viewed** should list those tab titles with the browser name and times, and the totals at the top should not jump.

## 7. Report back

- test and build output (counts)
- PR link and merge commit
- output of step 6
- whether the page titles appeared on the dashboard

## Rollback

```powershell
git checkout <commit before the merge>
.\agent\install.ps1
```

To keep 1.3 but stop page titles: set `"CollectPageTitles": false` in `%LOCALAPPDATA%\ScreenTimeAgent\appsettings.json`, then run `.\agent\install.ps1` again (it keeps that value and restarts the agent).
