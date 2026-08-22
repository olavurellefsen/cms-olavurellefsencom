import { describe, expect, it } from "vitest";
import { articleBodyFromMarkdown, articleMarkdownFromBody } from "./article-body";
import { type ArticleMediaBlock, articleMediaDirective } from "./article-media";

describe("canonical article body blocks", () => {
  it("converts legacy Markdown and media directives to explicit ordered blocks", () => {
    const media: ArticleMediaBlock = {
      id: "inline-harbour",
      type: "image",
      src: "https://assets.example/harbour.webp",
      alt: "Harbour",
      caption: "Tórshavn harbour",
      placement: "inline",
      alignment: "wide",
    };
    const markdown = [
      "## A heading",
      "A **formatted** paragraph.",
      "- One\n- Two",
      "> A quotation",
      articleMediaDirective(media),
    ].join("\n\n");

    const body = articleBodyFromMarkdown(markdown);

    expect(body.version).toBe(1);
    expect(body.blocks.map((block) => block.type)).toEqual(["heading", "richText", "media"]);
    expect(articleMarkdownFromBody(body)).toBe(markdown);
  });

  it("keeps fenced Markdown containing blank lines in one compatibility block", () => {
    const markdown = "```ts\nconst one = 1;\n\nconst two = 2;\n```";
    const body = articleBodyFromMarkdown(markdown);

    expect(body.blocks).toHaveLength(1);
    expect(body.blocks[0]).toMatchObject({ type: "richText", markdown });
    expect(articleMarkdownFromBody(body)).toBe(markdown);
  });

  it("generates stable block ids for repeated projections", () => {
    const markdown = "First paragraph.\n\nSecond paragraph.";
    expect(articleBodyFromMarkdown(markdown)).toEqual(articleBodyFromMarkdown(markdown));
  });
});
