import type { Metadata } from "next";
import Image from "next/image";
import { cmsRegion } from "@/lib/cms/regions";
import { getGlobalContent, getPageContent } from "@/lib/content/load";

export const metadata: Metadata = {
  title: "About",
  description: "About Ólavur Ellefsen, Faroese software engineer, entrepreneur and CEO of Usable.",
  alternates: { canonical: "/about" },
};

export default async function AboutPage() {
  const [global, loadedPage] = await Promise.all([getGlobalContent(), getPageContent("about")]);
  if (!loadedPage || loadedPage.value.content.type !== "about") return null;
  const content = loadedPage.value.content;

  return (
    <main id="main-content">
      <section className="about-hero">
        <div className="about-hero__copy">
          <p
            className="eyebrow"
            {...cmsRegion({
              id: "about.eyebrow",
              label: "About eyebrow",
              path: "eyebrow",
              pageId: "about",
            })}
          >
            {content.eyebrow}
          </p>
          <h1
            {...cmsRegion({
              id: "about.headline",
              label: "About headline",
              path: "headline",
              pageId: "about",
            })}
          >
            {content.headline}
          </h1>
          <p
            className="about-hero__lead"
            {...cmsRegion({ id: "about.lead", label: "About lead", path: "lead", pageId: "about" })}
          >
            {content.lead}
          </p>
        </div>
        <Image
          className="about-hero__portrait"
          src={global.value.author.portrait.src}
          alt={global.value.author.portrait.alt}
          width={446}
          height={514}
          sizes="(max-width: 760px) 70vw, 28vw"
        />
      </section>
      <section className="about-body section-shell">
        <div className="about-body__label">
          <p className="section-index">01 / BIOGRAPHY</p>
        </div>
        <div className="prose-lead">
          {content.body.map((paragraph, index) => (
            <p
              key={paragraph}
              {...cmsRegion({
                id: `about.body.${index}`,
                label: `About paragraph ${index + 1}`,
                path: `body.${index}`,
                pageId: "about",
              })}
            >
              {paragraph}
            </p>
          ))}
        </div>
      </section>
      <section className="principles-band">
        <div className="principles-band__inner">
          <h2
            {...cmsRegion({
              id: "about.principlesTitle",
              label: "Principles title",
              path: "principlesTitle",
              pageId: "about",
            })}
          >
            {content.principlesTitle}
          </h2>
          <ol>
            {content.principles.map((principle, index) => (
              <li key={principle}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <p
                  {...cmsRegion({
                    id: `about.principle.${index}`,
                    label: `Principle ${index + 1}`,
                    path: `principles.${index}`,
                    pageId: "about",
                  })}
                >
                  {principle}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section className="contact-section section-shell">
        <p className="section-index">02 / CONTACT</p>
        <h2
          {...cmsRegion({
            id: "about.contactTitle",
            label: "Contact title",
            path: "contactTitle",
            pageId: "about",
          })}
        >
          {content.contactTitle}
        </h2>
        <p
          {...cmsRegion({
            id: "about.contactBody",
            label: "Contact body",
            path: "contactBody",
            pageId: "about",
          })}
        >
          {content.contactBody}
        </p>
        <a className="contact-link" href={`mailto:${global.value.author.email}`}>
          {global.value.author.email}
          <span aria-hidden="true">↗</span>
        </a>
      </section>
    </main>
  );
}
