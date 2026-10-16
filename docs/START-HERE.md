# Start here: make the computer stop when time is up

This guide uses small steps. **A grown-up does the setup.**

Think of Screen Time as a timer with a gate:

- While time is left, the gate is open. All apps work.
- Before time runs out, the computer says, “Save your work.”
- When time is gone, the gate closes. Windows signs the child out.
- You can add more time. The gate opens when all the rules allow it.

Signing out closes games and documents. Unsaved work can be lost.

## What you need

- The child's **Windows 11 Pro** computer.
- Your own **Administrator** account on that computer.
- The child's own **Standard** account. They keep their own PIN.
- The current `main` branch.
- Your existing Screen Time dashboard, with its database.
- An authenticator app on your phone. It makes the six-digit codes for parent changes.

The new control code is not switched on just because it is in this branch. Installation starts in **Watch only** mode.

## Part 1 — Give yourself the grown-up key

Do this on the Windows computer.

1. Open **Settings**.
2. Open **Accounts**, then **Other users**.
3. Make sure you have your own account. Its type must be **Administrator**.
4. Sign in to your account. Make sure it works. Keep its password and PIN private.
5. Change the child's existing account type to **Standard user**. Do not delete their account.
6. Sign the child completely out. “Switch user” is not enough for setup.
7. Sign back in to your parent account.

Why? The child gets freedom to use their apps. The grown-up keeps the key that changes the timer. If the child has an Administrator account too, they can turn the timer off.

## Part 2 — Prepare the dashboard once

Do this in the repository on your development computer. These steps create private keys and new database tables. They do not change a Windows account.

### 1. Install the project tools

Open a terminal in the repository folder. Use Node.js 24 or newer and the project's pnpm version.

```sh
pnpm install --frozen-lockfile
```

### 2. Make the private settings file

```sh
node scripts/control-setup.mjs generate --output .env.control.local
```

The command creates a private file. It does not show the secret keys in the terminal. Keep this file safe. Do not put it in Git, send it to someone, or paste it into a chat. Do not generate replacement keys for an enrolled computer without planning recovery first.

### 3. Put the new settings in Vercel

Open your dashboard's Vercel project. Open **Settings → Environment Variables**.

Open `.env.control.local` privately in your editor. Add these three names and their values to the environment where you will deploy this branch:

| Name | What to copy |
| --- | --- |
| `CONTROL_ENCRYPTION_KEY` | Its value from the private file |
| `CONTROL_POLICY_PRIVATE_KEY_PEM` | The private-key text; remove the file's outer quotation marks, keep the `\n` sequences or use real newlines |
| `CONTROL_PARENT_TOTP_SECRET` | Its value from the private file |

Keep the existing `DATABASE_URL`, household/password settings, and `DISPLAY_TIME_ZONE`. Use `Asia/Jerusalem` if that is your family's timezone.

If you use a `HOUSEHOLDS` device list, add the chosen computer label, such as `family-pc`, to your family's list. The existing single-family configuration already accepts device labels.

### 4. Add the phone code

In your authenticator app, choose **Add account → Enter setup key** or the similar option.

- Name: **Screen Time Parent**.
- Key: the value of `CONTROL_PARENT_TOTP_SECRET`.
- Type: **Time based**; six digits, 30 seconds.

The phone now shows a new six-digit code every little while. The child does not need this key or app.

### 5. Add the database tables

Put the intended dashboard database connection in a private root `.env.local` file as `DATABASE_URL=...`. Use a test database first. The next command changes the database named in that file, so check the file before running it.

```sh
node --env-file=.env.control.local --env-file=.env.local scripts/control-setup.mjs migrate
```

Success says **Installed control database migration 001**, or says it was already installed. The migration adds control tables alongside existing activity data. Do not use a different family's database.

### 6. Deploy the branch

In Vercel, deploy `main` with the new settings. A preview deployment is useful for testing. Use its exact HTTPS dashboard address when installing the Windows service; keep that deployment available afterward.

The deployment's API must be reachable without a separate Vercel deployment-password or browser-login page. The Screen Time app still requires its own parent login, setup token, and device authentication. A protected preview that redirects the installer to a login page will not work.

Sign out of the dashboard and sign back in after setup. This gives you a new parent session. Open **Screen-time controls**, type the current six-digit phone code, and click **Unlock controls**. Parent changes unlock for ten minutes. If a code was already used, wait for the next one.

## Part 3 — Make the Windows package

If you received the ready-built `agent/artifacts/ScreenTime-Control-win-x64.zip` from this branch, copy that ZIP to the Windows computer and skip the build commands below. You do not need Git, Node, or the .NET SDK on that computer just to install the ZIP.

A developer does this on Windows with the .NET 10 SDK. The finished package needs no SDK on the child's computer.

From the repository root on Windows:

```powershell
git switch main
dotnet test agent\ScreenTime.Agent.Tests\ScreenTime.Agent.Tests.csproj
dotnet test agent\ScreenTime.Control.Tests\ScreenTime.Control.Tests.csproj
.\agent\package-control.ps1
```

If PowerShell says scripts cannot run, use this in that same window, then try again:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
```

The package is `agent\artifacts\ScreenTime-Control-win-x64.zip`. Copy it to the Windows PC and extract the whole ZIP. Open the **ScreenTime-Control** folder inside it. Keep `Service`, `Tray`, and the `.ps1` files together.

## Part 4 — Connect the Windows computer

1. On your phone or browser, open the dashboard and unlock parent controls.
2. Open **Add a Windows computer**.
3. Enter the computer label, for example **family-pc**. Use the same label as the old monitor if this is the same PC.
4. Click **Create one-use setup code**. Select and copy the hidden code. It expires after ten minutes and works once.
5. On Windows, stay signed in as the parent. Keep the child signed out.
6. Open the extracted **ScreenTime-Control** folder in File Explorer.
7. Open PowerShell in that folder. Run it **as Administrator**. If the new window opens somewhere else, type `cd` followed by the full folder path in quotes.
8. Run this. Replace the example address with your deployed dashboard's HTTPS address:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\install-control.ps1 -ApiBaseUrl "https://YOUR-DASHBOARD.vercel.app" -DeviceId "family-pc"
```

