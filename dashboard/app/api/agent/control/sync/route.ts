import {
  decryptCredential,
  deviceIdSchema,
  signControlEnvelope,
  validateSync,
  verifyDeviceSignature,
} from "@/lib/control";
import { controlIdentity, syncControlDevice } from "@/lib/control-store";
import {
  ControlHttpError,
  controlJson,
  controlRequestText,
  controlRoute,
  requireControlHttps,
  requireControlReady,
} from "@/lib/parent-control";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return controlRoute(async () => {
    requireControlHttps(request);
    await requireControlReady();
    const deviceId = request.headers.get("x-screen-time-device-id") ?? "";
    if (!deviceIdSchema.safeParse(deviceId).success)
      throw new ControlHttpError(401, "Unauthorized device");
    const body = await controlRequestText(request),
      encrypted = await controlIdentity(deviceId);
    if (!encrypted) throw new ControlHttpError(401, "Unauthorized device");
    const credential = decryptCredential(
        encrypted,
        deviceId,
        process.env.CONTROL_ENCRYPTION_KEY!,
      ),
      nonce = request.headers.get("x-screen-time-nonce");
    if (
      !verifyDeviceSignature(
        {
          deviceId,
          body,
          nonce,
          timestamp: request.headers.get("x-screen-time-timestamp"),
          signature: request.headers.get("x-screen-time-signature"),
        },
        credential,
      )
    )
      throw new ControlHttpError(
        401,
        "Unauthorized device or clock outside five-minute tolerance",
      );
    let decoded: unknown;
    try {
      decoded = JSON.parse(body);
    } catch {
      throw new ControlHttpError(400, "Invalid JSON request");
    }
    const status = validateSync(decoded),
      policy = await syncControlDevice(deviceId, encrypted, nonce!, status);
    return controlJson({
      envelope: signControlEnvelope(
        policy,
        process.env.CONTROL_POLICY_PRIVATE_KEY_PEM!,
      ),
    });
  });
}
