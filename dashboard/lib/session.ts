export const sessionCookieName = "screen_time_session";
export const sessionLifetimeSeconds = 30 * 24 * 60 * 60;

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signature(expiresAt: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(expiresAt));
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

export async function createSessionToken(secret: string) {
  const expiresAt = String(Math.floor(Date.now() / 1000) + sessionLifetimeSeconds);
  return `${expiresAt}.${await signature(expiresAt, secret)}`;
}

export async function verifySessionToken(token: string | undefined, secret: string) {
  if (!token) return false;
  const [expiresAt, suppliedSignature, ...extra] = token.split(".");
  if (extra.length || !expiresAt || !suppliedSignature || !/^\d+$/.test(expiresAt)) return false;
  if (Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;
  const expectedSignature = await signature(expiresAt, secret);
  return constantTimeEqual(suppliedSignature, expectedSignature);
}

export function credentialsMatch(supplied: string, expected: string) {
  return constantTimeEqual(supplied, expected);
}
