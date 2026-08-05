import { describe, expect, it } from "vitest";
import { isPublishedCmsPage, pageIdFromTags, parseFragmentContent } from "./load";
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

  it("resolves page ids from legacy and current CMS identity tags", () => {
    expect(pageIdFromTags(["usable-cms-page", "cms-page:article-legacy"])).toBe("article-legacy");
    expect(pageIdFromTags(["usable-cms-page", "ucms:page:article-current"])).toBe(
      "article-current",
    );
    expect(pageIdFromTags(["usable-cms-page", "page:article-fallback"])).toBe("article-fallback");
  });
});

describe("CMS page visibility", () => {
  it("keeps unpublished page references out of public page directories", () => {
    const page = { id: "article-draft", title: "Draft", path: "/writing/draft" };
    expect(isPublishedCmsPage({ ...page, status: "draft" })).toBe(false);
    expect(isPublishedCmsPage({ ...page, status: "active" })).toBe(true);
  });
});
