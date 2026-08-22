import { describe, expect, it } from "vitest";
import {
  applyNativeArticleValues,
  canonicalBodyFromRichText,
} from "./native-article-document.js";

describe("native Umbraco article document", () => {
  it("maps ordinary fields and one Tiptap flow back to the portable Usable contract", () => {
    const key = "7ef41bd9-9fbe-4634-a979-717450232540";
    const values = [
      { alias: "articleTitle", value: "Native title" },
      { alias: "articleSummary", value: "Native summary" },
      { alias: "articleTopics", value: '["Umbraco","Usable"]' },
      {
        alias: "articleBody",
        value: {
          markup: `<h2 data-usable-block-id="heading-one">Heading</h2><div data-usable-block-id="text-one"><p>Some <strong>text</strong>.</p></div><umb-rte-block data-content-key="${key}"></umb-rte-block>`,
          blocks: {
            contentData: [
              {
                key,
                values: [
                  { alias: "usableBlockId", value: "image-one" },
                  { alias: "assetId", value: "asset-one" },
                  { alias: "mediaType", value: "image" },
                  { alias: "mediaSource", value: "https://assets.example/image.webp" },
                  { alias: "mediaAlt", value: "An image" },
                  { alias: "mediaCaption", value: "Caption" },
                  { alias: "mediaPlacement", value: "inline" },
                  { alias: "mediaAlignment", value: "wide" },
                ],
              },
            ],
          },
        },
      },
    ];

    const result = applyNativeArticleValues(
      { id: "article-one", content: { type: "article" } },
      values,
    );

    expect(result.content).toMatchObject({
      title: "Native title",
      summary: "Native summary",
      topics: ["Umbraco", "Usable"],
    });
    expect(result.content.bodyBlocks.blocks).toEqual([
      { id: "heading-one", type: "heading", level: 2, text: "Heading" },
      { id: "text-one", type: "richText", markdown: "Some **text**." },
      {
        id: "image-one",
        type: "media",
        media: {
          id: "asset-one",
          type: "image",
          src: "https://assets.example/image.webp",
          alt: "An image",
          caption: "Caption",
          placement: "inline",
          alignment: "wide",
        },
      },
    ]);
  });

  it("groups pasted paragraphs into a single portable rich-text block", () => {
    const body = canonicalBodyFromRichText({
      markup: "<p>One.</p><p>Two.</p>",
      blocks: { contentData: [] },
    });

    expect(body.blocks).toHaveLength(1);
    expect(body.blocks[0]).toMatchObject({ type: "richText", markdown: "One.\n\nTwo." });
  });
});
