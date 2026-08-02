import Link from "next/link";
import type { LoadedValue } from "@/lib/content/load";
import type { Page } from "@/lib/content/schema";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function ArticleList({
  articles,
  compact = false,
}: {
  articles: LoadedValue<Page>[];
  compact?: boolean;
}) {
  return (
    <ol className={compact ? "article-list article-list--compact" : "article-list"}>
      {articles.map(({ value: page }) => {
        if (page.content.type !== "article") return null;
        const article = page.content;
        return (
          <li key={page.id}>
            <Link href={`/writing/${article.slug}`} className="article-teaser">
              <div className="article-teaser__meta">
                <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
                <span>{article.topics[0] || "Field note"}</span>
              </div>
              <div>
                <h3>{article.title}</h3>
                <p>{article.summary}</p>
              </div>
              <span className="article-teaser__arrow" aria-hidden="true">
                ↗
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
