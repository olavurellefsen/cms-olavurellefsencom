import { describe, expect, it } from "vitest";
import { pageIdFromTags, parseFragmentContent } from "./load";
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

  it("accepts a draft without a publication date", () => {
    const result = articleContentSchema.safeParse({
      type: "article",
      title: "Draft",
      slug: "draft",
      summary: "Draft summary",
      publishedAt: "",
      status: "draft",
      topics: [],
      canonicalUrl: "https://www.olavurellefsen.com/writing/draft",
      bodyMarkdown: "Draft body",
    });
    expect(result.success).toBe(true);
  });

  it("normalizes an Umbraco null publication date for drafts", () => {
    const result = articleContentSchema.safeParse({
      type: "article",
      title: "Draft",
      slug: "draft",
      summary: "Draft summary",
      publishedAt: null,
      status: "draft",
      topics: [],
      canonicalUrl: "https://www.olavurellefsen.com/writing/draft",
      bodyMarkdown: "Draft body",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.publishedAt).toBe("");
  });

  it("rejects a published article without a publication date", () => {
    const result = articleContentSchema.safeParse({
      type: "article",
      title: "Published",
      slug: "published",
      summary: "Published summary",
      publishedAt: "",
      status: "published",
      topics: [],
      canonicalUrl: "https://www.olavurellefsen.com/writing/published",
      bodyMarkdown: "Published body",
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

  it("resolves page ids from legacy and current CMS identity tags", () => {
    expect(pageIdFromTags(["usable-cms-page", "cms-page:article-legacy"])).toBe("article-legacy");
    expect(pageIdFromTags(["usable-cms-page", "ucms:page:article-current"])).toBe(
      "article-current",
    );
    expect(pageIdFromTags(["usable-cms-page", "page:article-fallback"])).toBe("article-fallback");
  });
});
