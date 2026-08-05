import { describe, expect, it } from "vitest";
import {
  type ArticleMediaBlock,
  articleMarkdownForEditor,
  articleMarkdownFromEditor,
  articleMediaBlocks,
  articleMediaDirective,
  insertArticleMedia,
  insertArticleMediaAtEditorPosition,
  parseArticleMarkdown,
  removeArticleMedia,
  renderArticleMarkdownPreview,
  replaceArticleMedia,
} from "./article-media";

const image: ArticleMediaBlock = {
  id: "media-lake",
  type: "image",
  src: "https://cms.usable.dev/api/sites/site/assets/lake",
  alt: "A lake below a Faroese mountain",
  caption: "The list begins here.",
  placement: "inline",
  alignment: "wide",
};

describe("article media directives", () => {
  it("round-trips media metadata without exposing JSON as prose", () => {
    const markdown = `Opening paragraph.\n\n${articleMediaDirective(image)}\n\nClosing paragraph.`;

    expect(articleMediaBlocks(markdown)).toEqual([image]);
    expect(parseArticleMarkdown(markdown)).toEqual([
      { type: "markdown", value: "Opening paragraph.\n\n" },
      { type: "media", value: image },
      { type: "markdown", value: "\n\nClosing paragraph." },
    ]);
  });

  it("keeps one hero and supports editing and removal", () => {
    const first = { ...image, id: "media-first", placement: "hero" as const };
    const second = { ...image, id: "media-second", placement: "hero" as const };
    const withFirst = insertArticleMedia("Body", first, 0);
    const withSecond = insertArticleMedia(withFirst, second, withFirst.length);

    expect(articleMediaBlocks(withSecond)).toMatchObject([
      { id: "media-first", placement: "inline" },
      { id: "media-second", placement: "hero" },
    ]);

    const edited = replaceArticleMedia(withSecond, { ...second, caption: "Updated caption" });
    expect(articleMediaBlocks(edited)[1]?.caption).toBe("Updated caption");
    expect(articleMediaBlocks(removeArticleMedia(edited, "media-first"))).toEqual([
      { ...second, caption: "Updated caption" },
    ]);
  });

  it("shows readable media markers while preserving encoded directives", () => {
    const stored = `Before\n\n${articleMediaDirective(image)}\n\nAfter`;
    const editorValue = articleMarkdownForEditor(stored);
    expect(editorValue).toBe("Before\n\n{{media:1 · Image · The list begins here.}}\n\nAfter");
    expect(articleMarkdownFromEditor(editorValue, [image])).toBe(stored);

    const inserted = insertArticleMediaAtEditorPosition("Before\n\nAfter", image, 6);
    expect(articleMarkdownForEditor(inserted)).toBe(
      "Before\n\n{{media:1 · Image · The list begins here.}}\n\nAfter",
    );
  });

  it("renders useful draft formatting, captions, and video controls", () => {
    const video: ArticleMediaBlock = {
      ...image,
      id: "media-video",
      type: "video",
      src: "https://cms.usable.dev/video.mp4",
      caption: "Ten seconds beside the water.",
      alignment: "right",
    };
    const html = renderArticleMarkdownPreview(
      `## Lake test\n\nA **bold** idea with [context](https://example.com).\n\n- One\n- Two\n\n${articleMediaDirective(video)}`,
    );

    expect(html).toContain("<h2>Lake test</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<a href="https://example.com">context</a>');
    expect(html).toContain("<ul><li>One</li><li>Two</li></ul>");
    expect(html).toContain('<video src="https://cms.usable.dev/video.mp4" controls');
    expect(html).toContain("Ten seconds beside the water.");
    expect(html).toContain("article-media--right");
  });

  it("leaves malformed or unsafe directives inert", () => {
    const unsafe = `<!-- usable-media:${encodeURIComponent(
      JSON.stringify({ ...image, src: "javascript:alert(1)" }),
    )} -->`;

    expect(articleMediaBlocks(unsafe)).toEqual([]);
    expect(renderArticleMarkdownPreview(unsafe)).toBe("");
  });
});
