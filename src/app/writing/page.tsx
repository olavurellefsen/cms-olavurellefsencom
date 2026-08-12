import type { Metadata } from "next";
import { ArticleList } from "@/components/article-list";
import { cmsRegion } from "@/lib/cms/regions";
import { type CmsSearchParams, isCmsContentRequest } from "@/lib/cms/request";
import { getPageContent, getPublishedArticles } from "@/lib/content/load";

export const metadata: Metadata = {
  title: "Writing",
  description:
    "Field notes from Ólavur Ellefsen on durable AI, building companies and the Faroe Islands.",
  alternates: { canonical: "/writing" },
};

export default async function WritingPage({
  searchParams,
}: {
  searchParams: Promise<CmsSearchParams>;
}) {
  const noStore = isCmsContentRequest(await searchParams);
  const [loadedPage, articles] = await Promise.all([
    getPageContent("writing", { noStore }),
    getPublishedArticles({ noStore }),
  ]);
  if (!loadedPage || loadedPage.value.content.type !== "writing") return null;
  const content = loadedPage.value.content;

  return (
    <main id="main-content" className="page-shell">
      <header className="page-intro">
        <p
          className="eyebrow"
          {...cmsRegion({
            id: "writing.eyebrow",
            label: "Writing eyebrow",
            path: "eyebrow",
            pageId: "writing",
          })}
        >
          {content.eyebrow}
        </p>
        <h1
          {...cmsRegion({
            id: "writing.headline",
            label: "Writing headline",
            path: "headline",
            pageId: "writing",
          })}
        >
          {content.headline}
        </h1>
        <p
          {...cmsRegion({
            id: "writing.introduction",
            label: "Writing introduction",
            path: "introduction",
            pageId: "writing",
          })}
        >
          {content.introduction}
        </p>
      </header>
      <div className="page-rule" />
      <ArticleList articles={articles} />
    </main>
  );
}
