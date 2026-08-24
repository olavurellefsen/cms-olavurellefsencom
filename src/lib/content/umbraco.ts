import { legacyContentView } from "@/lib/cms/collection-compatibility";
import manifest from "../../../cms/manifest.json";
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
    const raw = (await response.json()) as { global?: unknown; pages?: unknown[] };
    const compatible = {
      ...raw,
      pages: (raw.pages || []).map((page) => {
        if (!page || typeof page !== "object") return page;
        const record = page as Record<string, unknown>;
        return {
          ...record,
          content: legacyContentView(record.content, manifest.collections, String(record.id || "")),
        };
      }),
    };
    const parsed = siteContentSchema.safeParse(compatible);
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
