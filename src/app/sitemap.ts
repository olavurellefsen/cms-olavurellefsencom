import type { MetadataRoute } from "next";
import { getPublishedArticles } from "@/lib/content/load";

export const revalidate = 60;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://www.olavurellefsen.com";
  const articles = await getPublishedArticles();
  return [
    { url: baseUrl, lastModified: new Date("2026-08-02"), changeFrequency: "weekly", priority: 1 },
    {
      url: `${baseUrl}/writing`,
      lastModified: new Date("2026-08-02"),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/about`,
      lastModified: new Date("2026-08-02"),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    ...articles.flatMap(({ value }) =>
      value.content.type === "article"
        ? [
            {
              url: `${baseUrl}/writing/${value.content.slug}`,
              lastModified: new Date(value.content.updatedAt || value.content.publishedAt),
              changeFrequency: "monthly" as const,
              priority: 0.6,
            },
          ]
        : [],
    ),
  ];
}
