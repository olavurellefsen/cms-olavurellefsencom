import { describe, expect, it } from "vitest";
import {
  describeMarkdownBlock,
  inlineHtmlToMarkdown,
  inlineMarkdownToHtml,
  joinArticleEditorBlocks,
  splitArticleEditorBlocks,
} from "./article-blocks.js";

describe("Umbraco article block model", () => {
  it("keeps hidden metadata and media in the ordered block stream", () => {
    const mediaDirective = "<!-- usable-media:test -->";
    const markdown = [
      "## Introduction",
      "First paragraph.",
      "<!-- private-note -->",
      mediaDirective,
      "> A quotation",
    ].join("\n\n");

    const blocks = splitArticleEditorBlocks(markdown, (value) =>
      value === mediaDirective ? { id: "test", type: "image" } : undefined,
    );

    expect(blocks.map((block) => block.type)).toEqual([
      "markdown",
      "markdown",
      "markdown",
      "media",
      "markdown",
    ]);
    expect(joinArticleEditorBlocks(blocks, () => mediaDirective)).toBe(markdown);
  });

  it("describes structured text without exposing block-level Markdown controls", () => {
    expect(describeMarkdownBlock("### Plain heading")).toEqual({
      kind: "Heading",
      level: 3,
      text: "Plain heading",
    });
    expect(describeMarkdownBlock("- One\n- Two")).toEqual({
      kind: "List",
      style: "unordered",
      text: "One\nTwo",
    });
    expect(describeMarkdownBlock("> One\n> Two")).toEqual({
      kind: "Quote",
      text: "One\nTwo",
    });
  });

  it("supports deterministic reordering by array position", () => {
    const blocks = splitArticleEditorBlocks("First\n\nSecond\n\nThird");
    const [second] = blocks.splice(1, 1);
    blocks.splice(0, 0, second);

    expect(joinArticleEditorBlocks(blocks, () => "")).toBe(
      "Second\n\nFirst\n\nThird",
    );
  });

  it("round-trips common inline formatting without exposing Markdown markers", () => {
    const markdown =
      "A **bold** and *careful* [link](https://example.com) with `code`.";
    const html = inlineMarkdownToHtml(markdown);

    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>careful</em>");
    expect(html).toContain('<a href="https://example.com">link</a>');
    expect(inlineHtmlToMarkdown(html)).toBe(markdown);
  });

  it("drops unsafe rich-text links during serialization", () => {
    expect(inlineHtmlToMarkdown('<a href="javascript:alert(1)">Unsafe</a>')).toBe(
      "Unsafe",
    );
  });
});
