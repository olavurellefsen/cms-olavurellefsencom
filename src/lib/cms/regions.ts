import { pageFragmentId, siteBinding } from "./binding";

type RegionOptions = {
  id: string;
  kind?: "text" | "link" | "image";
  label: string;
  path: string;
  pageId?: string;
};

export function cmsRegion({ id, kind = "text", label, path, pageId }: RegionOptions) {
  const fragmentId = pageId ? pageFragmentId(pageId) : siteBinding.globalFragmentId;

  return {
    "data-usable-cms-region": id,
    "data-usable-cms-kind": kind,
    "data-usable-cms-label": label,
    "data-usable-cms-path": path,
    ...(fragmentId ? { "data-usable-cms-fragment-id": fragmentId } : {}),
  };
}
