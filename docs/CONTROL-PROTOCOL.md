# Control protocol v1 (implementation contract)

All JSON uses camelCase. UTC timestamps use ISO 8601. Device IDs use the existing `[a-zA-Z0-9._-]{1,64}` format. A child is identified by its Windows SID, never its display name. The implementation initially supports one child SID per enrolled device.

## Policy

```json
{
  "schemaVersion": 1,
  "householdId": "default",
  "deviceId": "family-pc",
  "windowsSid": "S-1-5-21-111-222-333-1001",
  "revision": 1,
  "issuedAtUtc": "2026-10-15T12:00:00Z",
  "effectiveAtUtc": "2026-10-15T12:00:00Z",
  "mode": "monitor",
  "shutdown": false,
  "timeZone": "Asia/Jerusalem",
  "dailyLimitSeconds": 7200,
  "budgetBasis": "actual_use",
  "allowedWindows": [],
  "grants": [],
  "override": null
}
```

`mode` is `monitor` or `managed`. No schedule/budget restrictions apply in monitor mode. `shutdown` is a parent-controlled emergency restriction that overrides monitoring, grants, and temporary access until explicitly cleared. Policies issued before this field existed are treated as `false`. `dailyLimitSeconds` is null (no cap) or an integer 60..86400. `budgetBasis` is `actual_use` or `unlocked_session`. `allowedWindows` is empty (no schedule), or entries `{dayOfWeek:0..6,startMinute:0..1439,endMinute:1..1440}` where Sunday=0 and start < end. Intervals are half-open; use two entries to cross midnight. A non-empty schedule denies times absent from it.

`grants` entries: `{id:UUID,day:"YYYY-MM-DD",seconds:60..86400,expiresAtUtc:ISO}`. They apply once to that policy date's budget while unexpired and do not bypass the schedule. `override` is null or `{id:UUID,untilUtc:ISO,ignoreBudget:boolean,ignoreSchedule:boolean}`. Policy revisions are immutable, monotonically increasing, scoped to the enrolled target, and signed. Base rules remain cached until replaced; grants/override expire.

## Enrollment

Parent creates a one-use 10-minute token bound to a device ID using `POST /api/control/enrollment-tokens` with `{deviceId}`. Response `{token,expiresAtUtc}`. Requires parent authentication and control step-up.

Elevated installer sends `POST /api/agent/control/enroll` with `{token,deviceId,windowsSid,deviceName}` over HTTPS. Response `{deviceId,householdId,windowsSid,credential,policyPublicKeyPem,envelope}`. Credential is 32 random bytes encoded as base64. Server stores it encrypted using CONTROL_ENCRYPTION_KEY, separate from household ingest keys. Token redemption is atomic. Device cannot re-enroll over an existing active enrollment.

## Signed envelope

`envelope` is `{payload,signature}`. Payload is base64 of exact UTF-8 JSON `{"policy": POLICY, "serverTimeUtc": ISO}`. Signature is base64 RSA-SHA256 with PKCS#1 v1.5 padding over the decoded payload bytes. Public key is PEM SubjectPublicKeyInfo; private key is PKCS#8 PEM in CONTROL_POLICY_PRIVATE_KEY_PEM. Enrollment pins the key over parent-authorized HTTPS; routine sync cannot replace it. Reject wrong schema/target, invalid signature, lower revision, changed payload at the same revision, or regressing authenticated server time. Never execute a downloaded command or package.

## Device sync

`POST /api/agent/control/sync`, headers:

```text
x-screen-time-device-id: enrolled ID
x-screen-time-timestamp: integer Unix seconds
x-screen-time-nonce: UUID
x-screen-time-signature: lowercase hex HMAC-SHA256
```

HMAC key is the decoded base64 credential. Canonical UTF-8 text, without trailing newline:

```text
v1
POST
/api/agent/control/sync
DEVICE_ID
TIMESTAMP
NONCE
SHA256_HEX_OF_EXACT_BODY
```

Timestamp tolerance is five minutes. Nonces are recorded atomically per device and rejected on reuse. Invalid/revoked identities cannot read policy or write status. Request body:

```json
{
  "protocolVersion": 1,
  "appliedRevision": 1,
  "state": "allowed",
  "reason": "Within screen-time rules",
  "usedSeconds": 123,
  "remainingSeconds": 7077,
  "policyDay": "2026-10-15",
  "sensorHealthy": true,
  "agentVersion": "2.1.0",
  "error": null
}
```

