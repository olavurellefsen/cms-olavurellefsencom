import { describe, expect, it } from "vitest";
import { fallbackArticle, fallbackPage, fallbackSite } from "./fallback";

describe("fallback content", () => {
  it("contains the required public routes", () => {
    expect(fallbackPage("home")?.path).toBe("/");
    expect(fallbackPage("writing")?.path).toBe("/writing");
    expect(fallbackPage("about")?.path).toBe("/about");
  });

  it("only exposes published articles to the public index", () => {
    const articles = fallbackSite.pages.flatMap((page) =>
      page.content.type === "article" ? [page.content] : [],
    );
    expect(articles.length).toBeGreaterThan(0);
    expect(articles.every((article) => article.status === "published")).toBe(true);
  });

  it("resolves an article by its stable slug", () => {
    expect(fallbackArticle("why-i-am-writing-here")?.title).toBe("Why I am writing here");
  });
});
