import { getGlobalContent, getPublishedArticles } from "@/lib/content/load";

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '"': "&quot;",
    };
    return entities[character] || character;
  });
}

export async function GET() {
  const [global, articles] = await Promise.all([getGlobalContent(), getPublishedArticles()]);
  const items = articles.flatMap(({ value }) => {
    if (value.content.type !== "article") return [];
    const article = value.content;
    return `<item>
      <title>${escapeXml(article.title)}</title>
      <link>${escapeXml(article.canonicalUrl)}</link>
      <guid isPermaLink="true">${escapeXml(article.canonicalUrl)}</guid>
      <pubDate>${new Date(`${article.publishedAt}T00:00:00Z`).toUTCString()}</pubDate>
      <description>${escapeXml(article.summary)}</description>
    </item>`;
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${escapeXml(global.value.siteName)}</title>
  <link>${escapeXml(global.value.canonicalUrl)}</link>
  <description>${escapeXml(global.value.siteDescription)}</description>
  <language>en</language>
  ${items.join("\n")}
</channel></rss>`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=300",
    },
  });
}
