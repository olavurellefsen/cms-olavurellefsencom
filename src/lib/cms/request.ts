export type CmsSearchParams = Record<string, string | string[] | undefined>;

function hasEnabledFlag(value: string | string[] | undefined) {
  return value === "1" || (Array.isArray(value) && value.includes("1"));
}

export function isCmsContentRequest(searchParams: CmsSearchParams | undefined) {
  return hasEnabledFlag(searchParams?.cms) || hasEnabledFlag(searchParams?.["cms-preview"]);
}
