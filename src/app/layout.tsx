import "@fontsource-variable/manrope";
import "@fontsource-variable/newsreader";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { CmsEmbed } from "@/components/cms-embed";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getGlobalContent } from "@/lib/content/load";
import { safeJsonLd } from "@/lib/seo/json-ld";

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f2f5f1",
};

export async function generateMetadata(): Promise<Metadata> {
  const { value: global } = await getGlobalContent();
  const portraitUrl = new URL(global.author.portrait.src, global.canonicalUrl).toString();
  return {
    metadataBase: new URL(global.canonicalUrl),
    title: { default: global.siteName, template: `%s · ${global.siteName}` },
    description: global.siteDescription,
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      siteName: global.siteName,
      title: global.siteName,
      description: global.siteDescription,
      url: global.canonicalUrl,
      images: [{ url: portraitUrl, alt: global.author.portrait.alt }],
    },
    twitter: {
      card: "summary_large_image",
      title: global.siteName,
      description: global.siteDescription,
      images: [portraitUrl],
    },
    icons: { icon: "/favicon.png" },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { value: global } = await getGlobalContent();
  const personSchema = {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${global.canonicalUrl}/#person`,
    name: global.author.name,
    url: global.canonicalUrl,
    image: new URL(global.author.portrait.src, global.canonicalUrl).toString(),
    email: `mailto:${global.author.email}`,
    homeLocation: { "@type": "Place", name: global.author.location },
    jobTitle: "CEO and co-founder of Usable",
    sameAs: global.socialLinks
      .filter((link) => link.href.startsWith("http"))
      .map((link) => link.href),
  };

  return (
    <html lang="en">
      <body>
        <SiteHeader content={global} />
        {children}
        <SiteFooter content={global} />
        <CmsEmbed />
        <script
          type="application/ld+json"
          // JSON-LD contains trusted, schema-validated CMS content.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON is escaped before insertion.
          dangerouslySetInnerHTML={{ __html: safeJsonLd(personSchema) }}
        />
      </body>
    </html>
  );
}
