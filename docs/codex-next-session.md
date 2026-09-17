# Codex next-session handoff

Read this file before changing or reinstalling Screen Time on this PC.

## Current state

- Repository: `https://github.com/shaihi/screen-time`
- Production dashboard: `https://screen-time-iota.vercel.app`
- The installed agent is the current `main` implementation with foreground browser page titles (agent 1.3 behavior).
- It runs only in the notification tray, samples every 2 seconds, uploads every minute, and starts at user sign-in.
- Installed files and preserved settings are under `%LOCALAPPDATA%\ScreenTimeAgent`.
- `CollectPageTitles` is enabled. It collects only the foreground browser window title while active—never URLs, page content, or keystrokes.
- PR #9 (`feat/agent-version-display`) is a future addition that shows version 1.4.0 in the tray tooltip and menu. It must remain unmerged until the user asks to ship it.

## Deterministic update command

From the repository root in PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\agent\update.ps1
```

The updater refuses a dirty worktree, fast-forwards `main`, runs the unit tests and release build, waits for the installed executable lock to clear, verifies the installed SHA-256 hash, restarts the agent, and verifies that exactly one installed process is alive. It reuses the existing API URL, ingest secret, device ID, and `CollectPageTitles` value. Do not print those secrets.

## Quick verification

```powershell
Get-Process ScreenTime.Agent | Select-Object Id, StartTime, Path
Get-Content "$env:LOCALAPPDATA\ScreenTimeAgent\appsettings.json" |
    Select-String "CollectPageTitles|Interval"
```

Expected: one process from `%LOCALAPPDATA%\ScreenTimeAgent`, `SampleIntervalSeconds` 2, `UploadIntervalMinutes` 1, and `CollectPageTitles` true.

## Remaining user validation

Ask the user to visit two or three browser pages for about 30 seconds each, right-click the tray icon and choose **Send now**, then refresh the dashboard. The **Pages viewed** panel should show the cleaned tab titles without changing overall usage totals.
