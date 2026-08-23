import { describe, expect, it, vi } from "vitest";
import { requestFederatedCmsSession } from "./backoffice-request.js";

describe("authenticated Umbraco backoffice requests", () => {
  it("uses the latest backoffice bearer token for the session bootstrap", async () => {
    const authContextToken = Symbol("UMB_AUTH_CONTEXT");
    const getLatestToken = vi.fn().mockResolvedValue("backoffice-token");
    const host = {
      getContext: vi.fn().mockResolvedValue({ getLatestToken }),
    };
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await requestFederatedCmsSession(host, authContextToken, fetchImplementation);

    expect(host.getContext).toHaveBeenCalledWith(authContextToken);
    expect(getLatestToken).toHaveBeenCalledOnce();
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, request] = fetchImplementation.mock.calls[0];
    expect(url).toBe("/api/olavur-sync/cms-session");
    expect(request).toMatchObject({
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
    });
    const headers = new Headers(request.headers);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer backoffice-token");
  });

  it("does not call the endpoint without an authenticated backoffice token", async () => {
    const fetchImplementation = vi.fn();
    const host = {
      getContext: vi.fn().mockResolvedValue({
        getLatestToken: vi.fn().mockResolvedValue(undefined),
      }),
    };

    await expect(
      requestFederatedCmsSession(host, Symbol("UMB_AUTH_CONTEXT"), fetchImplementation),
    ).rejects.toThrow("The Umbraco backoffice session is not available.");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
