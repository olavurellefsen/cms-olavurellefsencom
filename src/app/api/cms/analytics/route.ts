import type { NextRequest } from "next/server";
import { siteBinding } from "@/lib/cms/binding";

export const dynamic = "force-dynamic";

const analyticsDomain = "www.olavurellefsen.com";
const allowedMetrics = new Set(["overview", "timeseries", "pages", "sources", "current-visitors"]);
const allowedIntervals = new Set(["hour", "day", "week", "month"]);
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

type BrokerSession = {
  authorized?: boolean;
  capabilities?: { view?: boolean };
  signedIn?: boolean;
};

export async function GET(request: NextRequest) {
  const brokerSession = request.headers.get("x-usable-cms-session");
  if (!brokerSession) return errorResponse(401, "CMS authentication required");

  const siteOrigin = request.nextUrl.origin;
  const cmsOrigin = configuredOrigin(
    process.env.NEXT_PUBLIC_USABLE_CMS_ORIGIN,
    "https://cms.usable.dev",
  );
  const sessionUrl = new URL("/api/broker/session", cmsOrigin);
  sessionUrl.searchParams.set("site", siteBinding.siteId);
  sessionUrl.searchParams.set("token", siteBinding.integrationKey);
  sessionUrl.searchParams.set("origin", siteOrigin);

  let session: BrokerSession;
  try {
    const response = await fetch(sessionUrl, {
      headers: { "x-usable-cms-session": brokerSession },
      cache: "no-store",
    });
    if (!response.ok) return errorResponse(401, "CMS authentication expired");
    session = (await response.json()) as BrokerSession;
  } catch {
    return errorResponse(502, "CMS authentication could not be verified");
  }

  if (!session.signedIn || !session.authorized || !session.capabilities?.view) {
    return errorResponse(403, "CMS access required");
  }

  const apiKey = process.env.USABLE_WEB_ANALYTICS_API_KEY;
  if (!apiKey) return errorResponse(503, "Analytics is not configured");

  const metric = request.nextUrl.searchParams.get("metric") || "overview";
  if (!allowedMetrics.has(metric)) return errorResponse(400, "Unknown analytics metric");

  const upstream = new URL(
    "/api/stats/v1",
    configuredOrigin(process.env.USABLE_WEB_ANALYTICS_ORIGIN, "https://web-analytics.usable.dev"),
  );
  upstream.searchParams.set("domain", analyticsDomain);
  upstream.searchParams.set("metric", metric);

  for (const name of ["from", "to"] as const) {
    const value = request.nextUrl.searchParams.get(name);
    if (value) {
      if (!isoDate.test(value)) return errorResponse(400, `Invalid ${name} date`);
      upstream.searchParams.set(name, value);
    }
  }

  const interval = request.nextUrl.searchParams.get("interval");
  if (interval) {
    if (!allowedIntervals.has(interval)) return errorResponse(400, "Invalid analytics interval");
    upstream.searchParams.set("interval", interval);
  }

  try {
    const response = await fetch(upstream, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: {
        "cache-control": "no-store",
        "content-type": response.headers.get("content-type") || "application/json; charset=utf-8",
      },
    });
  } catch {
    return errorResponse(502, "Usable Web Analytics could not be reached");
  }
}

function configuredOrigin(value: string | undefined, fallback: string) {
  try {
    return new URL(value || fallback).origin;
  } catch {
    return new URL(fallback).origin;
  }
}

function errorResponse(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}