State: `monitoring`, `allowed`, `warning`, `countdown`, `blocked`, `error`. `countdown` means the device received a blocking decision and is displaying its non-dismissible 30-second save warning; the revision is not reported as applied until enforcement succeeds. Remaining seconds may be null. Error is null or bounded text. Blocked means the OS restriction, forced app closure, and session termination were verified. Response `{envelope}`. Sync at startup and roughly every 30 seconds with bounded retry/backoff. Time/skew authentication failures do not remove saved rules.

## Parent API

All `/api/control/*` routes independently verify the existing household session (do not trust a caller-supplied household header), enforce same-origin changes, reject missing authentication even in local development, and use no-store responses. Parent control step-up uses TOTP via `POST /api/control/unlock` with `{code}` and a short-lived signed HttpOnly cookie. CONTROL_PARENT_TOTP_SECRET is mandatory for control writes; device credentials never authorize this. Login and TOTP attempts are rate limited durably.

- `GET /api/control/devices` → `{devices,configured,unlocked}`. Device rows: `{deviceId,deviceName,windowsSid,revoked,policy,status}`; policy is above; status is latest sync plus `lastSeenAt`, or null. Owned legacy device labels can appear only after explicit enrollment.
- `PUT /api/control/devices/{id}/policy` body `{expectedRevision,mode,timeZone,dailyLimitSeconds,budgetBasis,allowedWindows,effectiveAtUtc?:ISO}` → `{policy}`. Compare-and-swap revision; 409 on concurrent edit. Preserve grants/override. Server supplies identity/revision/timestamps. Effective time defaults to immediate; allow up to 15 minutes in the future, normalizing a recent past timestamp (up to 30 seconds) to issuance time. Existing rules continue while a revision is pending; grants/overrides preserve that pending activation rather than starting new base rules early.
- `POST /api/control/devices/{id}/grant` body `{expectedRevision,minutes,idempotencyKey:UUID}` → `{policy}`. Grant current policy timezone date, expire at next policy midnight. Retry same key must not grant twice.
- `POST /api/control/devices/{id}/override` body `{expectedRevision,untilUtc,ignoreBudget,ignoreSchedule,idempotencyKey:UUID}` → `{policy}`. Limit override to 24 hours; requires explicit rule selection.
- `POST /api/control/devices/{id}/shutdown` body `{expectedRevision,shutdown:boolean}` → `{policy}`. `true` starts a 30-second cutoff countdown and remains authoritative until a parent sends `false`. The action requires the same parent step-up and same-origin checks as all control writes.
- `POST /api/control/devices/{id}/revoke` → `{ok:true}`. Revokes cloud identity, NOT local cached rules; explain local recovery before revoke.

Every parent mutation is household-scoped and audited. New control tables are installed by explicit versioned SQL migration, not schema mutation on every request. No production migration/deployment is performed by writing this code.

## Service / tray IPC

Named pipe `ScreenTime.Control.v1`, local only, bounded newline-delimited JSON. Server authenticates pipe client via impersonation and token SID/session. Only enrolled child SID may send `{"type":"observe","state":"active|media|idle|locked","sequence":N}`. Service uses its own receipt time, monotonic elapsed time, and verified Windows session state; never accepts a claimed duration. Response `{"state":"allowed|warning|countdown|blocked|monitoring|error","remainingSeconds":N|null,"reason":"...","warningSeconds":300|60|1..30|null}`. No cloud keys or policy-writing commands pass through the pipe. Sensor failures use conservative unlocked-session accounting and recovery; closing/pausing the tray never disables service rules.

## Machine installation contract

Service name `ScreenTime.Control`; exe `%ProgramFiles%\ScreenTime\Service\ScreenTime.Service.exe`; state root `%ProgramData%\ScreenTime\Control` writable only SYSTEM/Administrators. Config `service.json`: `{apiBaseUrl,deviceId,householdId,windowsSid,parentSid,credential,policyPublicKeyPem,restrictionGroupSid}`. Installer captures the current elevated parent's SID and refuses the same SID for the child. Restriction group `ScreenTimeRestricted` is created once, owned by this installation, and receives only console/RDP deny rights. Service and recovery verify its stored SID. Installer defaults to monitor; managed mode rejects an administrative child account. Recovery stops/disables service, removes only child membership in that exact group, and leaves parent access untouched. Uninstall restores access before deleting service/state.
