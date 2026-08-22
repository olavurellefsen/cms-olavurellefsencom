export type SyncPageReference = {
  id: string;
  title: string;
  path: string;
  fragmentId: string;
  order?: number;
  status?: string;
  content?: Record<string, unknown>;
};

export function parseCmsFragmentContent(raw: unknown): Record<string, unknown> | null;
export function pageIdFromTags(tags?: string[]): string | undefined;
export function cmsPageArray(payload: unknown): unknown[];
export function selectUsablePageReferences(input: {
  fallbackPages: Array<{ id: string; title: string; path: string }>;
  bindingPageFragmentIds: Record<string, string>;
  workspaceFragments: Array<Record<string, unknown>>;
  cmsPagesPayload: unknown;
}): SyncPageReference[];
export function auditUsablePageTopology(input: {
  globalContent: Record<string, unknown>;
  fallbackPages: Array<{ id: string; title: string; path: string }>;
  bindingPageFragmentIds: Record<string, string>;
  workspaceFragments: Array<Record<string, unknown>>;
  cmsPagesPayload: unknown;
}): {
  storageModel: string;
  globalContainsPagesArray: boolean;
  physicalPageFragments: number;
  logicalPageIds: number;
  selectablePages: number;
  selected: Array<Record<string, unknown>>;
  duplicates: Array<Record<string, unknown>>;
  pageFragmentsContainingPagesArrays: Array<Record<string, unknown>>;
};
