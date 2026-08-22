import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const isUmbracoBridge = request.nextUrl.pathname === "/cms/umbraco-bridge";
  const isCmsRequest =
    request.nextUrl.pathname === "/cms" ||
    request.nextUrl.pathname.startsWith("/cms/") ||
    request.nextUrl.searchParams.has("cms");

  if (isCmsRequest) {
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }

  if (isUmbracoBridge) {
    response.headers.set("Content-Security-Policy", bridgeFrameAncestors());
  } else {
    response.headers.set("X-Frame-Options", "SAMEORIGIN");
  }

  return response;
}

export function bridgeFrameAncestors() {
  const origins = new Set(["'self'"]);
  const configured = process.env.UMBRACO_BACKOFFICE_ORIGIN || process.env.UMBRACO_ORIGIN || "";
  if (configured) {
    try {
      const url = new URL(configured);
      const deliberateLocalOrigin =
        url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
      if (url.protocol === "https:" || deliberateLocalOrigin) origins.add(url.origin);
    } catch {
      // An invalid configured origin stays closed rather than broadening framing access.
    }
  }
  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:5099");
    origins.add("http://127.0.0.1:5099");
  }
  return `frame-ancestors ${[...origins].join(" ")}`;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.png).*)"],
};
