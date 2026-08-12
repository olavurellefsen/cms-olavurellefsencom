import { cache } from "react";
import { type CmsPageReference, siteBinding } from "@/lib/cms/binding";
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

type FragmentListItem = {
  id?: string;
  fragmentId?: string;
  title?: string;
  tags?: string[];
  content?: string;
};

export type LoadedValue<T> = {
  value: T;
  source: "usable" | "fallback";
  fragmentId?: string;
};

export type ContentLoadOptions = {
  noStore?: boolean;
};

function stripFrontmatter(value: string) {
  if (!value.trimStart().startsWith("---")) return value;
  const match = value.match(/^---[\s\S]*?\n---\s*\n?/);
  return match ? value.slice(match[0].length) : value;
}

export function parseFragmentContent(raw: string) {
  const withoutFrontmatter = stripFrontmatter(raw).trim();
  const fenced = withoutFrontmatter.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? withoutFrontmatter) as unknown;
}

function usableHeaders(token: string) {
  return { Accept: "application/json", Authorization: `Bearer ${token}` };
}

async function fetchFragment(fragmentId: string, noStore = false) {
  const token = process.env.USABLE_CMS_SERVER_TOKEN;
  const source = process.env.CMS_CONTENT_SOURCE ?? "usable";
  if (!token || !fragmentId || source === "fallback") return null;

  try {
    const baseUrl = (process.env.USABLE_API_BASE_URL || "https://usable.dev").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/api/memory-fragments/${fragmentId}`, {
      headers: usableHeaders(token),
      ...(noStore
        ? { cache: "no-store" as const }
        : { next: { revalidate: 60, tags: [`usable-fragment-${fragmentId}`] } }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as FragmentResponse;
    const rawContent = payload.fragment?.content ?? payload.content;
    return typeof rawContent === "string" ? parseFragmentContent(rawContent) : null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function pageIdFromTags(tags: string[] | undefined) {
  for (const prefix of ["cms-page:", "ucms:page:", "page:"]) {
    const value = tags?.find((tag) => tag.startsWith(prefix))?.slice(prefix.length);
    if (value) return value;
  }
  return undefined;
}

function normalizePageReference(value: unknown): CmsPageReference | null {
  if (!value || typeof value !== "object") return null;
  const page = value as Record<string, unknown>;
  const id = stringValue(page.id) || stringValue(page.pageId);
  const path = stringValue(page.path) || stringValue(page.route);
  if (!id || !path?.startsWith("/")) return null;
  return {
    id,
    title: stringValue(page.title) || id,
    path,
    fragmentId:
      stringValue(page.fragmentId) ||
      stringValue((page.fragment as Record<string, unknown> | undefined)?.id),
    order: typeof page.order === "number" ? page.order : undefined,
    status: stringValue(page.status),
  };
}

function pageArray(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.pages)) return record.pages;
  if (record.manifest && typeof record.manifest === "object") {
    const pages = (record.manifest as Record<string, unknown>).pages;
    if (Array.isArray(pages)) return pages;
  }
  if (record.site && typeof record.site === "object") {
    const pages = (record.site as Record<string, unknown>).pages;
    if (Array.isArray(pages)) return pages;
  }
  return [];
}

async function fetchCmsPageReferences(noStore = false): Promise<CmsPageReference[]> {
  const token = process.env.USABLE_CMS_SERVER_TOKEN;
  if (!token || (process.env.CMS_CONTENT_SOURCE ?? "usable") === "fallback") return [];
  const cmsOrigin = (process.env.NEXT_PUBLIC_USABLE_CMS_ORIGIN || "https://cms.usable.dev").replace(
    /\/$/,
    "",
  );
  const siteId = process.env.NEXT_PUBLIC_USABLE_CMS_SITE_ID || siteBinding.siteId;
  if (!siteId) return [];

  try {
    const response = await fetch(`${cmsOrigin}/api/sites/${siteId}/pages`, {
      headers: usableHeaders(token),
      ...(noStore
        ? { cache: "no-store" as const }
        : { next: { revalidate: 60, tags: [`usable-cms-pages-${siteId}`] } }),
    });
    if (!response.ok) return [];
    return pageArray(await response.json())
      .map(normalizePageReference)
      .filter((page): page is CmsPageReference => Boolean(page));
  } catch {
    return [];
  }
}

async function fetchWorkspacePageReferences(noStore = false): Promise<CmsPageReference[]> {
  const token = process.env.USABLE_CMS_SERVER_TOKEN;
  const workspaceId = process.env.USABLE_CMS_WORKSPACE_ID || siteBinding.workspaceId;
  if (!token || !workspaceId || (process.env.CMS_CONTENT_SOURCE ?? "usable") === "fallback")
    return [];

  try {
    const baseUrl = (process.env.USABLE_API_BASE_URL || "https://usable.dev").replace(/\/$/, "");
    const query = new URLSearchParams({ workspaceId, tags: "usable-cms-page", limit: "100" });
    const response = await fetch(`${baseUrl}/api/memory-fragments?${query}`, {
      headers: usableHeaders(token),
      ...(noStore
        ? { cache: "no-store" as const }
        : { next: { revalidate: 60, tags: [`usable-cms-workspace-pages-${workspaceId}`] } }),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { fragments?: FragmentListItem[] };
    const references: CmsPageReference[] = [];
    for (const fragment of payload.fragments || []) {
      const fragmentId = fragment.id || fragment.fragmentId;
      const pageId = pageIdFromTags(fragment.tags);
      if (!fragmentId || !pageId) continue;
      let path: string | undefined;
      let title = fragment.title || pageId;
      try {
        const rawContent = fragment.content
          ? parseFragmentContent(fragment.content)
          : await fetchFragment(fragmentId, noStore);
        const content = articleContentSchema.safeParse(rawContent);
        if (content.success) {
          path = `/writing/${content.data.slug}`;
          title = content.data.title;
          references.push({
            id: pageId,
            title,
            path,
            fragmentId,
            status: content.data.status === "published" ? "active" : "draft",
          });
          continue;
        }
      } catch {
        // A fragment can still be resolved by its stable cms-page tag.
      }
      const fallback = fallbackPage(pageId);
      references.push({
        id: pageId,
        title,
        path: path || fallback?.path || "",
        fragmentId,
      });
    }
    return references.filter((page) => page.path.startsWith("/"));
  } catch {
    return [];
  }
}

async function loadCmsPageDirectory(noStore = false): Promise<CmsPageReference[]> {
  const fallbackReferences: CmsPageReference[] = fallbackSite.pages.map((page, order) => ({
    id: page.id,
    title: page.title,
    path: page.path,
    fragmentId: siteBinding.pageFragmentIds[page.id],
    order,
    status: "active",
  }));
  const [cmsPages, workspacePages] = await Promise.all([
    fetchCmsPageReferences(noStore),
    fetchWorkspacePageReferences(noStore),
  ]);
  const pages = new Map(fallbackReferences.map((page) => [page.id, page]));
  for (const page of [...workspacePages, ...cmsPages]) {
    pages.set(page.id, { ...pages.get(page.id), ...page });
  }
  return [...pages.values()]
    .filter((page) => page.status !== "archived" && page.status !== "hidden")
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.title.localeCompare(b.title));
}

const getAllCachedCmsPages = cache(() => loadCmsPageDirectory(false));

export function isPublishedCmsPage(page: CmsPageReference) {
  return page.status !== "draft" && page.status !== "archived" && page.status !== "hidden";
}

export const getCmsPageDirectory = cache(
  async (): Promise<CmsPageReference[]> =>
    (await getAllCachedCmsPages()).filter(isPublishedCmsPage),
);

export async function getCmsEditorPageDirectory(): Promise<CmsPageReference[]> {
  return loadCmsPageDirectory(true);
}

async function loadGlobalContent(noStore = false): Promise<LoadedValue<GlobalContent>> {
  const fragmentId =
    process.env.USABLE_CMS_GLOBAL_CONFIG_FRAGMENT_ID || siteBinding.globalFragmentId;
  const live = await fetchFragment(fragmentId, noStore);
  const parsed = globalContentSchema.safeParse(live);
  if (parsed.success) return { value: parsed.data, source: "usable", fragmentId };
  return { value: fallbackSite.global, source: "fallback", fragmentId: fragmentId || undefined };
}

const getCachedGlobalContent = cache(() => loadGlobalContent(false));

export function getGlobalContent(
  options: ContentLoadOptions = {},
): Promise<LoadedValue<GlobalContent>> {
  return options.noStore ? loadGlobalContent(true) : getCachedGlobalContent();
}

async function loadPageContent(
  pageId: string,
  noStore = false,
  knownReference?: CmsPageReference,
): Promise<LoadedValue<Page> | null> {
  const fallback = fallbackPage(pageId);
  const reference =
    knownReference ||
    (noStore
      ? (await loadCmsPageDirectory(true)).filter(isPublishedCmsPage)
      : await getCmsPageDirectory()
    ).find((page) => page.id === pageId);
  if (!reference && !fallback) return null;
  const fragmentId = reference?.fragmentId || siteBinding.pageFragmentIds[pageId];
  const live = await fetchFragment(fragmentId, noStore);
  const content = pageContentSchema.safeParse(live);
  if (content.success) {
    return {
      value: {
        id: reference?.id || fallback?.id || pageId,
        title: reference?.title || fallback?.title || pageId,
        path:
          reference?.path ||
          fallback?.path ||
          (content.data.type === "article" ? `/writing/${content.data.slug}` : `/${pageId}`),
        content: content.data,
      },
      source: "usable",
      fragmentId,
    };
  }
  return fallback
    ? { value: fallback, source: "fallback", fragmentId: fragmentId || undefined }
    : null;
}

const getCachedPageContent = cache((pageId: string) => loadPageContent(pageId, false));

export function getPageContent(
  pageId: string,
  options: ContentLoadOptions = {},
): Promise<LoadedValue<Page> | null> {
  return options.noStore ? loadPageContent(pageId, true) : getCachedPageContent(pageId);
}

async function loadPublishedArticles(noStore = false) {
  const directory = noStore
    ? (await loadCmsPageDirectory(true)).filter(isPublishedCmsPage)
    : await getCmsPageDirectory();
  const references = directory.filter(
    (page) => page.id.startsWith("article-") || page.path.startsWith("/writing/"),
  );
  const loaded = await Promise.all(
    references.map((page) =>
      noStore ? loadPageContent(page.id, true, page) : getPageContent(page.id),
    ),
  );
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
}

const getCachedPublishedArticles = cache(() => loadPublishedArticles(false));

export function getPublishedArticles(options: ContentLoadOptions = {}) {
  return options.noStore ? loadPublishedArticles(true) : getCachedPublishedArticles();
}

export async function getArticleBySlug(slug: string, options: ContentLoadOptions = {}) {
  const articles = await getPublishedArticles(options);
  return articles.find(
    (page) => page.value.content.type === "article" && page.value.content.slug === slug,
  );
}
