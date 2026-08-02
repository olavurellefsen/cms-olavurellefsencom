import rawFallback from "../../../content/site.json";
import { siteContentSchema } from "./schema";

export const fallbackSite = siteContentSchema.parse(rawFallback);

export function fallbackPage(pageId: string) {
  return fallbackSite.pages.find((page) => page.id === pageId);
}

export function fallbackArticle(slug: string) {
  return fallbackSite.pages.find(
    (page) => page.content.type === "article" && page.content.slug === slug,
  );
}
