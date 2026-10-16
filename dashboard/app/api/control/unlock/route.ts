import { z } from "zod";
import {
  controlCookieName,
  controlStepUpSeconds,
  createStepUpToken,
  totpCode,
  verifyTotp,
} from "@/lib/control";
import {
  auditControl,
  consumeControlRateLimit,
  consumeControlTotp,
} from "@/lib/control-store";
import {
  authenticateControlParent,
  ControlHttpError,
  controlJson,
  controlRequestJson,
  controlRequestProtocol,
  controlRoute,
  requireControlReady,
  requireSameOrigin,
} from "@/lib/parent-control";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return controlRoute(async () => {
    requireSameOrigin(request);
    const parent = await authenticateControlParent(request);
    await requireControlReady();
    if (!(await consumeControlRateLimit(`totp:${parent.household.id}`, 5, 300)))
      throw new ControlHttpError(429, "Too many attempts. Wait five minutes.");
    const { code } = z
      .object({ code: z.string().regex(/^\d{6}$/) })
      .strict()
      .parse(await controlRequestJson(request));
    const now = Date.now(),
      secret = process.env.CONTROL_PARENT_TOTP_SECRET!;
    if (!verifyTotp(code, secret, now)) {
      await auditControl(parent.household.id, null, "unlock_failed");
      throw new ControlHttpError(401, "Incorrect authenticator code");
    }
    const counter = [-1, 0, 1]
      .map((offset) => Math.floor(now / 30000) + offset)
      .find((value) => totpCode(secret, value * 30000) === code)!;
    if (!(await consumeControlTotp(parent.household.id, counter)))
      throw new ControlHttpError(
        401,
        "That code was already used. Wait for the next code.",
      );
    await auditControl(parent.household.id, null, "controls_unlocked");
    const token = createStepUpToken(
      parent.household.id,
      parent.session,
      process.env.CONTROL_ENCRYPTION_KEY!,
      now,
    );
    return controlJson(
      {
        unlocked: true,
        expiresAtUtc: new Date(now + controlStepUpSeconds * 1000).toISOString(),
      },
      200,
      {
        "Set-Cookie": `${controlCookieName}=${token}; Path=/api/control; HttpOnly; SameSite=Strict; Max-Age=${controlStepUpSeconds}${controlRequestProtocol(request) === "https:" ? "; Secure" : ""}`,
      },
    );
  });
}
