import { describe, expect, it } from "vitest";
import {
  canonicalBodyFromNativeBlockList,
  nativeBlockListFingerprint,
} from "./native-article-blocks.js";

const key = "6e5f75c7-f39d-460d-8f83-c7c4f7de0eb3";

describe("native Umbraco Block List adapter", () => {
  it("preserves layout order while translating to portable bodyBlocks", () => {
    const value = {
      layout: {
        "Umbraco.BlockList": [
          { contentKey: "second" },
          { contentKey: key },
        ],
      },
      contentData: [
        {
          key,
          values: [
            { alias: "usableBlockId", value: "intro" },
            { alias: "headingText", value: "Introduction" },
            { alias: "headingLevel", value: "2" },
          ],
        },
        {
          key: "second",
          values: [
            { alias: "usableBlockId", value: "copy" },
            {
              alias: "textMarkdown",
              value: {
                markup: "<p>A <strong>formatted</strong> paragraph.</p>",
                blocks: { contentData: [], settingsData: [] },
              },
            },
          ],
        },
      ],
    };

    expect(canonicalBodyFromNativeBlockList(value)).toEqual({
      version: 1,
      blocks: [
        { id: "copy", type: "richText", markdown: "A **formatted** paragraph." },
        { id: "intro", type: "heading", level: 2, text: "Introduction" },
      ],
    });
  });

  it("accepts the serialized value returned by Umbraco", () => {
    const value = JSON.stringify({
      layout: { "Umbraco.BlockList": [{ contentKey: key }] },
      contentData: [
        {
          key,
          values: [
            { alias: "usableBlockId", value: "image-one" },
            { alias: "assetId", value: "usable-asset-one" },
            { alias: "mediaType", value: "image" },
            { alias: "mediaSource", value: "https://assets.example/image.webp" },
            { alias: "mediaAlt", value: "A useful description" },
            { alias: "mediaCaption", value: "Caption" },
            { alias: "mediaPlacement", value: "inline" },
            { alias: "mediaAlignment", value: "wide" },
          ],
        },
      ],
    });

    expect(canonicalBodyFromNativeBlockList(value)?.blocks[0]).toMatchObject({
      type: "media",
      media: { id: "usable-asset-one", alignment: "wide" },
    });
    expect(nativeBlockListFingerprint(value)).toBe(nativeBlockListFingerprint(JSON.parse(value)));
  });
});
