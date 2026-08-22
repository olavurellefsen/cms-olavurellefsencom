import { afterEach, describe, expect, it, vi } from "vitest";
import rawFallback from "../../../content/site.json";
import { fetchUmbracoSiteSnapshot } from "./umbraco";

describe("fetchUmbracoSiteSnapshot", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.UMBRACO_ORIGIN;
    delete process.env.UMBRACO_SYNC_API_KEY;
  });

  it("returns null when Umbraco is not configured", async () => {
    expect(await fetchUmbracoSiteSnapshot()).toBeNull();
  });

  it("validates the neutral site contract and keeps the API key server-side", async () => {
    process.env.UMBRACO_ORIGIN = "https://umbraco.example/";
    process.env.UMBRACO_SYNC_API_KEY = "secret";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => rawFallback });
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await fetchUmbracoSiteSnapshot();

    expect(snapshot?.pages.length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://umbraco.example/api/olavur-sync/export",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Olavur-Sync-Key": "secret" }),
        next: { revalidate: 60, tags: ["umbraco-site-content"] },
      }),
    );
  });

  it("rejects an invalid Umbraco payload", async () => {
    process.env.UMBRACO_ORIGIN = "https://umbraco.example";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    expect(await fetchUmbracoSiteSnapshot()).toBeNull();
  });
});
