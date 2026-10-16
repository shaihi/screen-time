import { NextResponse } from "next/server";
import { findHouseholdByPassword, getHouseholds } from "@/lib/households";
import { createSessionToken, sessionCookieName, sessionLifetimeSeconds } from "@/lib/session";
import { consumeControlRateLimit, controlSchemaReady, registerControlParentSession } from "@/lib/control-store";
import { requireSameOrigin } from "@/lib/parent-control";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try { requireSameOrigin(request); }
  catch {
    return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }

  if (getHouseholds().length === 0) return new Response("Authentication is not configured", { status: 503 });

  const controlsEnabled = !!process.env.CONTROL_PARENT_TOTP_SECRET;
  if (controlsEnabled) {
    try {
      if (!await controlSchemaReady()) return new Response("Finish the control database setup before signing in.", { status: 503 });
      if (!await consumeControlRateLimit("parent-login-global", 100, 300)) {
        return new Response("Too many sign-in attempts. Please wait five minutes.", { status: 429, headers: { "Retry-After": "300" } });
      }
      const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
      if (!await consumeControlRateLimit(`parent-login:${address}`, 15, 300)) {
        return new Response("Too many attempts. Please wait five minutes.", { status: 429, headers: { "Retry-After": "300" } });
      }
    } catch { return new Response("Sign-in is temporarily unavailable. Please retry.", { status: 503 }); }
  }

  const form = await request.formData();
  const password = String(form.get("password") || "").trim();
  const household = findHouseholdByPassword(password);
  if (!household) {
    return NextResponse.redirect(new URL("/login?error=1", request.url), 303);
  }

  const token = await createSessionToken(household.id, household.password);
  if (controlsEnabled) {
    try { await registerControlParentSession(household.id, token, new Date(Date.now() + sessionLifetimeSeconds * 1000).toISOString()); }
    catch { return new Response("Sign-in is temporarily unavailable. Please retry.", { status: 503 }); }
  }
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set(sessionCookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: sessionLifetimeSeconds,
  });
  return response;
}
