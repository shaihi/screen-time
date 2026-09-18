# Codex next-session handoff

Read this file before changing or reinstalling Screen Time on this PC.

## Current state

- Repository: `https://github.com/shaihi/screen-time`
- Production dashboard: `https://screen-time-iota.vercel.app`
- The installed agent is version 1.5.0 from current `main`, with foreground browser page titles, a visible tray version, and click-to-confirm updates.
- It runs only in the notification tray, samples every 2 seconds, uploads every minute, and starts at user sign-in.
- Installed files and preserved settings are under `%LOCALAPPDATA%\ScreenTimeAgent`.
- `CollectPageTitles` is enabled. It collects only the foreground browser window title while active—never URLs, page content, or keystrokes.
- PR #9 (`feat/agent-version-display`) was merged and installed on 2026-09-18.
- Agent release `agent-v1.4.0` was published on 2026-09-18 with a ZIP, SHA-256 file, and manifest. The ZIP installer was verified in an isolated clean install and the production agent was restored afterward.
- PR #12 (`feat/agent-auto-update`) was merged and agent 1.5.0 was installed on 2026-09-18. It checks the public anonymous release manifest at startup and once per 24 hours, notifies when a newer version exists, and installs only after the user clicks the notification. The tray menu also has **Check for updates**.
- The repository is public and `releases/latest/download/manifest.json` is available anonymously. No GitHub token is embedded in the agent.

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
