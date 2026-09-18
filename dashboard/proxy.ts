import { NextRequest, NextResponse } from "next/server";
import { getHouseholds } from "@/lib/households";
import { householdIdHeader, sessionCookieName, verifySessionToken } from "@/lib/session";

export async function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname.startsWith("/api/auth/login") ||
    request.nextUrl.pathname.startsWith("/api/ingest") ||
    request.nextUrl.pathname.startsWith("/api/health")
  ) {
    return NextResponse.next();
  }

  const households = getHouseholds();
  if (households.length === 0) {
    if (!process.env.VERCEL) return NextResponse.next();
    return new NextResponse("Dashboard authentication is not configured", { status: 503 });
  }

  const token = request.cookies.get(sessionCookieName)?.value;
  const householdId = await verifySessionToken(
    token,
    (id) => households.find((household) => household.id === id)?.password ?? null,
  );
  if (householdId) {
    const headers = new Headers(request.headers);
    headers.set(householdIdHeader, householdId);
    return NextResponse.next({ request: { headers } });
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
