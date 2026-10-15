import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";

export type ControlWindow = {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
};
export type ControlPolicy = {
  schemaVersion: 1;
  householdId: string;
  deviceId: string;
  windowsSid: string;
  revision: number;
  issuedAtUtc: string;
  effectiveAtUtc: string;
  mode: "monitor" | "managed";
  timeZone: string;
  dailyLimitSeconds: number | null;
  budgetBasis: "actual_use" | "unlocked_session";
  allowedWindows: ControlWindow[];
  grants: { id: string; day: string; seconds: number; expiresAtUtc: string }[];
  override: {
    id: string;
    untilUtc: string;
    ignoreBudget: boolean;
    ignoreSchedule: boolean;
  } | null;
};
export type ControlStatus = {
  protocolVersion: 1;
  appliedRevision: number;
  state: "monitoring" | "allowed" | "warning" | "blocked" | "error";
  reason: string;
  usedSeconds: number;
  remainingSeconds: number | null;
  policyDay: string;
  sensorHealthy: boolean;
  agentVersion: string;
  error: string | null;
  lastSeenAt?: string;
};
export type ControlDevice = {
  deviceId: string;
  deviceName: string;
  windowsSid: string;
  revoked: boolean;
  policy: ControlPolicy;
  status: ControlStatus | null;
};
export const deviceIdSchema = z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/);
export const windowsSidSchema = z
  .string()
  .regex(/^S-1-5-21-\d+-\d+-\d+-\d+$/)
  .max(184);
const revisionSchema = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER - 1);
const idempotencySchema = z.string().uuid();
const zoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone");
const windowSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .strict()
  .refine(
    (value) => value.startMinute < value.endMinute,
    "Start must precede end; split overnight windows into two days",
  );
