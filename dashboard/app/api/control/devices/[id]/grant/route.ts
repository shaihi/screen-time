import { randomUUID } from "node:crypto";
import {
  deviceIdSchema,
  hashControlValue,
  policyDayAndExpiry,
  validateGrant,
} from "@/lib/control";
import { changeControlPolicy, readControlDevice } from "@/lib/control-store";
import {
  ControlHttpError,
  controlJson,
  controlRequestJson,
  controlRoute,
  requireControlWrite,
} from "@/lib/parent-control";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return controlRoute(async () => {
    const parent = await requireControlWrite(request),
      deviceId = deviceIdSchema.parse((await context.params).id),
      body = validateGrant(await controlRequestJson(request));
    const device = await readControlDevice(parent.household.id, deviceId);
    if (!device || device.revoked)
      throw new ControlHttpError(404, "Enrolled device not found");
    const details = {
      id: randomUUID(),
      ...policyDayAndExpiry(device.policy.timeZone),
      seconds: body.minutes * 60,
    };
    return controlJson({
      policy: await changeControlPolicy(
        parent.household.id,
        deviceId,
        body.expectedRevision,
        "grant",
        details,
        body.idempotencyKey,
        hashControlValue(JSON.stringify(body)),
      ),
    });
  });
}