9. Setup lists the Windows account names. Type the **child's account name**, not yours.
10. Setup asks for the one-use code. Paste it and press Enter. The letters stay hidden. That is normal.
11. Success says **Installed in MONITOR mode. Nothing is blocked yet.**

Do not use `/api/ingest` in the dashboard address. Do not run the old `install.ps1` for this new service.

If setup fails, stop here and read the message. Use the rescue steps below before trying again. An enrollment can be used once; a failed or removed enrollment may need a new computer label, added to your household device list, and a new setup code. Do not delete server records to force reuse.

## Part 5 — Check it before closing the gate

Keep all work saved. A short test is for the grown-up to supervise.

1. Sign in as the child once. The tray icon should appear.
2. Open the parent dashboard. Wait about a minute. The computer should check in as **Monitoring · no blocking**.
3. Go back to the parent Windows account and open Administrator PowerShell. From the extracted package, run:

```powershell
.\test-control-install.ps1 -RequireRunning
```

4. Make sure the checks pass. This command checks setup; it does not test a real cutoff.
5. Test the rescue command below. It stops control and restores access. Then restart the service from parent Administrator PowerShell while the policy is still **Watch only**:

```powershell
Set-Service -Name ScreenTime.Control -StartupType Automatic
Start-Service -Name ScreenTime.Control
```

6. Sign in as the child again. In the dashboard, enter a small daily limit. The service counts usage already observed today, so choose a limit a few minutes above the reported total.
7. Set **Blocking → Enforce rules — sign out at cutoff**. Check the save/recovery box and save.
8. Wait for the computer to confirm the new rules. Use an app until the test limit is reached. Windows should sign the child out. Their PIN should not let them back in while time is still blocked.
9. The parent account must still sign in. From the dashboard, add **+15 min today**. If the schedule also blocks access, use temporary access and explicitly select the allowed-hours override too.
10. The child should be able to sign in after the computer confirms the grant.

Before relying on it, also test a reboot, internet disconnected, PIN/password sign-in, and sleep across a cutoff. Check that these do not reset used time. A PC that was off during the start of a blocked period may need service startup time to apply the restriction; test that startup gap on this PC.

## Part 6 — Everyday use

- Set **Daily limit in minutes**. Blank means no daily cap.
- **Active use + watching** counts the same kind of activity as the existing monitor. If the sensor stops, the service conservatively counts unlocked session time.
- **All unlocked session time** counts idle time too.
- Choose **All unlocked session time** for the most dependable budget accounting. **Active use + watching** uses the child-session sensor and is an estimate that can be manipulated by software running as that child.
- Set **Same hours every day** if you want a bedtime. The end must be later than the start. Use the API for a custom weekly or overnight schedule.
- **+15 / +30 / +60 min today** adds time for that day. It does not cancel bedtime.
- **Allow temporarily** can bypass the budget. Its separate checkbox also bypasses allowed hours when you choose it.
- **Watch only** turns blocking off after the computer receives and applies the change.
- **Apply these changes** can give one or five minutes to save work before new rules start. Existing rules keep working until then. This does not add grace to the normal daily cutoff.
- If the PC is offline, new changes wait. The saved rules on the PC keep working.

Closing or pausing the tray does not stop the rules. The Windows service keeps the timer.

## Big help button: rescue, even with no internet

Use your separate **parent Administrator** account on Windows. Open PowerShell **as Administrator**.

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
& "C:\Program Files\ScreenTime\recover-control.ps1"
```

Success says the child can sign in again. Control is stopped and disabled. This works without the dashboard or internet. It does not delete your child's files.

If setup stopped before that file was copied, run `recover-control.ps1` from the extracted package instead:

```powershell
.\recover-control.ps1
```

Saved rules remain on disk. Do not restart the service until you want those rules back. Never delete the protected control files or restriction group as a shortcut to recovery.

## Remove the new control service

From parent Administrator PowerShell:

```powershell
& "C:\Program Files\ScreenTime\uninstall-control.ps1"
```

This restores child access before removing the service. Afterward, remove the remote connection in the dashboard if you no longer want it connected. Removing the remote connection by itself does not clear saved local rules.

## If something is confusing

| You see this | Do this |
| --- | --- |
| Controls are not set up yet | Finish the environment variables, database migration, and branch deployment |
| Parent login required | Sign out, then sign back in after deploying the control setup |
| Unlock controls | Type the current code from your authenticator app |
| Waiting for computer | Leave it on and online; a saved change has not been confirmed yet |
| Offline | New parent changes cannot reach it; old local rules still apply |
| Needs attention | Read the device message; use local rescue if access is stuck |
| The PC disk is full / timer cannot save | In enforced mode the service may block access rather than lose the timer. Use the parent account to free space, then use rescue if needed |
| Clock message after a long shutdown | Check the Windows date/time and connect to the internet so the service can verify server time; use parent rescue if needed |
| Child is an Administrator | Change their existing daily account to Standard, then sign them completely out |
| Setup code expired / already used | Create a new code; a previously enrolled device may need a new label after recovery/uninstall |

This branch can be built and tested on a development machine. Real Windows account restrictions must be verified on Windows 11 Pro using the steps above. Do not treat a passing unit test as proof that Windows has blocked sign-in.
