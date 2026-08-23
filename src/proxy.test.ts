import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bridgeFrameAncestors,
  isUmbracoGatewayPath,
  proxy,
  umbracoGatewayUrl,
  umbracoReplayTarget,
} from "./proxy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("canonical Umbraco gateway", () => {
  it.each([
    "/umbraco",
    "/umbraco/section/content",
    "/signin-usable",
    "/api/olavur-sync/cms-session",
    "/App_Plugins/OlavurProjection/umbraco-package.json",
  ])("routes %s to the Umbraco runtime", (pathname) => {
    expect(isUmbracoGatewayPath(pathname)).toBe(true);
  });

  it.each(["/", "/about", "/api/cms/manifest", "/cms/umbraco-bridge"])(
    "keeps %s on the public runtime",
    (pathname) => {
      expect(isUmbracoGatewayPath(pathname)).toBe(false);
    },
  );

  it("preserves path and query while keeping the response private", () => {
    vi.stubEnv("UMBRACO_GATEWAY_ORIGIN", "http://olavurellefsen-umbraco.internal:8080");
    const request = new NextRequest(
      "https://www.olavurellefsen.com/umbraco/section/content?returnPath=%2Fumbraco",
    );
    const response = proxy(request);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://olavurellefsen-umbraco.internal:8080/umbraco/section/content?returnPath=%2Fumbraco",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("uses Fly's cross-app replay in production instead of relaying through Next", () => {
    vi.stubEnv("UMBRACO_GATEWAY_APP", "olavurellefsen-umbraco");
    vi.stubEnv("UMBRACO_GATEWAY_ORIGIN", "https://fallback.example.test");
    const request = new NextRequest("https://www.olavurellefsen.com/umbraco");
    const response = proxy(request);

    expect(umbracoReplayTarget(request)).toBe("olavurellefsen-umbraco");
    expect(response.status).toBe(307);
    expect(response.headers.get("fly-replay")).toBe("app=olavurellefsen-umbraco");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("rejects an invalid Fly app name", () => {
    vi.stubEnv("UMBRACO_GATEWAY_APP", "other-app;region=any");
    const request = new NextRequest("https://www.olavurellefsen.com/umbraco");

    expect(umbracoReplayTarget(request)).toBeNull();
  });

  it("fails closed for an unsafe upstream", () => {
    vi.stubEnv("UMBRACO_GATEWAY_ORIGIN", "http://public.example.test");
    const request = new NextRequest("https://www.olavurellefsen.com/umbraco");

    expect(umbracoGatewayUrl(request)).toBeNull();
    expect(proxy(request).headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("editor framing policy", () => {
  it("keeps ordinary routes same-origin only", () => {
    const response = proxy(new NextRequest("https://www.olavurellefsen.com/about?cms=1"));

    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  it("allows the bridge only from the configured production backoffice", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UMBRACO_BACKOFFICE_ORIGIN", "https://olavurellefsen-umbraco.fly.dev");
    const response = proxy(new NextRequest("https://www.olavurellefsen.com/cms/umbraco-bridge"));

    expect(response.headers.get("x-frame-options")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBe(
      "frame-ancestors 'self' https://olavurellefsen-umbraco.fly.dev",
    );
  });

  it("fails closed when the configured parent is invalid", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UMBRACO_BACKOFFICE_ORIGIN", "not-an-origin");

    expect(bridgeFrameAncestors()).toBe("frame-ancestors 'self'");
  });
});
