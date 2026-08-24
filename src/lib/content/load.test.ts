import { afterEach, describe, expect, it, vi } from "vitest";
import { fallbackPage } from "./fallback";
import {
  getArticleBySlug,
  getPageContent,
  isPublishedCmsPage,
  pageIdFromTags,
  parseFragmentContent,
} from "./load";
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
        return Response.json({
          fragment: {
            id: fragmentId,
            content: JSON.stringify({
              ...article,
              topics: [{ $id: "11111111-1111-4111-8111-111111111111", $value: "CMS" }],
            }),
          },
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const loaded = await getArticleBySlug("freshly-published", { noStore: true });

    expect(loaded?.value.content).toMatchObject(article);
    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls.every(([, init]) => init?.cache === "no-store")).toBe(true);
  });

  it("keeps checked-in page fragment bindings authoritative over stale workspace duplicates", async () => {
    const canonicalFragmentId = "489909b4-df12-4aed-bb7a-090486b37071";
    const staleFragmentId = "599df734-f88a-409d-bde8-7701f9568a74";
    const fallback = fallbackPage("home");
    if (!fallback || fallback.content.type !== "home") throw new Error("Home fallback is required");
    const canonicalContent = {
      ...fallback.content,
      selectedWork: [
        ...fallback.content.selectedWork,
        {
          accent: "coral" as const,
          description: "The National Gallery is the Faroe Islands' main museum for Faroese art.",
          href: "https://art.fo",
          name: "National Gallery of the Faroe Islands",
          role: "Chairman of the Board",
        },
      ],
    };

    vi.stubEnv("USABLE_CMS_SERVER_TOKEN", "test-server-token");
    vi.stubEnv("USABLE_CMS_WORKSPACE_ID", "test-workspace");
    vi.stubEnv("NEXT_PUBLIC_USABLE_CMS_SITE_ID", "test-site");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/api/sites/test-site/pages")) {
        return new Response('{"error":"Invalid Compact JWS"}', { status: 500 });
      }
      if (url.includes("/api/memory-fragments?")) {
        return Response.json({
          fragments: [
            {
              id: staleFragmentId,
              title: "Stale Home",
              tags: ["usable-cms-page", "ucms:page:home"],
              content: JSON.stringify(fallback.content),
            },
          ],
        });
      }
      if (url.endsWith(`/api/memory-fragments/${canonicalFragmentId}`)) {
        return Response.json({
          fragment: { id: canonicalFragmentId, content: JSON.stringify(canonicalContent) },
        });
      }
      if (url.endsWith(`/api/memory-fragments/${staleFragmentId}`)) {
        return Response.json({
          fragment: { id: staleFragmentId, content: JSON.stringify(fallback.content) },
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const loaded = await getPageContent("home", { noStore: true });

    expect(loaded?.fragmentId).toBe(canonicalFragmentId);
    expect(loaded?.value.content.type === "home" && loaded.value.content.selectedWork).toHaveLength(
      5,
    );
  });
});
