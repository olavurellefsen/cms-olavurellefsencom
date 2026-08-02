import { cache } from "react";
import { siteBinding } from "@/lib/cms/binding";
import { fallbackPage, fallbackSite } from "./fallback";
import {
  articleContentSchema,
  type GlobalContent,
  globalContentSchema,
  type Page,
  pageContentSchema,
} from "./schema";

type FragmentResponse = {
  fragment?: { id?: string; content?: string };
  content?: string;
};

export type LoadedValue<T> = {
  value: T;
  source: "usable" | "fallback";
  fragmentId?: string;
};

function stripFrontmatter(value: string) {
  if (!value.trimStart().startsWith("---")) return value;
  const match = value.match(/^---[\s\S]*?\n---\s*\n?/);
  return match ? value.slice(match[0].length) : value;
}

function parseFragmentContent(raw: string) {
  const withoutFrontmatter = stripFrontmatter(raw).trim();
  const fenced = withoutFrontmatter.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? withoutFrontmatter) as unknown;
}

async function fetchFragment(fragmentId: string) {
  const token = process.env.USABLE_CMS_SERVER_TOKEN;
  const source = process.env.CMS_CONTENT_SOURCE ?? "usable";
  if (!token || !fragmentId || source === "fallback") return null;

  try {
    const baseUrl = (process.env.USABLE_API_BASE_URL || "https://usable.dev").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/api/memory-fragments/${fragmentId}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      next: { revalidate: 60, tags: [`usable-fragment-${fragmentId}`] },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as FragmentResponse;
    const rawContent = payload.fragment?.content ?? payload.content;
    return typeof rawContent === "string" ? parseFragmentContent(rawContent) : null;
  } catch {
    return null;
  }
}

export const getGlobalContent = cache(async (): Promise<LoadedValue<GlobalContent>> => {
  const fragmentId =
    process.env.USABLE_CMS_GLOBAL_CONFIG_FRAGMENT_ID || siteBinding.globalFragmentId;
  const live = await fetchFragment(fragmentId);
  const parsed = globalContentSchema.safeParse(live);
  if (parsed.success) return { value: parsed.data, source: "usable", fragmentId };
  return { value: fallbackSite.global, source: "fallback", fragmentId: fragmentId || undefined };
});

export const getPageContent = cache(async (pageId: string): Promise<LoadedValue<Page> | null> => {
  const fallback = fallbackPage(pageId);
  if (!fallback) return null;
  const fragmentId = siteBinding.pageFragmentIds[pageId];
  const live = await fetchFragment(fragmentId);
  const content = pageContentSchema.safeParse(live);
  if (content.success) {
    return {
      value: { ...fallback, content: content.data },
      source: "usable",
      fragmentId,
    };
  }
  return { value: fallback, source: "fallback", fragmentId: fragmentId || undefined };
});

export const getPublishedArticles = cache(async () => {
  const articlePages = fallbackSite.pages.filter((page) => page.content.type === "article");
  const loaded = await Promise.all(articlePages.map((page) => getPageContent(page.id)));
  return loaded
    .filter((page): page is LoadedValue<Page> => Boolean(page))
    .filter((page) => {
      const parsed = articleContentSchema.safeParse(page.value.content);
      return parsed.success && parsed.data.status === "published";
    })
    .sort((a, b) => {
      const aDate = a.value.content.type === "article" ? a.value.content.publishedAt : "";
      const bDate = b.value.content.type === "article" ? b.value.content.publishedAt : "";
      return bDate.localeCompare(aDate);
    });
});

export async function getArticleBySlug(slug: string) {
  const articles = await getPublishedArticles();
  return articles.find(
    (page) => page.value.content.type === "article" && page.value.content.slug === slug,
  );
}
