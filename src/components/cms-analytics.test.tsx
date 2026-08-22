import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CmsAnalytics } from "./cms-analytics";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-13T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("CMS analytics", () => {
  it("renders private traffic metrics from the CMS proxy", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(init?.headers).toEqual({ "x-usable-cms-session": "bs1.test-session" });
      if (url.includes("metric=timeseries")) {
        return Response.json([
          { date: "2026-08-12", visitors: 4, pageviews: 5 },
          { date: "2026-08-13", visitors: 8, pageviews: 11 },
        ]);
      }
      if (url.includes("metric=pages")) {
        return Response.json([{ path: "/writing", visitors: 9, pageviews: 12 }]);
      }
      if (url.includes("metric=sources")) {
        return Response.json([{ source: "google.com", visitors: 7, pageviews: 8 }]);
      }
      if (url.includes("metric=current-visitors")) return Response.json({ visitors: 2 });
      return Response.json({ visitors: 35, pageviews: 77, bounceRate: 0.42, avgDuration: 61 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CmsAnalytics sessionToken="bs1.test-session" />);

    expect(await screen.findByText("35")).toBeInTheDocument();
    expect(screen.getByText("77")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText("/writing")).toBeInTheDocument();
    expect(screen.getByText("google.com")).toBeInTheDocument();
    expect(screen.getByLabelText("Daily visitors chart")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
  });

  it("does not request analytics without an editor session", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<CmsAnalytics />);

    expect(
      await screen.findByText("Sign in to Usable CMS again to load analytics."),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
