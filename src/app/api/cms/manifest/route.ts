import { pageFragmentId, siteBinding } from "@/lib/cms/binding";
import { fallbackSite } from "@/lib/content/fallback";
import manifest from "../../../../../cms/manifest.json";

type ScopedEntry = { scope?: string; pageId?: string };

function withFragmentId<T extends ScopedEntry>(entry: T) {
  const fragmentId =
    entry.scope === "page" && entry.pageId
      ? pageFragmentId(entry.pageId)
      : siteBinding.globalFragmentId;
  return { ...entry, ...(fragmentId ? { fragmentId } : {}) };
}

export function GET() {
  return Response.json(
    {
      ...manifest,
      site: siteBinding.siteId,
      siteId: siteBinding.siteId,
      workspaceId: siteBinding.workspaceId,
      pages: fallbackSite.pages.map((page, order) => ({
        id: page.id,
        title: page.title,
        path: page.path,
        fragmentId: pageFragmentId(page.id) || undefined,
        order,
        status: "active",
      })),
      pageTemplates: fallbackSite.pageTemplates,
      regions: manifest.regions.map(withFragmentId),
      collections: manifest.collections.map(withFragmentId),
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
