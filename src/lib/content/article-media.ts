export type ArticleMediaType = "image" | "video";
export type ArticleMediaPlacement = "hero" | "inline";
export type ArticleMediaAlignment = "wide" | "center" | "left" | "right";

export type ArticleMediaBlock = {
  id: string;
  type: ArticleMediaType;
  src: string;
  alt: string;
  caption: string;
  placement: ArticleMediaPlacement;
  alignment: ArticleMediaAlignment;
};

export type ArticleMarkdownSegment =
  | { type: "markdown"; value: string }
  | { type: "media"; value: ArticleMediaBlock };

const mediaDirectivePattern = /<!--\s*usable-media:([^\s]+)\s*-->/g;

export function articleMediaDirective(media: ArticleMediaBlock): string {
  return `<!-- usable-media:${encodeURIComponent(JSON.stringify(normalizeArticleMedia(media)))} -->`;
}

export function parseArticleMarkdown(markdown: string): ArticleMarkdownSegment[] {
  const segments: ArticleMarkdownSegment[] = [];
  let cursor = 0;
  for (const match of markdown.matchAll(mediaDirectivePattern)) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ type: "markdown", value: markdown.slice(cursor, index) });
    const media = decodeArticleMedia(match[1]);
    if (media) segments.push({ type: "media", value: media });
    else segments.push({ type: "markdown", value: match[0] });
    cursor = index + match[0].length;
  }
  if (cursor < markdown.length) segments.push({ type: "markdown", value: markdown.slice(cursor) });
  return segments;
}

export function articleMediaBlocks(markdown: string): ArticleMediaBlock[] {
  return parseArticleMarkdown(markdown)
    .filter(
      (segment): segment is Extract<ArticleMarkdownSegment, { type: "media" }> =>
        segment.type === "media",
    )
    .map((segment) => segment.value);
}

export function articleBodyInsertionPoints(markdown: string): number[] {
  const points: number[] = [];
  const pieces = markdown.split(/(\n[\t ]*\n+)/);
  let offset = 0;

  for (const piece of pieces) {
    if (!piece || /^\n[\t ]*\n+$/.test(piece)) {
      offset += piece.length;
      continue;
    }

    const trailingWhitespace = piece.length - piece.trimEnd().length;
    const value = piece.trim();
    const blockEnd = offset + piece.length - trailingWhitespace;
    const parsed = parseArticleMarkdown(value);
    const media = parsed.length === 1 && parsed[0]?.type === "media" ? parsed[0].value : undefined;
    const hiddenComment = /^<!--[\s\S]*-->$/.test(value);

    if (media?.placement === "inline" || (value && !hiddenComment && media?.placement !== "hero")) {
      points.push(blockEnd);
    }

    offset += piece.length;
  }

  return points;
}

export function articleMarkdownForEditor(markdown: string): string {
  let index = 0;
  return markdown.replace(mediaDirectivePattern, (directive, encoded: string) => {
    const media = decodeArticleMedia(encoded);
    if (!media) return directive;
    index += 1;
    const label = (
      media.caption ||
      media.alt ||
      (media.type === "image" ? "Untitled image" : "Untitled video")
    )
      .replace(/[{}\n]+/g, " ")
      .trim();
    return `{{media:${index} · ${media.type === "image" ? "Image" : "Video"} · ${label}}}`;
  });
}

export function articleMarkdownFromEditor(
  markdown: string,
  mediaBlocks: ArticleMediaBlock[],
): string {
  return markdown.replace(/\{\{media:(\d+)(?:\s*·[^}]*)?}}/g, (marker, rawIndex: string) => {
    const media = mediaBlocks[Number(rawIndex) - 1];
    return media ? articleMediaDirective(media) : marker;
  });
}

export function firstArticleHeroMedia(markdown: string): ArticleMediaBlock | undefined {
  return articleMediaBlocks(markdown).find((media) => media.placement === "hero");
}

export function insertArticleMedia(
  markdown: string,
  media: ArticleMediaBlock,
  index = markdown.length,
): string {
  const next = ensureSingleHero(markdown, media);
  const insertionPoint = Math.max(0, Math.min(index, next.length));
  const before = next.slice(0, insertionPoint).trimEnd();
  const after = next.slice(insertionPoint).trimStart();
  return [before, articleMediaDirective(media), after].filter(Boolean).join("\n\n");
}

export function insertArticleMediaAtEditorPosition(
  markdown: string,
  media: ArticleMediaBlock,
  index: number,
): string {
  const normalized = insertArticleMedia(markdown, media);
  const blocks = articleMediaBlocks(normalized);
  const editorMarkdown = articleMarkdownForEditor(markdown);
  const insertionPoint = Math.max(0, Math.min(index, editorMarkdown.length));
  const before = editorMarkdown.slice(0, insertionPoint).trimEnd();
  const after = editorMarkdown.slice(insertionPoint).trimStart();
  const markerIndex = blocks.findIndex((candidate) => candidate.id === media.id) + 1;
  const label = (
    media.caption ||
    media.alt ||
    (media.type === "image" ? "Untitled image" : "Untitled video")
  )
    .replace(/[{}\n]+/g, " ")
    .trim();
  const marker = `{{media:${markerIndex} · ${media.type === "image" ? "Image" : "Video"} · ${label}}}`;
  const withMarker = [before, marker, after].filter(Boolean).join("\n\n");
  return articleMarkdownFromEditor(withMarker, blocks);
}

