import { deviceIdSchema, validatePolicyEdit } from "@/lib/control";
import { changeControlPolicy } from "@/lib/control-store";
import {
  controlJson,
  controlRequestJson,
  controlRoute,
  requireControlWrite,
} from "@/lib/parent-control";
export const runtime = "nodejs";
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return controlRoute(async () => {
    const parent = await requireControlWrite(request),
      deviceId = deviceIdSchema.parse((await context.params).id),
      { expectedRevision, ...details } = validatePolicyEdit(
        await controlRequestJson(request),
      );
    return controlJson({
      policy: await changeControlPolicy(
        parent.household.id,
        deviceId,
        expectedRevision,
        "policy",
        details,
      ),
    });
  });
}
