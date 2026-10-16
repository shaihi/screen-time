# Windows control service

Parent setup is documented in [the simple setup guide](../../docs/START-HERE.md).
The wire contract is [CONTROL-PROTOCOL.md](../../docs/CONTROL-PROTOCOL.md).

This is a Windows 11 Pro LocalSystem service, named `ScreenTime.Control`. The
service implements whole-account cutoff: its owned deny-logon group prevents a
new child sign-in, and every existing child console/RDP session is signed out.
Each new cutoff starts a durable 30-second save countdown. At zero the service
requests a graceful close, force-kills remaining child-owned processes (including
apps waiting on save dialogs), then signs out. It does not preserve an open
desktop behind a normal lock screen.

## Protected files

The fixed state directory is `%ProgramData%\ScreenTime\Control`. The installer
must restrict writes to SYSTEM and Administrators before invoking any service
helper. The service refuses writable state paths and reparse points.

- `service.json`: enrollment target, parent/child/group SIDs, device credential,
  pinned policy verification key, and HTTPS API origin.
- `policy.json`: the initial signed enrollment envelope.
- `restriction-group.json`: exact SID ownership receipt for `ScreenTimeRestricted`.
- `state.json`: atomic write-through usage ledger, current/pending signed policy
  envelopes, trusted time anchors, desired restriction journal, last verified
  applied revision, and an active cutoff deadline. The ledger and countdown remain
  across policy edits and service restarts.
- `service.log` and `.old`: bounded local diagnostic logs; no credentials or
  downloaded policy bodies are logged.

The fixed executable paths are `%ProgramFiles%\ScreenTime\Service\ScreenTime.Service.exe`
and `%ProgramFiles%\ScreenTime\Tray\ScreenTime.Agent.exe`. The sensor is launched
with the enrolled child's session token and `--managed`, without elevation, using
`CreateProcessAsUser`. No policy or IPC message can select an executable path.

## Local helpers

Run these only from an elevated parent PowerShell. The installer/recovery scripts
normally perform these steps.

- `ScreenTime.Service.exe --prepare`: create the owned restriction group, persist
  its SID receipt, assign only console/RDP deny-logon rights, and verify those
  rights. Outputs JSON `{ "restrictionGroupSid": "..." }`. An existing group
  without the matching protected receipt is refused.
- `ScreenTime.Service.exe --recover`: require the service to be stopped, validate
  the protected enrollment and exact group SID, remove only the enrolled child
  membership, and verify removal. It does not erase usage, reset passwords, or
  alter other account rights. The child SID cannot run this helper as itself.
- `ScreenTime.Service.exe --remove-restriction-group`: restore access as above,
  remove this group's two rights, and delete the owned empty group. For an
  interrupted installation without `service.json`, the exact protected SID
  receipt and an empty group are mandatory.

Stopping or crashing the service does not automatically undo an existing deny
membership. A separate working parent administrator account and the offline
recovery script are essential. Service removal must restore access first.

## Evaluation and accounting

The default signed policy is monitoring only. Managed policies reject a child
administrator or any still-open child token containing the Administrators SID.
Policies bind the exact enrolled household, device and Windows SID. Signature,
schema, revision rollback, same-revision policy changes, and regressing signed
server time are checked before acceptance. Same-revision syncs may refresh
server time. Future revisions remain pending while current rules continue.

Recurring rules work offline. The policy timezone determines date and schedule;
backwards date movement reuses the highest usage day, and timezone edits carry
the current usage forward. Grants add budget once per unique ID and never bypass
bedtime. Only an explicit unexpired override can bypass selected rules.

Usage intervals use Windows `QueryUnbiasedInterruptTime`, excluding sleep, and
are persisted about once per second before an access change. Several simultaneous
child sessions count once. `unlocked_session` counts every verified unlocked
child session and is the recommended setting for dependable enforcement.
`actual_use` accepts active/media/idle observations only from the protected tray
executable, authenticated by pipe client SID, session ID and process executable.
The service owns receipt time and never accepts a claimed duration. Missing,
stale, or inconsistent sensors fall back to unlocked-session counting, and sensor
restart is attempted every 30 seconds.

If protected state cannot be saved (for example, the disk is full), managed mode
restricts the child conservatively and reports an error without acknowledging a
new applied revision. The parent must free disk space or use offline recovery.
Monitoring mode reports the error and does not restrict the child.

A child can manipulate processes running as their own Windows identity, so
`actual_use` is a best-effort activity estimate even with a protected executable.
Choose `unlocked_session` when resistance to that manipulation matters.

Unexpected clock movement across restart (more than two minutes backwards or
36 hours forwards) holds the prior trusted time and reports an error until a
signed online sync repairs it. Correct Windows time is required for the sync's
five-minute request-authentication window. A parent may need to correct the
Windows clock before repair. This conservative behavior can delay offline
schedule/day recovery after a long shutdown; it does not promise protection
against a machine administrator.

Warnings are returned at five minutes and one minute before the current budget
or allowed-hours boundary. At the boundary, or after a parent presses Shutdown,
the tray shows a non-dismissible 30-second countdown owned by the service's
durable state. Killing the tray does not stop the deadline. OS membership and
rights are verified, remaining child-owned apps are force-closed, and `blocked`
is acknowledged only after no child session remains. Failures produce error
status and retain the prior verified applied revision. Parent sync continues
while the child is signed out. No automatic privileged updater or remote command
runner is included.

## Validation

Cross-platform policy tests:

```sh
dotnet test agent/ScreenTime.Control.Tests/ScreenTime.Control.Tests.csproj --collect:"XPlat Code Coverage"
```

Windows cross-build:

```sh
dotnet build agent/ScreenTime.Service/ScreenTime.Service.csproj -p:EnableWindowsTargeting=true
```

The native adapter must still pass the Windows acceptance checklist in the main
architecture document: password/PIN/Hello, Microsoft and local accounts,
console/RDP/disconnected sessions, reboot, recovery, uninstall, lost network,
sensor failure, and school/domain policy conflicts. macOS builds and pure policy
tests cannot establish those OS behaviors. The initial sign-in gap before the
service reconciles a newly reached offline boundary is also unmeasured.
