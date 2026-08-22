import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleBlocks, ArticleBlocksHero } from "@/components/article-markdown";
import { articleRegionId } from "@/lib/cms/article-regions";
import { cmsRegion } from "@/lib/cms/regions";
import { type CmsSearchParams, isCmsContentRequest } from "@/lib/cms/request";
import { articleBody, firstArticleBodyHero } from "@/lib/content/article-body";
import { getArticleBySlug, getGlobalContent, getPublishedArticles } from "@/lib/content/load";
import { safeJsonLd } from "@/lib/seo/json-ld";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<CmsSearchParams>;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export async function generateStaticParams() {
  const articles = await getPublishedArticles();
  return articles.flatMap(({ value }) =>
    value.content.type === "article" ? [{ slug: value.content.slug }] : [],
  );
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const loaded = await getArticleBySlug(slug, { noStore: isCmsContentRequest(query) });
  if (!loaded || loaded.value.content.type !== "article") return {};
  const article = loaded.value.content;
  const body = articleBody(article);
  const directiveHero = firstArticleBodyHero(body);
  const socialImage = directiveHero?.type === "image" ? directiveHero : article.heroImage;
  return {
    title: article.title,
    description: article.summary,
    alternates: { canonical: article.canonicalUrl },
    openGraph: {
      type: "article",
      title: article.title,
      description: article.summary,
      url: article.canonicalUrl,
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt,
      tags: article.topics,
      images: socialImage ? [{ url: socialImage.src, alt: socialImage.alt }] : [],
    },
  };
}

export default async function ArticlePage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const noStore = isCmsContentRequest(query);
  const [loaded, global] = await Promise.all([
    getArticleBySlug(slug, { noStore }),
    getGlobalContent({ noStore }),
  ]);
  if (!loaded || loaded.value.content.type !== "article") notFound();
  const article = loaded.value.content;
  const body = articleBody(article);
  const directiveHero = firstArticleBodyHero(body);
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.summary,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt || article.publishedAt,
    mainEntityOfPage: article.canonicalUrl,
    author: { "@id": `${global.value.canonicalUrl}/#person` },
    publisher: { "@type": "Person", name: global.value.author.name },
    image:
      directiveHero?.type === "image"
        ? new URL(directiveHero.src, global.value.canonicalUrl).toString()
        : article.heroImage
          ? new URL(article.heroImage.src, global.value.canonicalUrl).toString()
          : undefined,
  };

  return (
    <main id="main-content">
      <article className="article-page">
        <header className="article-header">
          <Link className="article-back" href="/writing">
            ← Writing
          </Link>
          <div className="article-header__meta">
            <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
            <span>{article.topics.join(" · ")}</span>
          </div>
          <h1
            {...cmsRegion({
              fragmentId: loaded.fragmentId,
              id: articleRegionId(loaded.value.id, "title"),
              label: "Article title",
              path: "title",
              pageId: loaded.value.id,
            })}
          >
            {article.title}
          </h1>
          <p
            className="article-header__summary"
            {...cmsRegion({
              fragmentId: loaded.fragmentId,
              id: articleRegionId(loaded.value.id, "summary"),
              label: "Article summary",
              path: "summary",
              pageId: loaded.value.id,
            })}
          >
            {article.summary}
          </p>
          {article.updatedAt && article.updatedAt !== article.publishedAt ? (
            <p className="article-updated">Updated {formatDate(article.updatedAt)}</p>
          ) : null}
        </header>
        <ArticleBlocksHero body={body} />
        {article.heroImage && article.showHeroImage && !directiveHero ? (
          <figure className="article-hero">
            <Image
              src={article.heroImage.src}
              alt={article.heroImage.alt}
              width={2160}
              height={2700}
              priority
              unoptimized
              {...cmsRegion({
                fragmentId: loaded.fragmentId,
                id: articleRegionId(loaded.value.id, "heroImage.src"),
                kind: "image",
                label: "Article image",
                path: "heroImage.src",
                pageId: loaded.value.id,
              })}
            />
          </figure>
        ) : null}
        <div className="article-layout">
          <aside className="article-aside">
            <span>Field note</span>
            <p>From {global.value.author.location}</p>
          </aside>
          <div
            className="article-prose"
            {...cmsRegion({
              fragmentId: loaded.fragmentId,
              id: articleRegionId(loaded.value.id, "bodyBlocks"),
              label: "Article body",
              path: "bodyBlocks",
              pageId: loaded.value.id,
            })}
          >
            <ArticleBlocks body={body} />
          </div>
        </div>
      </article>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON is escaped before insertion.
        dangerouslySetInnerHTML={{ __html: safeJsonLd(articleSchema) }}
      />
    </main>
  );
}
