import { describe, expect, it } from "vitest";
import { isCmsContentRequest } from "./request";

describe("CMS content requests", () => {
  it("recognizes editor and iframe preview requests", () => {
    expect(isCmsContentRequest({ cms: "1" })).toBe(true);
    expect(isCmsContentRequest({ "cms-preview": "1" })).toBe(true);
    expect(isCmsContentRequest({ "cms-preview": ["0", "1"] })).toBe(true);
  });

  it("keeps ordinary public requests cacheable", () => {
    expect(isCmsContentRequest(undefined)).toBe(false);
    expect(isCmsContentRequest({})).toBe(false);
    expect(isCmsContentRequest({ cms: "0" })).toBe(false);
  });
});
