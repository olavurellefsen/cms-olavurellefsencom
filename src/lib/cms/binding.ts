import rawBinding from "../../../cms/site-binding.json";

type SiteBinding = {
  siteId: string;
  workspaceId: string;
  integrationKey: string;
  globalFragmentId: string;
  pageFragmentIds: Record<string, string>;
};

export const siteBinding = rawBinding as SiteBinding;

export function pageFragmentId(pageId: string) {
  return siteBinding.pageFragmentIds[pageId] || "";
}
