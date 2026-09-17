import { NextResponse } from "next/server";
import { createSessionToken, credentialsMatch, sessionCookieName, sessionLifetimeSeconds } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }

  const expectedPassword = process.env.DASHBOARD_PASSWORD;
  if (!expectedPassword) return new Response("Authentication is not configured", { status: 503 });

  const form = await request.formData();
  const password = String(form.get("password") || "").trim();
  if (!credentialsMatch(password, expectedPassword.trim())) {
    return NextResponse.redirect(new URL("/login?error=1", request.url), 303);
  }

  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set(sessionCookieName, await createSessionToken(expectedPassword), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: sessionLifetimeSeconds,
  });
  return response;
}
