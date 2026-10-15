import {
  controlCookieName,
  validateControlConfiguration,
  verifyStepUpToken,
} from "@/lib/control";
import { controlSchemaReady, listControlDevices } from "@/lib/control-store";
import {
  authenticateControlParent,
  controlJson,
  controlRoute,
  requestCookie,
} from "@/lib/parent-control";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return controlRoute(async () => {
    if (!process.env.DATABASE_URL)
      return controlJson({ devices: [], configured: false, unlocked: false });
    const parent = await authenticateControlParent(request);
    try {
      validateControlConfiguration();
    } catch {
      return controlJson({ devices: [], configured: false, unlocked: false });
    }
    if (!(await controlSchemaReady()))
      return controlJson({ devices: [], configured: false, unlocked: false });
    const unlocked = verifyStepUpToken(
      requestCookie(request, controlCookieName),
      parent.household.id,
      parent.session,
      process.env.CONTROL_ENCRYPTION_KEY!,
    );
    return controlJson({
      devices: await listControlDevices(parent.household.id),
      configured: true,
      unlocked,
    });
  });
}
