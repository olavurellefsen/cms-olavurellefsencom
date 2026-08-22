import type { CmsPageReference } from "./binding";

export type CmsArticleRegion = {
  id: string;
  kind: "text" | "image";
  label: string;
  path: string;
  scope: "page";
  pageId: string;
  fragmentId?: string;
};

export function articleRegionId(pageId: string, field: string) {
  return `${pageId}.article.${field}`;
}

export function articleRegions(page: Pick<CmsPageReference, "id" | "fragmentId">) {
  const region = (
    field: string,
    label: string,
    kind: CmsArticleRegion["kind"] = "text",
  ): CmsArticleRegion => ({
    id: articleRegionId(page.id, field),
    kind,
    label,
    path: field,
    scope: "page",
    pageId: page.id,
    ...(page.fragmentId ? { fragmentId: page.fragmentId } : {}),
  });

  return [
    region("title", "Article title"),
    region("summary", "Article summary"),
    region("bodyBlocks", "Structured article body"),
    region("bodyMarkdown", "Article body"),
    region("heroImage", "Article hero image", "image"),
    region("heroImage.src", "Article image", "image"),
    region("heroImage.alt", "Article image alt text"),
    region("showHeroImage", "Show article hero image"),
    region("publishedAt", "Publication date"),
    region("updatedAt", "Updated date"),
    region("status", "Publication status"),
    region("topics", "Article topics"),
  ];
}
