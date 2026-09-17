import { z } from "zod";
import { verifyIngestSignature } from "@/lib/auth";
import { database, ensureSchema } from "@/lib/db";
import { activityStates } from "@/lib/types";

export const runtime = "nodejs";

const payloadSchema = z.object({
  batchId: z.string().uuid(),
  deviceId: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9._-]+$/),
  samples: z.array(z.object({
    startedAt: z.string().datetime({ offset: true }),
    durationSeconds: z.number().int().min(1).max(3600),
    state: z.enum(activityStates),
    appName: z.string().trim().max(120).nullable().optional(),
  })).min(1).max(500),
});

export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > 256_000) return Response.json({ error: "Payload too large" }, { status: 413 });

  if (!verifyIngestSignature(
    request.headers.get("x-screen-time-timestamp"),
    request.headers.get("x-screen-time-signature"),
    body,
  )) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let decoded: unknown;
  try { decoded = JSON.parse(body); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = payloadSchema.safeParse(decoded);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  await ensureSchema();
  const sql = database();
  // Agents send running totals for the unfinished minute and again once it completes,
  // so keep the largest value per minute/state/app instead of adding them up.
  const { batchId, deviceId, samples } = parsed.data;
  await sql`
    INSERT INTO activity_segments (batch_id, device_id, started_at, duration_seconds, state, app_name)
    SELECT
      ${batchId}::uuid,
      ${deviceId},
      x."startedAt"::timestamptz,
      MAX(x."durationSeconds")::integer,
      x.state,
      NULLIF(x."appName", '')
    FROM jsonb_to_recordset(${JSON.stringify(samples)}::jsonb)
      AS x("startedAt" text, "durationSeconds" integer, state text, "appName" text)
    GROUP BY x."startedAt"::timestamptz, x.state, NULLIF(x."appName", '')
    ON CONFLICT (device_id, started_at, state, (COALESCE(app_name, ''))) DO UPDATE
      SET duration_seconds = GREATEST(activity_segments.duration_seconds, EXCLUDED.duration_seconds),
        received_at = NOW()
  `;

  return Response.json({ accepted: samples.length });
}
