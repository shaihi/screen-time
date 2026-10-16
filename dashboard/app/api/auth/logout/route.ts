import { NextResponse } from "next/server";
import { sessionCookieName } from "@/lib/session";
import { controlCookieName } from "@/lib/control";
import { authenticateControlParent, ControlHttpError, requireSameOrigin } from "@/lib/parent-control";
import { revokeControlParentSession } from "@/lib/control-store";

export async function POST(request: Request) {
  try { requireSameOrigin(request); }
  catch { return new Response("Same-origin request required", { status: 403 }); }
  if (process.env.CONTROL_PARENT_TOTP_SECRET) {
    try {
      const parent = await authenticateControlParent(request);
      await revokeControlParentSession(parent.household.id, parent.session);
    } catch (error) {
      if (!(error instanceof ControlHttpError && error.status === 401)) {
        return new Response("Could not revoke the parent session. Please retry sign-out when the database is available.", { status: 503 });
      }
    }
  }
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.set(sessionCookieName, "", { expires: new Date(0), path: "/" });
  response.cookies.set(controlCookieName, "", { expires: new Date(0), path: "/api/control" });
  return response;
}
