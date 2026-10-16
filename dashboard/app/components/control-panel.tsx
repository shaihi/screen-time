"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ControlDevice } from "@/lib/control";
import { clockLabel, dailySchedule, displayControlState, scheduleSummary, secondsLabel } from "@/lib/control-ui";

type DeviceList = { devices: ControlDevice[]; configured: boolean; unlocked: boolean };

class RequestFailure extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method, cache: "no-store", credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({ error: "Please sign in again and retry." }));
  if (!response.ok) throw new RequestFailure(data.error ?? "The request could not be completed.", response.status);
  return data as T;
}

export function ControlPanel({ defaultDeviceId }: { defaultDeviceId?: string }) {
  const [data, setData] = useState<DeviceList | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<{ token: string; expiresAtUtc: string } | null>(null);
  const [observedAt, setObservedAt] = useState(0);
  const pendingActions = useRef(new Map<string, Record<string, unknown>>());
  const refresh = useCallback(async () => {
    try { setData(await request<DeviceList>("/api/control/devices")); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not load controls."); }
    finally { setObservedAt(Date.now()); }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => { void refresh(); }, 0);
    const timer = setInterval(() => { void refresh(); }, 30_000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [refresh]);

  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); await refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : "Please retry."); await refresh(); }
    finally { setBusy(false); }
  }

  async function sendIdempotent(path: string, intent: string, body: Record<string, unknown>) {
    const key = `${path}:${intent}`;
    const saved = pendingActions.current.get(key) ?? { ...body, idempotencyKey: crypto.randomUUID() };
    pendingActions.current.set(key, saved);
    try {
      await request(path, "POST", saved);
      pendingActions.current.delete(key);
    } catch (error) {
      if (error instanceof RequestFailure && error.status >= 400 && error.status < 500) pendingActions.current.delete(key);
      throw error;
    }
  }

  return <div className="control-panel" id="screen-time-controls">
    <div className="panel-heading"><div><p className="eyebrow">PARENT CONTROLS</p><h2>When time is up, the PC stops</h2></div></div>
    <p className="panel-note">All apps stay available during allowed time. At the limit, Windows signs your child out and blocks sign-in. Save warnings appear before cutoff.</p>
    {error && <p role="alert" className="control-error">{error}</p>}
    {message && <p role="status" className="control-message">{message}</p>}
    {!data && !error && <p className="panel-note">Loading computer controls…</p>}
    {data && !data.configured && <p className="control-notice">Controls are not set up yet. Follow <strong>START-HERE.md</strong> in the repository. Monitoring continues as usual.</p>}
    {data?.configured && <>
      {!data.unlocked && <form className="control-unlock" onSubmit={(event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        void perform(async () => { await request("/api/control/unlock", "POST", { code: String(form.get("code")) }); setMessage("Parent controls unlocked for a short time."); });
      }}>
        <label htmlFor="control-code">Unlock changes with your authenticator code</label>
        <div className="control-inline"><input id="control-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required placeholder="6-digit code" /><button className="primary-button" disabled={busy}>Unlock controls</button></div>
      </form>}
      <div className="control-devices">
        {data.devices.map((device) => <DeviceEditor key={`${device.deviceId}:${device.policy.revision}`} device={device} observedAt={observedAt} disabled={busy || !data.unlocked} onAction={(action) => perform(action)} onIdempotent={sendIdempotent} onMessage={setMessage} />)}
        {!data.devices.length && <p className="panel-note">No computer is enrolled for control yet. Create a setup code below, then use it in the Windows installer.</p>}
      </div>
      <details className="control-enroll"><summary>Add a Windows computer</summary>
        <form onSubmit={(event) => {
          event.preventDefault(); const form = new FormData(event.currentTarget);
          void perform(async () => { setToken(await request("/api/control/enrollment-tokens", "POST", { deviceId: String(form.get("deviceId")) })); });
        }}>
          <label htmlFor="control-device-id">Computer label</label><input id="control-device-id" name="deviceId" defaultValue={defaultDeviceId ?? "family-pc"} pattern="[a-zA-Z0-9._-]{1,64}" required maxLength={64} />
          <button className="primary-button" disabled={busy || !data.unlocked}>Create one-use setup code</button>
        </form>
        {token && <div className="control-notice"><label htmlFor="enrollment-token">Paste this code only into your Windows installer</label><input id="enrollment-token" type="password" readOnly value={token.token} autoComplete="off" onFocus={(event) => event.currentTarget.select()} /><p>Expires at {new Date(token.expiresAtUtc).toLocaleTimeString()}. It works once. Keep it private.</p><button type="button" className="text-button" onClick={() => setToken(null)}>Hide setup code</button></div>}
      </details>
    </>}
  </div>;
}

