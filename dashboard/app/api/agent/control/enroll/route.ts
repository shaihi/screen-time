import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  type ControlPolicy,
  controlPublicKey,
  deviceIdSchema,
  encryptCredential,
  hashControlValue,
  signControlEnvelope,
  windowsSidSchema,
} from "@/lib/control";
import { consumeControlRateLimit, redeemEnrollment } from "@/lib/control-store";
import {
  ControlHttpError,
  controlJson,
  controlRequestJson,
  controlRoute,
  requireControlHttps,
  requireControlReady,
} from "@/lib/parent-control";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return controlRoute(async () => {
    requireControlHttps(request);
    await requireControlReady();
    const body = z
      .object({
        token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        deviceId: deviceIdSchema,
        windowsSid: windowsSidSchema,
        deviceName: z.string().trim().min(1).max(120),
      })
      .strict()
      .parse(await controlRequestJson(request));
    if (!(await consumeControlRateLimit("enrollment-global", 60, 60)))
      throw new ControlHttpError(429, "Too many enrollment attempts");
    if (
      !(await consumeControlRateLimit(
        `enroll-token:${hashControlValue(body.token)}`,
        8,
        600,
      ))
    )
      throw new ControlHttpError(429, "Too many enrollment attempts");
    const credential = randomBytes(32).toString("base64"),
      now = new Date().toISOString();
    const policy: ControlPolicy = {
      schemaVersion: 1,
      householdId: "",
      deviceId: body.deviceId,
      windowsSid: body.windowsSid,
      revision: 1,
      issuedAtUtc: now,
      effectiveAtUtc: now,
      mode: "monitor",
      timeZone: process.env.DISPLAY_TIME_ZONE || "Asia/Jerusalem",
      dailyLimitSeconds: 7200,
      budgetBasis: "actual_use",
      allowedWindows: [],
      grants: [],
      override: null,
    };
    const enrolled = await redeemEnrollment(
      hashControlValue(body.token),
      body.deviceId,
      body.windowsSid,
      body.deviceName,
      encryptCredential(
        credential,
        body.deviceId,
        process.env.CONTROL_ENCRYPTION_KEY!,
      ),
      policy,
    );
    return controlJson({
      deviceId: body.deviceId,
      householdId: enrolled.householdId,
      windowsSid: body.windowsSid,
      credential,
      policyPublicKeyPem: controlPublicKey(
        process.env.CONTROL_POLICY_PRIVATE_KEY_PEM!,
      ),
      envelope: signControlEnvelope(
        enrolled,
        process.env.CONTROL_POLICY_PRIVATE_KEY_PEM!,
      ),
    });
  });
}
