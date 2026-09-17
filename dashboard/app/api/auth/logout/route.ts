import { NextResponse } from "next/server";
import { sessionCookieName } from "@/lib/session";

export function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.set(sessionCookieName, "", { expires: new Date(0), path: "/" });
  return response;
}
