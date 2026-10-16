import { deviceIdSchema, validateShutdown } from "@/lib/control";
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
    const parent = await requireControlWrite(request);
    const deviceId = deviceIdSchema.parse((await context.params).id);
    const body = validateShutdown(await controlRequestJson(request));
    const device = await readControlDevice(parent.household.id, deviceId);
    if (!device || device.revoked)
      throw new ControlHttpError(404, "Enrolled device not found");
    if (Date.parse(device.policy.effectiveAtUtc) > Date.now())
      throw new ControlHttpError(
        409,
        "Apply the scheduled rule change first, then retry shutdown.",
      );
    return controlJson({
      policy: await changeControlPolicy(
        parent.household.id,
        deviceId,
        body.expectedRevision,
        "policy",
        { shutdown: body.shutdown, effectiveAtUtc: new Date().toISOString() },
      ),
    });
  });
}
