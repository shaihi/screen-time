import { verifyIngestSignature } from "@/lib/auth";
import { getReminderMilestones } from "@/lib/db";
import { findHouseholdByDeviceId } from "@/lib/households";

export const runtime = "nodejs";

// The same HMAC credential used for ingest lets an installed agent read its reminder policy.
export async function GET(request: Request) {
  const deviceId = request.headers.get("x-screen-time-device-id")?.trim() ?? "";
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(deviceId)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!verifyIngestSignature(
    deviceId,
    request.headers.get("x-screen-time-timestamp"),
    request.headers.get("x-screen-time-signature"),
    "",
  )) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const household = findHouseholdByDeviceId(deviceId);
  if (!household) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ milestones: await getReminderMilestones(household.id) });
}
