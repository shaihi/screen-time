# Screen Time

A private, minute-level Windows screen-time monitor with a Vercel-hosted dashboard.

The Windows agent lives only in the notification tray—there is no taskbar window. It distinguishes hands-on activity, media playback, idle time, and a locked workstation. Two-second observations are aggregated into minute buckets locally, then uploaded in a signed batch every minute (including the minute in progress). Store apps are named by their package, and Windows shell processes are not reported.

## Privacy boundary

Collected:

- Device label
- Minute timestamp and number of observed seconds
- State: `active`, `media`, `idle`, `locked`, or `background` (media playing while another app is in use; not added to totals)
- Foreground or playing application name (for example, Google Chrome)
- Title of the browser tab in front, while a browser is in use (agent 1.3+; set `CollectPageTitles` to `false` in the agent's `appsettings.json` to turn it off). Titles can include search terms or video names.

Never collected:

- Keystrokes or typed text
- Screenshots or camera/microphone data
- Browser URLs (web addresses), page content, or media titles
- File names or document contents

Use this only on a computer you own or administer, with the knowledge of the person using it. The tray icon and pause/exit controls are intentionally visible.

## Repository layout

- `agent/ScreenTime.Agent` — .NET 8 Windows tray agent
- `agent/install.ps1` — publishes and installs the agent for the current user
- `dashboard` — Next.js dashboard and authenticated ingest API
- `.env.example` — Vercel/database configuration template

## Deploy the dashboard

1. Import this repository into Vercel and set the **Root Directory** to `dashboard`.
2. Add a Neon Postgres integration from the Vercel Marketplace. Confirm it provides `DATABASE_URL`.
3. Add these environment variables to Production and Preview:
   - `INGEST_SECRET`: a random value of at least 32 characters
   - `DASHBOARD_PASSWORD`: a long, unique password
   - `DISPLAY_TIME_ZONE`: for example `Asia/Jerusalem`
4. Deploy. The schema is created on first dashboard/API access.
5. Verify `https://YOUR-PROJECT.vercel.app/api/health` returns `{"ok":true,...}`.

The dashboard uses a password-only sign-in form over HTTPS and stores only an HMAC-signed, HTTP-only session cookie in the browser. Leading or trailing spaces introduced by copy/paste are ignored. The ingest endpoint uses a separate HMAC-SHA256 signature and rejects requests whose timestamps are more than ten minutes from the server clock.

## Install the Windows agent

Requirements for building: Windows 10/11 and the .NET 8 SDK. The published executable is self-contained, so the monitored account does not need .NET after installation.

For subsequent updates, run `Set-ExecutionPolicy -Scope Process Bypass -Force` followed by `.\agent\update.ps1`. The updater requires a clean worktree, fast-forwards `main`, runs the agent tests and release build, installs with executable-lock and hash verification, then confirms exactly one agent process is running.

From PowerShell in this repository:

```powershell
.\agent\install.ps1 `
  -ApiUrl "https://YOUR-PROJECT.vercel.app/api/ingest" `
  -IngestSecret "THE-SAME-SECRET-AS-VERCEL" `
  -DeviceId "family-pc"
```

This publishes the agent, copies it to `%LOCALAPPDATA%\ScreenTimeAgent`, creates a current-user Startup shortcut, and launches the notification-tray icon. It does not request administrator elevation.

Right-click the tray icon to upload immediately, pause for 30 minutes, resume, or exit. Starting with agent 1.4, its version is visible in the tray tooltip and menu. When offline, completed minute records remain queued locally and are retried later.

The headline number is **real use** (hands-on plus watching). A switch above the cards, **Count unattended as usage**, adds time the screen was on with an app left running but no input; the choice is saved in the browser. The three cards and the bar split screen-on time into real use, unattended and idle.

The dashboard has **Day** (midnight until now), **Week** (since Sunday), and **Month** (since the 1st) views. The activity chart and app list are coloured by category (Gaming, Social, Video, Music, Web, Apps & AI, Other; see `dashboard/lib/categories.ts`); hover or tap a coloured block to see that app's time in the hour or day. Time in system or hidden apps shows as "Other apps". The **Pages viewed** panel lists browser tab titles with times, or total time per title (agent 1.3+; hiding a browser hides its pages too). Idle time while an app stayed in front (for example a game left on with no input) is shown as **left running**: in the Idle card, under "Where time went", in the chart tooltip, and as marked rows in Sessions. It is never added to screen time. **Customize layout** lists the panels: drag a row by its handle or use the arrows to reorder, and choose full or half width on wider screens; the layout is saved in the browser. The **Sessions** panel lists when each app was used and for how long (back-to-back minutes count as one session; "In use" shows exact seconds). The **Overlap** panel lists audio or video playing in one app while another app was in use — Windows focuses one window at a time, so that is the only overlap the agent can observe (agent 1.2+).

In the dashboard's app breakdown, use the `×` beside a program to hide it from the list. Expand the hidden-apps section to restore it. Hiding an app affects only the breakdown; its time remains part of the overall screen-time total.

To remove the agent and its local queued data:

```powershell
.\agent\uninstall.ps1
```

## How activity is classified

Every two seconds, in priority order:

1. A locked Windows desktop is `locked`.
2. Input within the configured idle threshold (default: 120 seconds) is `active`.
3. With no recent input, an active Windows media session is `media`.
4. Otherwise the computer is `idle`.

The fine observations never leave the device. Each completed UTC minute is reduced to one or more state/app totals, accurate to the two-second observation interval. Browser video normally advertises a Windows media session, so Netflix and YouTube continue to count while the viewer is not touching the mouse or keyboard.

Agent 1.3 also reports the foreground browser tab title—not its address—while the browser is actively used. Set `"CollectPageTitles": false` in `appsettings.json` to turn this off.

## Local dashboard development

```powershell
Copy-Item .env.example dashboard/.env.local
pnpm install
pnpm dev
```

Without `DATABASE_URL`, the dashboard renders its empty state. For a complete local test, use a disposable Postgres database and replace all placeholder secrets.

## Operational notes

- Upload cadence is controlled by `UploadIntervalMinutes` in the installed `appsettings.json`.
- The agent is session-specific by design. A Windows service cannot reliably query foreground windows or per-user media sessions.
- A browser may fail to expose playback if media controls are disabled. Such playback will become `idle` after the input threshold; this is a known limitation of the privacy-preserving, no-screen-capture approach.
- Device clocks must be reasonably correct because signed requests expire after ten minutes.
