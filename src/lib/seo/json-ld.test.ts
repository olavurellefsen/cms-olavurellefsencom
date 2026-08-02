import { describe, expect, it } from "vitest";
import { safeJsonLd } from "./json-ld";

describe("safeJsonLd", () => {
  it("prevents a CMS string from closing the script element", () => {
    expect(safeJsonLd({ value: "</script><script>alert(1)</script>" })).not.toContain("<");
  });
});
