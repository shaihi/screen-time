import { z } from "zod";

export type Household = {
  id: string;
  password: string;
  ingestSecret: string;
  deviceIds: string[];
};

// No "." -- it survives encodeURIComponent unescaped, which would let a dotted id
// collide with the session token's own "." field separator (see session.ts).
const householdSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  password: z.string().min(1),
  ingestSecret: z.string().min(32),
  // "*" is reserved for the legacy fallback household below; a configured household
  // must own an explicit device list, never a wildcard.
  deviceIds: z.array(z.string().trim().min(1).refine((id) => id !== "*", "deviceIds may not contain the wildcard \"*\"")).min(1),
});

let cached: Household[] | null | undefined;

/**
 * Multiple households share one Vercel deployment and one Neon database.
 * Isolation is enforced entirely at this layer: every household gets its own
 * login password, its own ingest HMAC secret, and an explicit list of the
 * device IDs it owns. A request is scoped to a household's devices before
 * any query runs -- there is no cross-household query path.
 *
 * Falls back to a single implicit "default" household built from the
 * legacy DASHBOARD_PASSWORD/INGEST_SECRET env vars (with access to every
 * device) when HOUSEHOLDS is unset, so existing single-household
 * deployments keep working without reconfiguring Vercel.
 */
export function getHouseholds(): Household[] {
  if (cached !== undefined) return cached ?? [];

  const raw = process.env.HOUSEHOLDS;
  if (raw) {
    let decoded: unknown;
    try { decoded = JSON.parse(raw); }
    catch (error) { throw new Error(`HOUSEHOLDS is invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
    const parsed = householdSchema.array().min(1).safeParse(decoded);
    if (!parsed.success) throw new Error(`HOUSEHOLDS is invalid: ${parsed.error.message}`);
    const ids = new Set<string>();
    const passwords = new Set<string>();
    const deviceOwners = new Set<string>();
    for (const household of parsed.data) {
      if (ids.has(household.id)) throw new Error(`HOUSEHOLDS has a duplicate id: ${household.id}`);
      ids.add(household.id);
      if (passwords.has(household.password)) {
        throw new Error(`HOUSEHOLDS has two households sharing the same password: ${household.id}`);
      }
      passwords.add(household.password);
      for (const deviceId of household.deviceIds) {
        if (deviceOwners.has(deviceId)) {
          throw new Error(`HOUSEHOLDS assigns device ${deviceId} to more than one household`);
        }
        deviceOwners.add(deviceId);
      }
    }
    cached = parsed.data;
    return cached;
  }

  // ingestSecret can be empty/short here -- login still works, only ingest signing
  // (which already rejects secrets under 32 chars) stays disabled until it's set.
  const legacyPassword = process.env.DASHBOARD_PASSWORD;
  if (legacyPassword) {
    cached = [{ id: "default", password: legacyPassword, ingestSecret: process.env.INGEST_SECRET ?? "", deviceIds: ["*"] }];
    return cached;
  }

  cached = null;
  return [];
}

export function findHouseholdByPassword(password: string): Household | null {
  for (const household of getHouseholds()) {
    if (constantTimeEqual(password, household.password.trim())) return household;
  }
  return null;
}

export function findHouseholdByDeviceId(deviceId: string): Household | null {
  for (const household of getHouseholds()) {
    if (household.deviceIds.includes("*") || household.deviceIds.includes(deviceId)) return household;
  }
  return null;
}

export function getHouseholdById(id: string): Household | null {
  return getHouseholds().find((household) => household.id === id) ?? null;
}

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}
