import { describe, expect, it } from "vitest";
import { parseFragmentContent } from "./load";
import { articleContentSchema } from "./schema";

describe("article schema", () => {
  it("rejects draft content without a stable slug", () => {
    const result = articleContentSchema.safeParse({
      type: "article",
      title: "Draft",
      slug: "Not Stable",
      summary: "Draft summary",
      publishedAt: "2026-08-02",
      status: "draft",
      topics: [],
      canonicalUrl: "https://www.olavurellefsen.com/writing/draft",
      bodyMarkdown: "Draft body",
    });
    expect(result.success).toBe(false);
  });
});

describe("CMS fragment parsing", () => {
  it("accepts setup frontmatter and fenced JSON", () => {
    expect(
      parseFragmentContent('---\nkind: cms-page\n---\n```json\n{"type":"article"}\n```'),
    ).toEqual({ type: "article" });
  });
});