export function replaceArticleMedia(markdown: string, media: ArticleMediaBlock): string {
  const next = ensureSingleHero(markdown, media);
  return next.replace(mediaDirectivePattern, (directive, encoded: string) => {
    const current = decodeArticleMedia(encoded);
    return current?.id === media.id ? articleMediaDirective(media) : directive;
  });
}

export function removeArticleMedia(markdown: string, mediaId: string): string {
  return markdown
    .replace(mediaDirectivePattern, (directive, encoded: string) => {
      const current = decodeArticleMedia(encoded);
      return current?.id === mediaId ? "" : directive;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function renderArticleMarkdownPreview(
  markdown: string,
  placement: ArticleMediaPlacement = "inline",
): string {
  return parseArticleMarkdown(markdown)
    .map((segment) => {
      if (segment.type === "markdown") return renderMarkdownBlocks(segment.value);
      return segment.value.placement === placement ? renderArticleMediaPreview(segment.value) : "";
    })
    .join("");
}

export function renderArticleMediaPreview(media: ArticleMediaBlock): string {
  const source = escapeHtml(media.src);
  const caption = media.caption
    ? `<figcaption>${renderInlineMarkdown(media.caption)}</figcaption>`
    : "";
  const content =
    media.type === "video"
      ? `<video src="${source}" controls playsinline preload="metadata" aria-label="${escapeHtml(media.alt || media.caption || "Article video")}"></video>`
      : `<img src="${source}" alt="${escapeHtml(media.alt)}" />`;
  return `<figure class="article-media article-media--${media.alignment}" data-article-media-id="${escapeHtml(media.id)}" data-article-media-directive="${escapeHtml(articleMediaDirective(media))}" contenteditable="false">${content}${caption}</figure>`;
}

function ensureSingleHero(markdown: string, media: ArticleMediaBlock): string {
  if (media.placement !== "hero") return markdown;
  return markdown.replace(mediaDirectivePattern, (directive, encoded: string) => {
    const current = decodeArticleMedia(encoded);
    if (!current || current.id === media.id || current.placement !== "hero") return directive;
    return articleMediaDirective({ ...current, placement: "inline" });
  });
}

function decodeArticleMedia(encoded: string): ArticleMediaBlock | undefined {
  try {
    const parsed = JSON.parse(decodeURIComponent(encoded)) as Partial<ArticleMediaBlock>;
    if (!parsed || typeof parsed !== "object") return undefined;
    if (typeof parsed.id !== "string" || !/^[a-zA-Z0-9_-]{3,100}$/.test(parsed.id))
      return undefined;
    if (parsed.type !== "image" && parsed.type !== "video") return undefined;
    if (typeof parsed.src !== "string" || !isSafeMediaUrl(parsed.src)) return undefined;
    return normalizeArticleMedia({
      id: parsed.id,
      type: parsed.type,
      src: parsed.src,
      alt: typeof parsed.alt === "string" ? parsed.alt : "",
      caption: typeof parsed.caption === "string" ? parsed.caption : "",
      placement: parsed.placement === "hero" ? "hero" : "inline",
      alignment: ["wide", "left", "right"].includes(parsed.alignment || "")
        ? (parsed.alignment as ArticleMediaAlignment)
        : "center",
    });
  } catch {
    return undefined;
  }
}

function normalizeArticleMedia(media: ArticleMediaBlock): ArticleMediaBlock {
  return {
    id: media.id,
    type: media.type,
    src: media.src.trim(),
    alt: media.alt.trim(),
    caption: media.caption.trim(),
    placement: media.placement,
    alignment: media.alignment,
  };
}

function isSafeMediaUrl(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("/") || /^https?:\/\//i.test(trimmed);
}

function renderMarkdownBlocks(markdown: string): string {
  return markdown
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const value = block.trim();
      if (!value || /^<!--[\s\S]*-->$/.test(value)) return "";
      if (value.startsWith("### ")) return `<h3>${renderInlineMarkdown(value.slice(4))}</h3>`;
      if (value.startsWith("## ")) return `<h2>${renderInlineMarkdown(value.slice(3))}</h2>`;
      const lines = value.split("\n");
      if (lines.every((line) => /^[-*] /.test(line))) {
        return `<ul>${lines.map((line) => `<li>${renderInlineMarkdown(line.slice(2))}</li>`).join("")}</ul>`;
      }
      if (lines.every((line) => /^\d+\. /.test(line))) {
        return `<ol>${lines.map((line) => `<li>${renderInlineMarkdown(line.replace(/^\d+\. /, ""))}</li>`).join("")}</ol>`;
      }
      if (lines.every((line) => /^> ?/.test(line))) {
        return `<blockquote>${lines.map((line) => renderInlineMarkdown(line.replace(/^> ?/, ""))).join("<br />")}</blockquote>`;
      }
      return `<p>${lines.map(renderInlineMarkdown).join("<br />")}</p>`;
    })
    .join("");
}

function renderInlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)]\(((?:https?:\/\/|mailto:|\/|#)[^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] || character;
  });
}