const editSchema = z
  .object({
    expectedRevision: revisionSchema,
    mode: z.enum(["monitor", "managed"]),
    timeZone: zoneSchema,
    dailyLimitSeconds: z.number().int().min(60).max(86400).nullable(),
    budgetBasis: z.enum(["actual_use", "unlocked_session"]),
    allowedWindows: z.array(windowSchema).max(100),
    effectiveAtUtc: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
const grantSchema = z
  .object({
    expectedRevision: revisionSchema,
    minutes: z.number().int().min(1).max(1440),
    idempotencyKey: idempotencySchema,
  })
  .strict();
const overrideSchema = z
  .object({
    expectedRevision: revisionSchema,
    untilUtc: z.iso.datetime({ offset: true }),
    ignoreBudget: z.boolean(),
    ignoreSchedule: z.boolean(),
    idempotencyKey: idempotencySchema,
  })
  .strict();
const syncSchema = z
  .object({
    protocolVersion: z.literal(1),
    appliedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    state: z.enum(["monitoring", "allowed", "warning", "blocked", "error"]),
    reason: z.string().max(500),
    usedSeconds: z
      .number()
      .int()
      .min(0)
      .max(31 * 86400),
    remainingSeconds: z
      .number()
      .int()
      .min(0)
      .max(31 * 86400)
      .nullable(),
    policyDay: z.iso.date(),
    sensorHealthy: z.boolean(),
    agentVersion: z.string().min(1).max(64),
    error: z.string().max(1000).nullable(),
  })
  .strict();
export function validatePolicyEdit(input: unknown, now = new Date()) {
  const value = editSchema
    .superRefine((data, context) => {
      if (data.effectiveAtUtc === undefined) return;
      const timestamp = Date.parse(data.effectiveAtUtc);
      if (
        timestamp < now.getTime() - 30_000 ||
        timestamp > now.getTime() + 15 * 60_000
      ) {
        context.addIssue({
          code: "custom",
          path: ["effectiveAtUtc"],
          message: "Choose activation now or within the next 15 minutes",
        });
      }
    })
    .parse(input);
  if (value.effectiveAtUtc !== undefined) {
    value.effectiveAtUtc = new Date(
      Math.max(now.getTime(), Date.parse(value.effectiveAtUtc)),
    ).toISOString();
  }
  return value;
}
export function validateGrant(input: unknown) {
  return grantSchema.parse(input);
}
export function validateOverride(input: unknown, now = new Date()) {
  const value = overrideSchema.parse(input);
  const expiry = Date.parse(value.untilUtc);
  if (
    expiry <= now.getTime() ||
    expiry > now.getTime() + 86400000 ||
    (!value.ignoreBudget && !value.ignoreSchedule)
  )
    throw new Error("Choose at least one rule and an expiry within 24 hours");
  return value;
}
export function validateSync(input: unknown): ControlStatus {
  return syncSchema.parse(input);
}
export function hashControlValue(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function encryptionKey(encoded: string) {
  const value = Buffer.from(encoded, "base64");
  if (value.length !== 32 || value.toString("base64") !== encoded)
    throw new Error(
      "CONTROL_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
    );
  return value;
}
export function encryptCredential(
  credential: string,
  deviceId: string,
  encodedKey: string,
) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(encodedKey), iv);
  cipher.setAAD(Buffer.from(deviceId));
  const encrypted = Buffer.concat([
    cipher.update(credential, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((value) => value.toString("base64"))
    .join(".");
}
export function decryptCredential(
  ciphertext: string,
  deviceId: string,
  encodedKey: string,
) {
  const parts = ciphertext.split(".");
  if (parts.length !== 3) throw new Error("Invalid encrypted credential");
  const [iv, tag, encrypted] = parts.map((value) =>
    Buffer.from(value, "base64"),
  );
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(encodedKey), iv);
  cipher.setAAD(Buffer.from(deviceId));
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString(
    "utf8",
  );
}
export function controlSigningKey(pem: string) {
  const key = createPrivateKey(pem.replace(/\\n/g, "\n"));
  if (
    key.asymmetricKeyType !== "rsa" ||
    (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
  )
    throw new Error("Control signing key must be RSA with at least 2048 bits");
  return key;
}
export function controlPublicKey(pem: string) {
  return createPublicKey(controlSigningKey(pem))
    .export({ type: "spki", format: "pem" })
    .toString();
}
export function signControlEnvelope(
  policy: unknown,
  pem: string,
  now = new Date(),
) {
  const bytes = Buffer.from(
    JSON.stringify({ policy, serverTimeUtc: now.toISOString() }),
    "utf8",
  );
  return {
    payload: bytes.toString("base64"),
    signature: sign("RSA-SHA256", bytes, controlSigningKey(pem)).toString(
      "base64",
    ),
  };
}
function equal(left: string, right: string) {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function verifyDeviceSignature(
  input: {
    deviceId: string;
    timestamp: string | null;
    nonce: string | null;
    signature: string | null;
    body: string;
  },
  credential: string,
  now = Date.now(),
) {
  const { deviceId, timestamp, nonce, signature, body } = input;
  if (
    !deviceIdSchema.safeParse(deviceId).success ||
    !timestamp ||
    !/^\d{1,12}$/.test(timestamp) ||
    !nonce ||
    !idempotencySchema.safeParse(nonce).success ||
    !signature ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    return false;
  const secret = Buffer.from(credential, "base64");
  if (secret.length !== 32) return false;
  const canonical = `v1\nPOST\n/api/agent/control/sync\n${deviceId}\n${timestamp}\n${nonce}\n${hashControlValue(body)}`;
  return equal(
    createHmac("sha256", secret).update(canonical, "utf8").digest("hex"),
    signature,
  );
}
function base32Decode(input: string) {
  const normalized = input.toUpperCase().replace(/=+$/, "");
  if (!/^[A-Z2-7]{16,128}$/.test(normalized))
    throw new Error(
      "CONTROL_PARENT_TOTP_SECRET must be base32, at least 16 characters",
    );
  let bits = 0,
    value = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    value = (value << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
export function totpCode(secret: string, now = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const digest = createHmac("sha1", base32Decode(secret))
    .update(counter)
    .digest();
  const offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}
export function verifyTotp(code: string, secret: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return false;
  try {
    return [-1, 0, 1].some((step) =>
      equal(code, totpCode(secret, now + step * 30000)),
    );
  } catch {
    return false;
  }
}
export const controlCookieName = "screen_time_control";
export const controlStepUpSeconds = 600;
export function createStepUpToken(
  householdId: string,
  session: string,
  key: string,
  now = Date.now(),
) {
  const payload = Buffer.from(
    JSON.stringify({
      householdId,
      session: hashControlValue(session),
      expiresAt: Math.floor(now / 1000) + controlStepUpSeconds,
    }),
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", encryptionKey(key)).update(`control-step-up-v1.${payload}`).digest("hex")}`;
}
export function verifyStepUpToken(
  token: string | undefined,
  householdId: string,
  session: string,
  key: string,
  now = Date.now(),
) {
  try {
    if (!token) return false;
    const [payload, signature, ...extra] = token.split(".");
    if (extra.length || !signature) return false;
    const expected = createHmac("sha256", encryptionKey(key))
      .update(`control-step-up-v1.${payload}`)
      .digest("hex");
    if (!equal(signature, expected)) return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return (
      data.householdId === householdId &&
      data.session === hashControlValue(session) &&
      data.expiresAt > now / 1000 &&
      data.expiresAt <= now / 1000 + controlStepUpSeconds
    );
  } catch {
    return false;
  }
}
export function validateControlConfiguration() {
  encryptionKey(process.env.CONTROL_ENCRYPTION_KEY ?? "");
  controlSigningKey(process.env.CONTROL_POLICY_PRIVATE_KEY_PEM ?? "");
  base32Decode(process.env.CONTROL_PARENT_TOTP_SECRET ?? "");
  if (!process.env.DATABASE_URL)
    throw new Error("Control database is not configured");
}
export function policyDayAndExpiry(timeZone: string, now = new Date()) {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const date = (time: number) => {
    const parts = format.formatToParts(time);
    return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}-${parts.find((p) => p.type === "day")!.value}`;
  };
  const day = date(now.getTime());
  let low = now.getTime(),
    high = low + 27 * 3600000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (date(middle) === day) low = middle;
    else high = middle;
  }
  return { day, expiresAtUtc: new Date(high).toISOString() };
}
