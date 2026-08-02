import { pageFragmentId, siteBinding } from "@/lib/cms/binding";
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
      regions: manifest.regions.map(withFragmentId),
      collections: manifest.collections.map(withFragmentId),
    },
    {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=60" },
    },
  );
}