function DeviceEditor({ device, observedAt, disabled, onAction, onIdempotent, onMessage }: {
  device: ControlDevice; observedAt: number; disabled: boolean;
  onAction: (action: () => Promise<void>) => Promise<void>; onMessage: (message: string) => void;
  onIdempotent: (path: string, intent: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const policy = device.policy;
  const [scheduleMode, setScheduleMode] = useState("keep");
  const [enableConfirmed, setEnableConfirmed] = useState(false);
  const [revokeConfirmed, setRevokeConfirmed] = useState(false);
  const [mode, setMode] = useState(policy.mode);
  const basePath = `/api/control/devices/${encodeURIComponent(device.deviceId)}`;
  const status = device.status;
  const stale = !status?.lastSeenAt || observedAt - Date.parse(status.lastSeenAt) > 120_000;
  const futureChange = Date.parse(policy.effectiveAtUtc) > observedAt;

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void onAction(async () => {
      const dailyMinutes = String(form.get("dailyMinutes"));
      const allowedWindows = scheduleMode === "keep" ? policy.allowedWindows : scheduleMode === "any" ? [] : dailySchedule(String(form.get("start")), String(form.get("end")));
      await request(`${basePath}/policy`, "PUT", {
        expectedRevision: policy.revision, mode: String(form.get("mode")), timeZone: String(form.get("timeZone")),
        effectiveAtUtc: new Date(Date.now() + Number(form.get("applyDelay")) * 1000).toISOString(),
        dailyLimitSeconds: dailyMinutes === "" ? null : Number(dailyMinutes) * 60,
        budgetBasis: String(form.get("budgetBasis")), allowedWindows,
      });
      onMessage("Rules saved. Waiting for the computer to receive and confirm them.");
    });
  }

  return <article className="control-device">
    <div className="control-device-heading"><div><h3>{device.deviceName || device.deviceId}</h3><small>{device.deviceId}</small></div><strong className="control-state">{device.revoked ? "Identity revoked" : displayControlState(status, policy.revision, observedAt)}</strong></div>
    <div className="control-stat-grid"><div><small>Last reported use{status ? ` · ${status.policyDay}` : ""}</small><strong>{status ? secondsLabel(status.usedSeconds) : "Waiting"}</strong></div><div><small>Last reported allowance left</small><strong>{status ? secondsLabel(status.remainingSeconds) : "Waiting"}</strong></div><div><small>Allowed hours</small><strong>{scheduleSummary(policy.allowedWindows)}</strong></div></div>
    {status && <p className="panel-note">Last contact: {status.lastSeenAt ? new Date(status.lastSeenAt).toLocaleString() : "Not received yet"}. {status.reason}{status.error ? ` · ${status.error}` : ""}</p>}
    {stale && <p className="control-notice">The computer is offline or has not checked in. Saved local rules continue; new changes wait for contact.</p>}
    {status && !status.sensorHealthy && <p className="control-notice">Activity detail is unavailable. The service uses conservative session-time accounting.</p>}
    <form onSubmit={save}>
      <fieldset disabled={disabled || device.revoked} className="control-fields">
        <label>Blocking<select name="mode" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="monitor">Watch only — no blocking</option><option value="managed">Enforce rules — sign out at cutoff</option></select></label>
        <label>Daily limit in minutes<input name="dailyMinutes" type="number" min={1} max={1440} step={1} defaultValue={policy.dailyLimitSeconds === null ? "" : policy.dailyLimitSeconds / 60} placeholder="Blank means no daily cap" /></label>
        <label>What counts<select name="budgetBasis" defaultValue={policy.budgetBasis}><option value="actual_use">Active use + watching</option><option value="unlocked_session">All unlocked session time</option></select></label>
        <label>Family time zone<input name="timeZone" defaultValue={policy.timeZone} required maxLength={100} placeholder="Asia/Jerusalem" /></label>
        <label>Apply these changes<select name="applyDelay" defaultValue="0"><option value="0">As soon as the computer receives them</option><option value="60">In one minute — time to save work</option><option value="300">In five minutes — time to save work</option></select></label>
        <label>Allowed hours<select value={scheduleMode} onChange={(event) => setScheduleMode(event.target.value)}><option value="keep">Keep: {scheduleSummary(policy.allowedWindows)}</option><option value="any">Any time of day</option><option value="daily">Same hours every day</option></select></label>
        {scheduleMode === "daily" && <div className="control-inline"><label>From<input name="start" type="time" required defaultValue={clockLabel(policy.allowedWindows[0]?.startMinute ?? 480)} /></label><label>Until<input name="end" type="time" required defaultValue={clockLabel(Math.min(policy.allowedWindows[0]?.endMinute ?? 1260, 1439))} /></label></div>}
        <label className="control-check"><input type="checkbox" required={mode === "managed"} checked={enableConfirmed} onChange={(event) => setEnableConfirmed(event.target.checked)} />I understand cutoff closes running apps. I have tested the parent recovery account.</label>
        <button className="primary-button" type="submit">Save screen-time rules</button>
      </fieldset>
    </form>
    {futureChange && <p className="control-notice">A rule change is scheduled for {new Date(policy.effectiveAtUtc).toLocaleTimeString()}. Existing rules continue until then. To grant access immediately, first save the rules with “As soon as the computer receives them.”</p>}
    <div className="control-inline control-grants">{[15, 30, 60].map((minutes) => <button key={minutes} type="button" className="text-button" disabled={disabled || device.revoked || futureChange} onClick={() => {
      void onAction(async () => { await onIdempotent(`${basePath}/grant`, String(minutes), { expectedRevision: policy.revision, minutes }); onMessage(`Added ${minutes} minutes for today. Bedtime still applies. Waiting for the computer to confirm.`); });
    }}>+{minutes} min today</button>)}</div>
    <details className="control-enroll"><summary>Temporary access or remove connection</summary>
      <form onSubmit={(event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        void onAction(async () => {
          const minutes = Number(form.get("minutes"));
          const ignoreSchedule = form.get("ignoreSchedule") === "on";
          await onIdempotent(`${basePath}/override`, `${minutes}:${ignoreSchedule}`, { expectedRevision: policy.revision, untilUtc: new Date(Date.now() + minutes * 60_000).toISOString(), ignoreBudget: true, ignoreSchedule });
          onMessage("Temporary access saved. Waiting for the computer to confirm.");
        });
      }}><fieldset disabled={disabled || device.revoked || futureChange} className="control-fields"><label>Allow access for minutes<input name="minutes" type="number" min={1} max={1440} defaultValue={30} required /></label><label className="control-check"><input name="ignoreSchedule" type="checkbox" />Also allow outside bedtime / allowed hours</label><button className="text-button">Allow temporarily</button></fieldset></form>
      <p className="panel-note">Removing the connection stops remote updates. It does not remove saved rules. Run the local recovery tool first.</p>
      <label className="control-check"><input type="checkbox" checked={revokeConfirmed} onChange={(event) => setRevokeConfirmed(event.target.checked)} />I have restored access using the local recovery tool.</label>
      <button type="button" className="text-button" disabled={disabled || device.revoked || !revokeConfirmed} onClick={() => { void onAction(async () => { await request(`${basePath}/revoke`, "POST", {}); onMessage("Remote connection removed. Use the local recovery tool to clear local rules if needed."); }); }}>Remove remote connection</button>
    </details>
  </article>;
}
