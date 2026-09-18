import { database, ensureSchema } from "@/lib/db";
import { parseRange } from "@/lib/range";
import { householdIdHeader } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }

  // Set by proxy.ts after verifying the session; proxy.ts gates this route, so an
  // unauthenticated request never reaches here without it.
  const householdId = request.headers.get(householdIdHeader);
  if (!householdId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const form = await request.formData();
  const action = form.get("action");
  const appName = String(form.get("appName") || "").trim();
  if ((action !== "hide" && action !== "show") || !appName || appName.length > 120) {
    return Response.json({ error: "Invalid settings request" }, { status: 400 });
  }

  await ensureSchema();
  const sql = database();
  if (action === "hide") {
    await sql`INSERT INTO excluded_apps (household_id, app_name) VALUES (${householdId}, ${appName}) ON CONFLICT DO NOTHING`;
  } else {
    await sql`DELETE FROM excluded_apps WHERE household_id = ${householdId} AND app_name = ${appName}`;
  }

  const range = parseRange(form.get("range"));
  return Response.redirect(new URL(range === "day" ? "/" : `/?range=${range}`, request.url), 303);
}
