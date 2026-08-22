import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const isCmsRequest =
    request.nextUrl.pathname === "/cms" ||
    request.nextUrl.pathname.startsWith("/cms/") ||
    request.nextUrl.searchParams.has("cms");

  if (isCmsRequest) {
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.png).*)"],
};
