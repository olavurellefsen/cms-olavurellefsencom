import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/cms", "/api/cms"] }],
    sitemap: "https://www.olavurellefsen.com/sitemap.xml",
    host: "https://www.olavurellefsen.com",
  };
}
