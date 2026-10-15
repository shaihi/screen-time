import { randomBytes } from "node:crypto";
import { z } from "zod";
import { deviceIdSchema, hashControlValue } from "@/lib/control";
import {
  consumeControlRateLimit,
  createEnrollmentToken,
} from "@/lib/control-store";
import {
  ControlHttpError,
  controlJson,
  controlRequestJson,
  controlRoute,
  requireControlWrite,
} from "@/lib/parent-control";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return controlRoute(async () => {
    const parent = await requireControlWrite(request);
    const { deviceId } = z
      .object({ deviceId: deviceIdSchema })
      .strict()
      .parse(await controlRequestJson(request));
    if (
      !parent.household.deviceIds.includes("*") &&
      !parent.household.deviceIds.includes(deviceId)
    )
      throw new ControlHttpError(
        403,
        "Add this device ID to your household allowlist first",
      );
    if (
      !(await consumeControlRateLimit(
        `enrollment:${parent.household.id}`,
        10,
        600,
      ))
    )
      throw new ControlHttpError(
        429,
        "Too many enrollment tokens. Wait ten minutes.",
      );
    const token = randomBytes(32).toString("base64url"),
      expiresAtUtc = new Date(Date.now() + 600000).toISOString();
    await createEnrollmentToken(
      parent.household.id,
      deviceId,
      hashControlValue(token),
      expiresAtUtc,
    );
    return controlJson({ token, expiresAtUtc });
  });
}
