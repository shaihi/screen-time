import { deviceIdSchema } from "@/lib/control";
import { revokeControlDevice } from "@/lib/control-store";
import {
  controlJson,
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
    await revokeControlDevice(parent.household.id, deviceId);
    return controlJson({ ok: true });
  });
}
