import { afterEach, describe, expect, it, vi } from "vitest";
import { getArticleBySlug, isPublishedCmsPage, pageIdFromTags, parseFragmentContent } from "./load";
import { articleContentSchema } from "./schema";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

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

  it("bypasses every CMS read cache when resolving a newly published preview", async () => {
    const fragmentId = "00000000-0000-4000-8000-000000000999";
    const article = {
      type: "article",
      title: "Freshly published",
      slug: "freshly-published",
      summary: "Visible immediately after publish.",
      publishedAt: "2026-08-12",
      updatedAt: "2026-08-12",
      status: "published",
      topics: ["CMS"],
      canonicalUrl: "https://www.olavurellefsen.com/writing/freshly-published",
      bodyMarkdown: "The public preview must not reuse the former draft response.",
    };

    vi.stubEnv("USABLE_CMS_SERVER_TOKEN", "test-server-token");
    vi.stubEnv("USABLE_CMS_WORKSPACE_ID", "test-workspace");
    vi.stubEnv("NEXT_PUBLIC_USABLE_CMS_SITE_ID", "test-site");
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/api/sites/test-site/pages")) {
        return Response.json({
          pages: [
            {
              id: "article-freshly-published",
              title: article.title,
              path: "/writing/freshly-published",
              fragmentId,
              status: "active",
            },
          ],
        });
      }
      if (url.includes("/api/memory-fragments?")) return Response.json({ fragments: [] });
      if (url.endsWith(`/api/memory-fragments/${fragmentId}`)) {
        return Response.json({ fragment: { id: fragmentId, content: JSON.stringify(article) } });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const loaded = await getArticleBySlug("freshly-published", { noStore: true });

    expect(loaded?.value.content).toMatchObject(article);
    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls.every(([, init]) => init?.cache === "no-store")).toBe(true);
  });
});
