import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bridgeFrameAncestors, proxy } from "./proxy";

afterEach(() => {
  vi.unstubAllEnvs();
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
