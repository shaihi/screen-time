# Codex: build, test, and install agent 1.1 on this Windows PC

Follow these steps in order, in PowerShell, from the repository root. Stop and report if any step fails. Do not edit the source code unless a build error below says to.

## What this update does

- Store apps (such as Roblox from the Microsoft Store) are named correctly instead of `ApplicationFrameHost`.
- Windows system processes (`explorer`, `SearchHost`, `PickerHost`, `gamingservicesui`, …) are no longer reported as apps.
- Tray **Send now** also sends the minute still in progress.
- Shutdown and sign-out save the current minute and try a quick upload. Anything not sent is kept and uploads on the next start.
- Checks the screen every 2 seconds and uploads every minute.

## 1. Get the code

```powershell
git fetch origin
git checkout fix/app-attribution
git pull
```

## 2. Check the .NET 8 SDK

```powershell
dotnet --list-sdks
```

- If an `8.0.x` SDK is listed, continue.
- If `dotnet` is missing, but `.tools\dotnet\dotnet.exe` exists in the repo, use that path in place of `dotnet` below. `install.ps1` finds it on its own.
- Otherwise install the .NET 8 SDK for the current user:

```powershell
winget install --id Microsoft.DotNet.SDK.8 --silent --accept-source-agreements --accept-package-agreements
```

Open a new PowerShell window afterwards so `dotnet` is on PATH.

## 3. Run the unit tests

```powershell
dotnet test agent\ScreenTime.Agent.Tests\ScreenTime.Agent.Tests.csproj
```

Expected: `Passed! - Failed: 0`.

## 4. Build the agent

```powershell
dotnet build agent\ScreenTime.Agent\ScreenTime.Agent.csproj -c Release
```

Expected: `Build succeeded` with 0 errors. The Windows-specific code was not compiled before it was pushed, so small compile errors are possible here. If there are any:

- Fix only the reported line, in `agent\ScreenTime.Agent\WindowsActivity.cs` or `MonitorContext.cs`, keeping the same behaviour.
- Re-run steps 3 and 4.
- Commit the fix to the `fix/app-attribution` branch and push it.

## 5. Install (replaces the running agent)

The installer reuses the existing `%LOCALAPPDATA%\ScreenTimeAgent\appsettings.json` (API URL, secret, device ID), so no secrets need to be typed. It stops the running agent, copies the new build, and starts it again.

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\agent\install.ps1
```

Expected last line: `Installed. The agent is running in the notification tray and will start at sign-in.`

Records not yet uploaded are kept in `%LOCALAPPDATA%\ScreenTimeAgent\pending.json` and upload after the restart.

## 6. Verify

```powershell
Get-Process ScreenTime.Agent | Select-Object Id, StartTime, Path
Get-Content "$env:LOCALAPPDATA\ScreenTimeAgent\appsettings.json" | Select-String "Interval"
```

Expected: one running process started just now from `%LOCALAPPDATA%\ScreenTimeAgent`, `SampleIntervalSeconds` of `2`, and `UploadIntervalMinutes` of `1`.

Then ask the user to:

1. Open Roblox (Store version) for about 30 seconds.
2. Right-click the Screen Time tray icon and choose **Send now**. The tooltip should say `Sent N minute records`.
3. Refresh the dashboard. **Roblox** should appear under "Where time went", and `ApplicationFrameHost` / `explorer` should not.

## 7. Report back

Report:

- the test and build results
- any code changes you made, and their commit hashes
- the output of step 6
- whether Roblox appeared on the dashboard

## Rollback

```powershell
git checkout main
.\agent\install.ps1
```
