import { type GlobalContent, type Page, siteContentSchema } from "./schema";

export type UmbracoSiteSnapshot = {
  global: GlobalContent;
  pages: Page[];
};

export async function fetchUmbracoSiteSnapshot(
  noStore = false,
): Promise<UmbracoSiteSnapshot | null> {
  const origin = process.env.UMBRACO_ORIGIN?.replace(/\/$/, "");
  if (!origin) return null;

  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = process.env.UMBRACO_SYNC_API_KEY;
  if (apiKey) headers["X-Olavur-Sync-Key"] = apiKey;

  try {
    const response = await fetch(`${origin}/api/olavur-sync/export`, {
      headers,
      ...(noStore
        ? { cache: "no-store" as const }
        : { next: { revalidate: 60, tags: ["umbraco-site-content"] } }),
    });
    if (!response.ok) return null;
    const parsed = siteContentSchema.safeParse(await response.json());
    if (!parsed.success) {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "Umbraco snapshot rejected:",
          parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
        );
      }
      return null;
    }
    return { global: parsed.data.global, pages: parsed.data.pages };
  } catch {
    return null;
  }
}
