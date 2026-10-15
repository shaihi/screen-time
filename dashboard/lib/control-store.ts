import { neon } from "@neondatabase/serverless";
import {
  hashControlValue,
  type ControlDevice,
  type ControlPolicy,
  type ControlStatus,
} from "./control.ts";

function sqlClient() {
  if (!process.env.DATABASE_URL)
    throw new Error("Control database is not configured");
  return neon(process.env.DATABASE_URL);
}
export async function controlSchemaReady() {
  if (!process.env.DATABASE_URL) return false;
  const sql = sqlClient();
  const [row] =
    await sql`SELECT to_regclass('public.control_schema_migrations') IS NOT NULL AS ready`;
  if (!row?.ready) return false;
  const versions =
    await sql`SELECT version FROM control_schema_migrations WHERE version=1`;
  return versions.length === 1;
}
export async function consumeControlRateLimit(
  bucket: string,
  limit: number,
  seconds: number,
) {
  const sql = sqlClient();
  const [row] =
    await sql`SELECT control_consume_rate_limit(${hashControlValue(bucket)},${limit},${seconds}) AS accepted`;
  return row.accepted === true;
}
export async function consumeControlTotp(householdId: string, counter: number) {
  const sql = sqlClient();
  const [row] =
    await sql`SELECT control_consume_totp(${householdId},${counter}) AS accepted`;
  return row.accepted === true;
}
export async function auditControl(
  householdId: string,
  deviceId: string | null,
  action: string,
  detail: Record<string, unknown> = {},
) {
  const sql = sqlClient();
  await sql`INSERT INTO control_audit_events(household_id,device_id,action,detail) VALUES(${householdId},${deviceId},${action},${JSON.stringify(detail)}::jsonb)`;
}
export async function listControlDevices(
  householdId: string,
): Promise<ControlDevice[]> {
  const sql = sqlClient();
  const rows =
    await sql`SELECT d.device_id,d.device_name,d.windows_sid,d.revoked_at,d.status,d.last_seen_at,p.policy FROM control_devices d JOIN control_policy_revisions p ON p.household_id=d.household_id AND p.device_id=d.device_id AND p.revision=d.current_revision WHERE d.household_id=${householdId} ORDER BY d.device_name,d.device_id`;
  return rows.map((row) => ({
    deviceId: String(row.device_id),
    deviceName: String(row.device_name),
    windowsSid: String(row.windows_sid),
    revoked: !!row.revoked_at,
    policy: row.policy as ControlPolicy,
    status: row.status
      ? { ...row.status, lastSeenAt: new Date(row.last_seen_at).toISOString() }
      : null,
  }));
}
export async function readControlDevice(householdId: string, deviceId: string) {
  const devices = await listControlDevices(householdId);
  return devices.find((device) => device.deviceId === deviceId) ?? null;
}
export async function createEnrollmentToken(
  householdId: string,
  deviceId: string,
  tokenHash: string,
  expiresAtUtc: string,
) {
  const sql = sqlClient();
  const rows =
    await sql`WITH saved AS (INSERT INTO control_enrollment_tokens(token_hash,household_id,device_id,expires_at) SELECT ${tokenHash},${householdId},${deviceId},${expiresAtUtc}::timestamptz WHERE NOT EXISTS(SELECT 1 FROM control_devices WHERE device_id=${deviceId}) RETURNING household_id,device_id) INSERT INTO control_audit_events(household_id,device_id,action) SELECT household_id,device_id,'enrollment_token_created' FROM saved RETURNING id`;
  if (!rows.length) throw new Error("CONTROL_ALREADY_ENROLLED");
}
export async function redeemEnrollment(
  tokenHash: string,
  deviceId: string,
  sid: string,
  name: string,
  encrypted: string,
  policy: ControlPolicy,
): Promise<ControlPolicy> {
  const sql = sqlClient();
  const [row] =
    await sql`SELECT control_redeem_enrollment(${tokenHash},${deviceId},${sid},${name},${encrypted},${JSON.stringify(policy)}::jsonb) AS policy`;
  return row.policy as ControlPolicy;
}
export async function changeControlPolicy(
  householdId: string,
  deviceId: string,
  expectedRevision: number,
  kind: "policy" | "grant" | "override",
  details: unknown,
  idempotencyKey: string | null = null,
  requestHash: string | null = null,
): Promise<ControlPolicy> {
  const sql = sqlClient();
  const [row] =
    await sql`SELECT control_change_policy(${householdId},${deviceId},${expectedRevision},${kind},${JSON.stringify(details)}::jsonb,${idempotencyKey}::uuid,${requestHash}) AS policy`;
  return row.policy as ControlPolicy;
}
export async function controlIdentity(deviceId: string) {
  const sql = sqlClient();
  const [row] =
    await sql`SELECT credential_encrypted FROM control_devices WHERE device_id=${deviceId} AND revoked_at IS NULL`;
  return row ? String(row.credential_encrypted) : null;
}
export async function syncControlDevice(
  deviceId: string,
  encrypted: string,
  nonce: string,
  status: ControlStatus,
): Promise<ControlPolicy> {
  const sql = sqlClient();
  const [row] =
    await sql`SELECT control_sync_device(${deviceId},${encrypted},${nonce}::uuid,${JSON.stringify(status)}::jsonb) AS policy`;
  return row.policy as ControlPolicy;
}
export async function revokeControlDevice(
  householdId: string,
  deviceId: string,
) {
  const sql = sqlClient();
  await sql`SELECT control_revoke_device(${householdId},${deviceId})`;
}

export async function registerControlParentSession(
  householdId: string,
  token: string,
  expiresAtUtc: string,
) {
  const sql = sqlClient();
  await sql`SELECT control_register_parent_session(${householdId},${hashControlValue(token)},${expiresAtUtc}::timestamptz)`;
}
export async function revokeControlParentSession(
  householdId: string,
  token: string,
) {
  const sql = sqlClient();
  await sql`SELECT control_revoke_parent_session(${householdId},${hashControlValue(token)})`;
}
export async function isControlParentSessionActive(
  householdId: string,
  token: string,
) {
  const sql = sqlClient();
  const [row] =
    await sql`SELECT control_parent_session_active(${householdId},${hashControlValue(token)}) AS active`;
  return row.active === true;
}
