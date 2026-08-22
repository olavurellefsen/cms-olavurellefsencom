import {
  type ArticleMediaBlock,
  articleMediaDirective,
  parseArticleMarkdown,
} from "@/lib/content/article-media";
import type { ArticleBody, ArticleBodyBlock, ArticleContent } from "@/lib/content/schema";

export function articleBody(content: ArticleContent): ArticleBody {
  return content.bodyBlocks ?? articleBodyFromMarkdown(content.bodyMarkdown ?? "");
}

export function articleBodyFromMarkdown(markdown: string): ArticleBody {
  const blocks: ArticleBodyBlock[] = [];
  let ordinal = 0;

  for (const segment of parseArticleMarkdown(markdown)) {
    if (segment.type === "media") {
      blocks.push({ id: segment.value.id, type: "media", media: segment.value });
      continue;
    }

    for (const source of splitMarkdownSections(segment.value)) {
      ordinal += 1;
      blocks.push(markdownBlock(source, ordinal));
    }
  }

  return { version: 1, blocks };
}

export function articleMarkdownFromBody(body: ArticleBody): string {
  return body.blocks
    .map((block) => {
      switch (block.type) {
        case "heading":
          return `${"#".repeat(block.level)} ${block.text}`.trimEnd();
        case "richText":
          return block.markdown.trim();
        case "list":
          return block.items
            .map((item, index) =>
              block.style === "ordered" ? `${index + 1}. ${item}` : `- ${item}`,
            )
            .join("\n");
        case "quote":
          return block.markdown
            .split("\n")
            .map((line) => `> ${line.replace(/^>\s?/, "")}`)
            .join("\n");
        case "media":
          return articleMediaDirective(block.media);
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

export function firstArticleBodyHero(body: ArticleBody): ArticleMediaBlock | undefined {
  return body.blocks.find(
    (block): block is Extract<ArticleBodyBlock, { type: "media" }> =>
      block.type === "media" && block.media.placement === "hero",
  )?.media;
}

function markdownBlock(source: string, ordinal: number): ArticleBodyBlock {
  const value = source.trim();
  const heading = /^(#{2,4})\s+([\s\S]*)$/.exec(value);
  if (heading) {
    return {
      id: stableBlockId("heading", value, ordinal),
      type: "heading",
      level: heading[1].length as 2 | 3 | 4,
      text: heading[2],
    };
  }

  return {
    id: stableBlockId("text", value, ordinal),
    type: "richText",
    markdown: value,
  };
}

function splitMarkdownSections(markdown: string): string[] {
  const sections: string[] = [];
  let body: string[] = [];
  const flushBody = () => {
    if (body.length) sections.push(body.join("\n\n"));
    body = [];
  };

  for (const block of splitMarkdownBlocks(markdown)) {
    if (/^#{2,4}\s+/.test(block)) {
      flushBody();
      sections.push(block);
    } else {
      body.push(block);
    }
  }
  flushBody();
  return sections;
}

function splitMarkdownBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: "```" | "~~~" | undefined;

  const flush = () => {
    const value = current.join("\n").trim();
    if (value) blocks.push(value);
    current = [];
  };

  for (const line of markdown.split("\n")) {
    const marker = /^\s*(```|~~~)/.exec(line)?.[1] as "```" | "~~~" | undefined;
    if (!fence && marker) fence = marker;
    else if (fence && marker === fence) fence = undefined;

    if (!fence && !line.trim()) flush();
    else current.push(line);
  }
  flush();
  return blocks;
}

function stableBlockId(kind: string, value: string, ordinal: number): string {
  let hash = 2166136261;
  for (const character of `${kind}\u0000${value}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `block-${(hash >>> 0).toString(36)}-${ordinal}`;
}
