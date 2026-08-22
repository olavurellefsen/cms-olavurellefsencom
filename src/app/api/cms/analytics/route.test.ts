import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("CMS analytics proxy", () => {
  it("requires a CMS broker session", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new NextRequest("https://www.olavurellefsen.com/api/cms/analytics?metric=overview"),
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates CMS access before reading site-scoped analytics", async () => {
    vi.stubEnv("USABLE_WEB_ANALYTICS_API_KEY", "uwa_test_site_scoped");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          signedIn: true,
          authorized: true,
          capabilities: { view: true },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ visitors: 12, pageviews: 20, bounceRate: 0.4, avgDuration: 45 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new NextRequest(
        "https://www.olavurellefsen.com/api/cms/analytics?metric=overview&from=2026-08-01&to=2026-08-13",
        { headers: { "x-usable-cms-session": "bs1.test-session" } },
      ),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [sessionUrl, sessionOptions] = fetchMock.mock.calls[0];
    expect(String(sessionUrl)).toContain("https://cms.usable.dev/api/broker/session");
    expect(sessionOptions.headers).toEqual({ "x-usable-cms-session": "bs1.test-session" });
    const [analyticsUrl, analyticsOptions] = fetchMock.mock.calls[1];
    expect(String(analyticsUrl)).toContain("domain=www.olavurellefsen.com");
    expect(String(analyticsUrl)).toContain("metric=overview");
    expect(analyticsOptions.headers).toEqual({ Authorization: "Bearer uwa_test_site_scoped" });
  });

  it("does not disclose analytics to an unauthorized CMS session", async () => {
    vi.stubEnv("USABLE_WEB_ANALYTICS_API_KEY", "uwa_test_site_scoped");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ signedIn: true, authorized: false, capabilities: { view: false } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new NextRequest("https://www.olavurellefsen.com/api/cms/analytics?metric=overview", {
        headers: { "x-usable-cms-session": "bs1.unauthorized" },
      }),
    );

    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
