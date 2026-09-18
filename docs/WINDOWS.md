# Windows-side tasks (run these via Codex on a Windows machine)

This repo is developed on macOS, but the agent only builds and runs on
Windows. Anything below needs a real Windows box.

## 1. Verify the packaged installer builds

```powershell
git pull
cd agent
.\package.ps1
```

Expect: `agent\dist\ScreenTimeAgent-1.4.0.zip` and a matching `.sha256` file.
This zip is what a real release will attach to GitHub — it contains only
`ScreenTime.Agent.exe`, `install-release.ps1`, and `uninstall.ps1`. No .NET
SDK, no git clone needed to run it.

## 2. Verify the zip installs cleanly on a fresh account

```powershell
Expand-Archive .\dist\ScreenTimeAgent-1.4.0.zip -DestinationPath C:\Temp\sta-test
cd C:\Temp\sta-test
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\install-release.ps1 -ApiUrl "https://YOUR-PROJECT.vercel.app/api/ingest" -IngestSecret "..." -DeviceId "test-pc"
```

Expect: one `ScreenTime.Agent` tray process running, a Startup shortcut, and
a Windows "unrecognized publisher" SmartScreen prompt on first run (expected
— there's no code-signing cert; click "More info" → "Run anyway").

## 3. Tag a release once the above passes

```powershell
git tag agent-v1.4.0
git push origin agent-v1.4.0
```

This triggers `.github/workflows/agent-release.yml`, which runs on
`windows-latest`: tests, packages, and attaches the zip + `.sha256` +
`manifest.json` to a GitHub Release. The future in-agent auto-updater
should poll `https://github.com/shaihi/screen-time/releases/latest/download/manifest.json`
(a stable URL GitHub always redirects to the newest release) — not yet
implemented, that's the next piece of work, sequenced after this.

The repository is now public, and the browser-style stable URL above was verified
to return the manifest anonymously. Agent 1.5 implements the click-to-confirm
update flow without embedding a GitHub token.

## Not done yet, on purpose

- **Multi-household data isolation** (`household_id` + RLS + per-household
  secrets) — not started; only matters once a second household's data is
  about to land in the shared DB.

Report back what actually happened at each step (errors, SmartScreen
wording, process count) rather than assuming success — I can't run
PowerShell from here to check.
