import { randomUUID } from "node:crypto";
import {
  deviceIdSchema,
  hashControlValue,
  validateOverride,
} from "@/lib/control";
import { changeControlPolicy } from "@/lib/control-store";
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
      deviceId = deviceIdSchema.parse((await context.params).id);
    let body: ReturnType<typeof validateOverride>;
    try {
      body = validateOverride(await controlRequestJson(request));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Choose at least"))
        throw new ControlHttpError(400, error.message);
      throw error;
    }
    const { expectedRevision, idempotencyKey, ...details } = body;
    return controlJson({
      policy: await changeControlPolicy(
        parent.household.id,
        deviceId,
        expectedRevision,
        "override",
        { id: randomUUID(), ...details },
        idempotencyKey,
        hashControlValue(JSON.stringify(body)),
      ),
    });
  });
}
