import { database, ensureSchema } from "@/lib/db";
import { parseRange } from "@/lib/range";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }

  const form = await request.formData();
  const action = form.get("action");
  const appName = String(form.get("appName") || "").trim();
  if ((action !== "hide" && action !== "show") || !appName || appName.length > 120) {
    return Response.json({ error: "Invalid settings request" }, { status: 400 });
  }

  await ensureSchema();
  const sql = database();
  if (action === "hide") {
    await sql`INSERT INTO excluded_apps (app_name) VALUES (${appName}) ON CONFLICT DO NOTHING`;
  } else {
    await sql`DELETE FROM excluded_apps WHERE app_name = ${appName}`;
  }

  const range = parseRange(form.get("range"));
  return Response.redirect(new URL(range === "day" ? "/" : `/?range=${range}`, request.url), 303);
}
