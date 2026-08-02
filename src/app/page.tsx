import Image from "next/image";
import Link from "next/link";
import { ArticleList } from "@/components/article-list";
import { cmsRegion } from "@/lib/cms/regions";
import { getGlobalContent, getPageContent, getPublishedArticles } from "@/lib/content/load";

export default async function HomePage() {
  const [global, loadedPage, articles] = await Promise.all([
    getGlobalContent(),
    getPageContent("home"),
    getPublishedArticles(),
  ]);
  if (!loadedPage || loadedPage.value.content.type !== "home") return null;
  const content = loadedPage.value.content;

  return (
    <main id="main-content">
      <section className="home-hero">
        <div className="home-hero__copy">
          <p
            className="eyebrow"
            {...cmsRegion({
              id: "home.eyebrow",
              label: "Home eyebrow",
              path: "eyebrow",
              pageId: "home",
            })}
          >
            {content.eyebrow}
          </p>
          <h1
            {...cmsRegion({
              id: "home.headline",
              label: "Home headline",
              path: "headline",
              pageId: "home",
            })}
          >
            {content.headline}
          </h1>
          <p
            className="home-hero__intro"
            {...cmsRegion({
              id: "home.introduction",
              label: "Home introduction",
              path: "introduction",
              pageId: "home",
            })}
          >
            {content.introduction}
          </p>
          <Link className="text-link" href="/writing">
            Read the field notes <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <figure className="home-hero__portrait">
          <span className="portrait-index" aria-hidden="true">
            01
          </span>
          <Image
            src={global.value.author.portrait.src}
            alt={global.value.author.portrait.alt}
            width={446}
            height={514}
            priority
            sizes="(max-width: 760px) 72vw, 32vw"
            {...cmsRegion({
              id: "global.author.portrait",
              kind: "image",
              label: "Portrait",
              path: "author.portrait.src",
            })}
          />
          <figcaption>{global.value.author.location}</figcaption>
        </figure>
      </section>

      <section className="focus-band">
        <div className="focus-band__inner">
          <p
            className="eyebrow eyebrow--light"
            {...cmsRegion({
              id: "home.focus.label",
              label: "Focus label",
              path: "currentFocus.label",
              pageId: "home",
            })}
          >
            {content.currentFocus.label}
          </p>
          <h2
            {...cmsRegion({
              id: "home.focus.title",
              label: "Focus title",
              path: "currentFocus.title",
              pageId: "home",
            })}
          >
            {content.currentFocus.title}
          </h2>
          <div className="focus-band__detail">
            <p
              {...cmsRegion({
                id: "home.focus.body",
                label: "Focus body",
                path: "currentFocus.body",
                pageId: "home",
              })}
            >
              {content.currentFocus.body}
            </p>
            <a
              className="text-link text-link--light"
              href={content.currentFocus.href}
              {...cmsRegion({
                id: "home.focus.linkLabel",
                label: "Focus link label",
                path: "currentFocus.linkLabel",
                pageId: "home",
              })}
            >
              {content.currentFocus.linkLabel} <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
      </section>

      <section className="section-shell work-section">
        <div className="section-heading">
          <p className="section-index">02 / CURRENT WORK</p>
          <h2
            {...cmsRegion({
              id: "home.workTitle",
              label: "Work section title",
              path: "selectedWorkTitle",
              pageId: "home",
            })}
          >
            {content.selectedWorkTitle}
          </h2>
        </div>
        <ol className="work-list">
          {content.selectedWork.map((item, index) => (
            <li key={item.name} data-accent={item.accent}>
              <a href={item.href}>
                <span className="work-list__number">{String(index + 1).padStart(2, "0")}</span>
                <div className="work-list__title">
                  <h3
                    {...cmsRegion({
                      id: `home.work.${index}.name`,
                      label: `Work ${index + 1} name`,
                      path: `selectedWork.${index}.name`,
                      pageId: "home",
                    })}
                  >
                    {item.name}
                  </h3>
                  <p
                    {...cmsRegion({
                      id: `home.work.${index}.role`,
                      label: `Work ${index + 1} role`,
                      path: `selectedWork.${index}.role`,
                      pageId: "home",
                    })}
                  >
                    {item.role}
                  </p>
                </div>
                <p
                  className="work-list__description"
                  {...cmsRegion({
                    id: `home.work.${index}.description`,
                    label: `Work ${index + 1} description`,
                    path: `selectedWork.${index}.description`,
                    pageId: "home",
                  })}
                >
                  {item.description}
                </p>
                <span className="work-list__arrow" aria-hidden="true">
                  ↗
                </span>
              </a>
            </li>
          ))}
        </ol>
      </section>

      <section className="section-shell writing-section">
        <div className="section-heading section-heading--with-link">
          <div>
            <p className="section-index">03 / WRITING</p>
            <h2
              {...cmsRegion({
                id: "home.latestWritingTitle",
                label: "Writing section title",
                path: "latestWritingTitle",
                pageId: "home",
              })}
            >
              {content.latestWritingTitle}
            </h2>
          </div>
          <Link className="text-link" href="/writing">
            All writing <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <ArticleList articles={articles.slice(0, 3)} compact />
      </section>
    </main>
  );
}
