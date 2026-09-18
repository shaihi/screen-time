# Auto-update spec (for Codex/Windows implementation)

Step 2 of the v1.5 plan (installer → **auto-update** → multi-tenant isolation).
Installer step is done (`agent/package.ps1`, `agent/install-release.ps1`,
`.github/workflows/agent-release.yml`, `agent-v1.4.0` published). This spec
covers wiring the tray agent to notice and install new releases.

## Decided constraints (do not relitigate)

- **Click-to-confirm, not silent.** The agent notices a new version and shows
  a tray notification; the user clicks it to install. No unattended
  self-replacing binary — this was chosen specifically to avoid the
  Defender/SmartScreen reputation risk of silent auto-updaters running
  unsigned code.
- **No code-signing certificate.** A SmartScreen "unrecognized publisher"
  prompt on the downloaded update is accepted, not solved.
- **No token embedded in the agent.** The repo is now public
  (`github.com/shaihi/screen-time`), so the manifest URL is anonymous HTTPS —
  do not add any GitHub auth to the agent.

## Manifest

Published by `.github/workflows/agent-release.yml` on every `agent-v*` tag,
always fetchable at:

```
https://github.com/shaihi/screen-time/releases/latest/download/manifest.json
```

Verified live:

```json
{
  "version": "1.4.0",
  "url": "https://github.com/shaihi/screen-time/releases/download/agent-v1.4.0/ScreenTimeAgent-1.4.0.zip",
  "sha256": "..."
}
```

## What to build

1. **`UpdateChecker.cs`** (new, alongside `AgentConfig.cs`): on agent start,
   and once per 24h thereafter (no tighter polling — this is a hobby project,
   not a fleet), `GET` the manifest URL. Compare `manifest.version` against
   `typeof(MonitorContext).Assembly.GetName().Version` (same value already
   shown in the tray, from PR #9). If newer, raise an event/callback the tray
   can react to. Any network failure is silent — never surface a raw
   exception to the tray for a background check.

2. **`MonitorContext.cs`**: on "update available," call
   `notifyIcon.ShowBalloonTip(...)` ("Screen Time 1.5.0 is available — click
   to install") and handle `notifyIcon.BalloonTipClicked` to kick off the
   install flow below. Add a "Check for updates" item to the existing
   right-click menu (next to Pause/Resume/Exit) for a manual trigger.

3. **Install flow, on click**:
   - Download `manifest.url` to a temp path.
   - Verify SHA-256 of the downloaded zip against `manifest.sha256` in C#
     **before** doing anything else — this is the only place the published
     hash is actually checked. Abort and show an error balloon on mismatch.
     (`install-release.ps1`'s `Install-VerifiedFile` only compares its own
     staged copy against its own source file — a copy-corruption check, not
     a check against the manifest hash. It does not re-verify what you
     already verified in C#, so don't skip the step above.)
   - Extract the zip to a fresh temp directory, locate `ScreenTime.Agent.exe`
     inside it, and **delete the temp directory after the script below
     starts** (nothing currently cleans it up).
   - Do **not** reimplement the stop/wait-for-unlock/swap/restart sequence
     in C#. Shell out to `install-release.ps1` **using its absolute path**
     from the extracted zip, with `WorkingDirectory` set to that same
     extracted folder — the agent's own working directory is
     `%LOCALAPPDATA%\ScreenTimeAgent`, not the temp extract, so a relative
     path will fail
     (`Process.Start("powershell.exe", "-NoProfile -WindowStyle Hidden
     -ExecutionPolicy Bypass -File <absolute path> -ApiUrl ... -IngestSecret
     ... -DeviceId ...")`, passing the values already in the running
     `AgentConfig` so the user isn't prompted again). That script stops the
     process, waits for the file lock, re-copies and hash-verifies its own
     copy, updates the shortcut, and restarts exactly one instance. Have it
     write to a log file (`Start-Transcript`) since a `throw` after the
     agent process is killed has nowhere to surface.
   - The agent's own process will be killed mid-flow by that script; this is
     expected, not an error to handle. No elevation is needed — everything
     runs as the current user under `%LOCALAPPDATA%`.

4. **Tests**: `UpdateChecker`'s version-compare logic and manifest parsing
   need unit tests (mock the HTTP call) in
   `agent/ScreenTime.Agent.Tests/`. Do not write a test that hits the real
   GitHub URL.

## Follow-up (post-#12 review)

`UpdateChecker.StartInstallAsync` creates
`%TEMP%\ScreenTimeAgent-update-<guid>\` (zip + extracted package) but never
deletes it. `install-release.ps1` is started from inside that folder and the
agent's own process gets killed mid-install, so the cleanup can't happen
before handoff and can't happen in the agent's own `finally` either. Fix by
having `install-release.ps1` itself remove its own parent temp directory as
its last step, after it has finished copying `ScreenTime.Agent.exe` out of
it and no longer needs anything there (`Remove-Item $PSScriptRoot\.. -Recurse
-Force` guarded to only fire when `$PSScriptRoot` is actually under
`%TEMP%\ScreenTimeAgent-update-*`, so a normal manual run from a
downloaded-and-extracted release zip elsewhere is never touched).

## Explicitly out of scope here

- Delta updates, rollback, staged/percentage rollouts.
- Any server-side (Vercel/Neon) involvement — the manifest lives entirely on
  GitHub Releases, no dashboard change needed for this step.
