export const sessionCookieName = "screen_time_session";
export const sessionLifetimeSeconds = 30 * 24 * 60 * 60;
// Set by proxy.ts after verifying the session, so route handlers and pages can
// trust it without re-verifying the cookie themselves.
export const householdIdHeader = "x-screen-time-household";

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signature(payload: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toHex(new Uint8Array(signed));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

// The household id rides in the token in plaintext (it's not secret) so verification
// knows which household's password to check the signature against.
function encodeHouseholdId(householdId: string) {
  return encodeURIComponent(householdId);
}

export async function createSessionToken(householdId: string, secret: string) {
  const expiresAt = String(Math.floor(Date.now() / 1000) + sessionLifetimeSeconds);
  const payload = `${encodeHouseholdId(householdId)}.${expiresAt}`;
  return `${payload}.${await signature(payload, secret)}`;
}

export async function verifySessionToken(
  token: string | undefined,
  lookupSecret: (householdId: string) => string | null,
): Promise<string | null> {
  if (!token) return null;
  const [encodedHouseholdId, expiresAt, suppliedSignature, ...extra] = token.split(".");
  if (extra.length || !encodedHouseholdId || !expiresAt || !suppliedSignature || !/^\d+$/.test(expiresAt)) {
    return null;
  }
  if (Number(expiresAt) <= Math.floor(Date.now() / 1000)) return null;

  const householdId = decodeURIComponent(encodedHouseholdId);
  const secret = lookupSecret(householdId);
  if (!secret) return null;

  const payload = `${encodedHouseholdId}.${expiresAt}`;
  const expectedSignature = await signature(payload, secret);
  return constantTimeEqual(suppliedSignature, expectedSignature) ? householdId : null;
}
