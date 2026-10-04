import { saveReminderMilestones } from "@/lib/db";
import { parseReminderMilestones } from "@/lib/reminder-policy";
import { householdIdHeader } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  const householdId = request.headers.get(householdIdHeader);
  if (!householdId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const form = await request.formData();
  try {
    await saveReminderMilestones(householdId, parseReminderMilestones(String(form.get("milestones") ?? "")));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid reminder settings" }, { status: 400 });
  }
  return Response.redirect(new URL("/", request.url), 303);
}
