import { describe, expect, it } from "vitest";
import { COLLECTION_IDENTITY_CONTRACT } from "./collection-compatibility.js";
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
      COLLECTION_IDENTITY_CONTRACT.stableId,
    );

    expect(result.content).toMatchObject({
      title: "Native title",
      summary: "Native summary",
    });
    expect(result.content.topics.map((topic) => topic.$value)).toEqual(["Umbraco", "Usable"]);
    expect(result.content.topics.every((topic) => /^[0-9a-f-]{36}$/.test(topic.$id))).toBe(true);
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

  it("preserves wrapped topic identities while exposing the native scalar editor", () => {
    const payload = {
      content: {
        type: "article",
        topics: [
          { $id: "11111111-1111-4111-8111-111111111111", $value: "Usable" },
          { $id: "22222222-2222-4222-8222-222222222222", $value: "Umbraco" },
        ],
      },
    };

    const result = applyNativeArticleValues(payload, [
      { alias: "articleTopics", value: '["Umbraco","Usable"]' },
    ], COLLECTION_IDENTITY_CONTRACT.stableId);

    expect(result.content.topics).toEqual([
      { $id: "22222222-2222-4222-8222-222222222222", $value: "Umbraco" },
      { $id: "11111111-1111-4111-8111-111111111111", $value: "Usable" },
    ]);
    expect(payload.content.topics[0].$value).toBe("Usable");
  });

  it("creates a stable ID when an empty topic collection receives its first native value", () => {
    const result = applyNativeArticleValues(
      { content: { type: "article", topics: [] } },
      [{ alias: "articleTopics", value: '["First"]' }],
      COLLECTION_IDENTITY_CONTRACT.stableId,
    );

    expect(result.content.topics[0]).toMatchObject({ $value: "First" });
    expect(result.content.topics[0].$id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
