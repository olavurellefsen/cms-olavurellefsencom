import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const replayTarget = umbracoReplayTarget(request);
  const gatewayUrl = umbracoGatewayUrl(request);
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-forwarded-host", request.headers.get("host") || request.nextUrl.host);
  forwardedHeaders.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""));
  const response = replayTarget
    ? new NextResponse(null, { status: 307, headers: { "fly-replay": `app=${replayTarget}` } })
    : gatewayUrl
      ? NextResponse.rewrite(gatewayUrl, { request: { headers: forwardedHeaders } })
      : NextResponse.next();
  const isUmbracoBridge = request.nextUrl.pathname === "/cms/umbraco-bridge";
  const isCmsRequest =
    Boolean(replayTarget || gatewayUrl) ||
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

export function umbracoReplayTarget(request: NextRequest) {
  if (!isUmbracoGatewayPath(request.nextUrl.pathname)) return null;
  const app = process.env.UMBRACO_GATEWAY_APP?.trim();
  return app && /^[a-z0-9][a-z0-9-]*$/.test(app) ? app : null;
}

export function umbracoGatewayUrl(request: NextRequest) {
  const origin = process.env.UMBRACO_GATEWAY_ORIGIN?.trim().replace(/\/$/, "");
  if (!origin || !isUmbracoGatewayPath(request.nextUrl.pathname)) return null;

  try {
    const upstream = new URL(origin);
    if (!isAllowedGatewayOrigin(upstream)) return null;
    upstream.pathname = request.nextUrl.pathname;
    upstream.search = request.nextUrl.search;
    return upstream;
  } catch {
    return null;
  }
}

export function isUmbracoGatewayPath(pathname: string) {
  return ["/umbraco", "/signin-usable", "/api/olavur-sync", "/App_Plugins/OlavurProjection"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isAllowedGatewayOrigin(url: URL) {
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" &&
      (url.hostname.endsWith(".internal") || ["localhost", "127.0.0.1"].includes(url.hostname)))
  );
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
