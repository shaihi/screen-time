import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName, verifySessionToken } from "@/lib/session";

export async function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname.startsWith("/api/auth/login") ||
    request.nextUrl.pathname.startsWith("/api/ingest") ||
    request.nextUrl.pathname.startsWith("/api/health")
  ) {
    return NextResponse.next();
  }

  const expectedUser = process.env.DASHBOARD_USER;
  const expectedPassword = process.env.DASHBOARD_PASSWORD;
  if (!expectedUser || !expectedPassword) {
    if (!process.env.VERCEL) return NextResponse.next();
    return new NextResponse("Dashboard authentication is not configured", { status: 503 });
  }

  const token = request.cookies.get(sessionCookieName)?.value;
  if (await verifySessionToken(token, expectedPassword)) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
