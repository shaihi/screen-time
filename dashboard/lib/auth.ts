import { createHmac, timingSafeEqual } from "node:crypto";
import { findHouseholdByDeviceId } from "@/lib/households";

const MAX_CLOCK_SKEW_SECONDS = 10 * 60;

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Verifies the request came from the device it claims to be, signed with
 * *that device's own household's* ingest secret -- so household A's secret
 * (recoverable from household A's installed agent binary) can never write
 * rows claiming to be household B's device, even though both post to the
 * same shared /api/ingest endpoint.
 */
export function verifyIngestSignature(
  deviceId: string,
  timestamp: string | null,
  signature: string | null,
  body: string,
) {
  const household = findHouseholdByDeviceId(deviceId);
  const secret = household?.ingestSecret;
  if (!secret || secret.length < 32 || !timestamp || !signature) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");
  return safeEqual(expected, signature.toLowerCase());
}

