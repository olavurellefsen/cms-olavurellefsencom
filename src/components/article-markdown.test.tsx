import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type ArticleMediaBlock, articleMediaDirective } from "@/lib/content/article-media";
import { ArticleDirectiveHero, ArticleMarkdown } from "./article-markdown";

afterEach(cleanup);

const media: ArticleMediaBlock = {
  id: "media-public",
  type: "image",
  src: "https://cms.usable.dev/api/sites/site/assets/image",
  alt: "A public lake image",
  caption: "A semantic caption.",
  placement: "inline",
  alignment: "left",
};

describe("ArticleMarkdown", () => {
  it("renders Markdown and inline CMS media with captions", () => {
    render(
      <ArticleMarkdown
        markdown={`## Heading\n\n**Bold text**\n\n${articleMediaDirective(media)}`}
      />,
    );

    expect(screen.getByRole("heading", { name: "Heading", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Bold text").tagName).toBe("STRONG");
    expect(screen.getByRole("img", { name: media.alt })).toBeInTheDocument();
    expect(screen.getByText(media.caption).tagName).toBe("FIGCAPTION");
  });

  it("renders hero media separately from body media", () => {
    const hero = { ...media, id: "media-hero", placement: "hero" as const };
    const markdown = `${articleMediaDirective(hero)}\n\nBody`;
    const { rerender } = render(<ArticleDirectiveHero markdown={markdown} />);
    expect(screen.getByRole("img", { name: media.alt })).toBeInTheDocument();

    rerender(<ArticleMarkdown markdown={markdown} />);
    expect(screen.queryByRole("img", { name: media.alt })).not.toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
  });
});
