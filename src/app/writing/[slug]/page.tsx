import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cmsRegion } from "@/lib/cms/regions";
import { getArticleBySlug, getGlobalContent, getPublishedArticles } from "@/lib/content/load";
import { safeJsonLd } from "@/lib/seo/json-ld";

type Props = { params: Promise<{ slug: string }> };

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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await getArticleBySlug(slug);
  if (!loaded || loaded.value.content.type !== "article") return {};
  const article = loaded.value.content;
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
      images: article.heroImage ? [{ url: article.heroImage.src, alt: article.heroImage.alt }] : [],
    },
  };
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const [loaded, global] = await Promise.all([getArticleBySlug(slug), getGlobalContent()]);
  if (!loaded || loaded.value.content.type !== "article") notFound();
  const article = loaded.value.content;
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
    image: article.heroImage
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
              id: "article.title",
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
              id: "article.summary",
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
        {article.heroImage && article.showHeroImage ? (
          <figure className="article-hero">
            <Image
              src={article.heroImage.src}
              alt={article.heroImage.alt}
              width={2160}
              height={2700}
              priority
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
              id: "article.body",
              label: "Article body",
              path: "bodyMarkdown",
              pageId: loaded.value.id,
            })}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{article.bodyMarkdown}</ReactMarkdown>
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
