export function applyNativeArticleValues(payload, values) {
  if (!payload || !Array.isArray(values)) return payload;
  const next = structuredClone(payload);
  const content = next.content || next;
  const byAlias = new Map(values.map((entry) => [entry.alias, entry.value]));
  if (byAlias.has("articleTitle")) content.title = String(byAlias.get("articleTitle") || "");
  if (byAlias.has("articleSummary")) content.summary = String(byAlias.get("articleSummary") || "");
  if (byAlias.has("articleTopics")) content.topics = normalizeTopics(byAlias.get("articleTopics"));
  if (byAlias.has("articleBody")) {
    const body = canonicalBodyFromRichText(byAlias.get("articleBody"));
    if (body) content.bodyBlocks = body;
  }
  return next;
}

export function nativeArticleFingerprint(values) {
  if (!Array.isArray(values)) return "";
  return JSON.stringify(
    ["articleTitle", "articleSummary", "articleBody", "articleTopics"].map((alias) => [
      alias,
      values.find((entry) => entry.alias === alias)?.value ?? null,
    ]),
  );
}

export function canonicalBodyFromRichText(raw) {
  const value = parseValue(raw);
  if (!value || typeof value.markup !== "string") return undefined;
  const mediaByKey = new Map(
    (value.blocks?.contentData || []).map((item) => [String(item.key || "").toLowerCase(), item]),
  );
  const document = new DOMParser().parseFromString(`<main>${value.markup}</main>`, "text/html");
  const root = document.body.firstElementChild;
  if (!root) return { version: 1, blocks: [] };

  const blocks = [];
  let prose = [];
  let ordinal = 0;
  const flushProse = () => {
    if (!prose.length) return;
    ordinal += 1;
    const markdown = normalizeMarkdown(prose.map(renderNode).join(""));
    const id = prose[0]?.getAttribute?.("data-usable-block-id") || stableId("text", markdown, ordinal);
    if (markdown) blocks.push({ id, type: "richText", markdown });
    prose = [];
  };

  for (const node of [...root.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) continue;
    const tag = node.nodeName.toLowerCase();
    if (tag === "umb-rte-block") {
      flushProse();
      const key = String(node.getAttribute("data-content-key") || "").toLowerCase();
      const media = mediaBlock(mediaByKey.get(key), key);
      if (media) blocks.push(media);
      continue;
    }

    const id = node.getAttribute?.("data-usable-block-id") || "";
    if (["h2", "h3", "h4"].includes(tag)) {
      flushProse();
      ordinal += 1;
      const text = node.textContent?.trim() || "";
      blocks.push({
        id: id || stableId("heading", text, ordinal),
        type: "heading",
        level: Number(tag.slice(1)),
        text,
      });
    } else if (tag === "ul" || tag === "ol") {
      flushProse();
      ordinal += 1;
      const items = [...node.children]
        .filter((child) => child.tagName === "LI")
        .map((child) => child.textContent?.trim() || "");
      blocks.push({
        id: id || stableId("list", items.join("\n"), ordinal),
        type: "list",
        style: tag === "ol" ? "ordered" : "unordered",
        items,
      });
    } else if (tag === "blockquote") {
      flushProse();
      ordinal += 1;
      const markdown = normalizeMarkdown([...node.childNodes].map(renderNode).join(""));
      blocks.push({
        id: id || stableId("quote", markdown, ordinal),
        type: "quote",
        markdown,
      });
    } else if (tag === "div" && id) {
      flushProse();
      ordinal += 1;
      blocks.push({
        id,
        type: "richText",
        markdown: normalizeMarkdown([...node.childNodes].map(renderNode).join("")),
      });
    } else {
      prose.push(node);
    }
  }
  flushProse();
  return { version: 1, blocks };
}

function mediaBlock(item, key) {
  if (!item) return undefined;
  const values = Object.fromEntries((item.values || []).map((entry) => [entry.alias, entry.value]));
  const id = String(values.usableBlockId || `media-${key.replaceAll("-", "")}`);
  return {
    id,
    type: "media",
    media: {
      id: String(values.assetId || id),
      type: values.mediaType === "video" ? "video" : "image",
      src: String(values.mediaSource || ""),
      alt: String(values.mediaAlt || ""),
      caption: String(values.mediaCaption || ""),
      placement: values.mediaPlacement === "hero" ? "hero" : "inline",
      alignment: ["wide", "left", "right"].includes(values.mediaAlignment)
        ? values.mediaAlignment
        : "center",
    },
  };
}

function renderNode(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const children = [...node.childNodes].map(renderNode).join("");
  switch (node.tagName) {
    case "H2": return `## ${children.trim()}\n\n`;
    case "H3": return `### ${children.trim()}\n\n`;
    case "H4": return `#### ${children.trim()}\n\n`;
    case "P": return `${children.trim()}\n\n`;
    case "STRONG":
    case "B": return `**${children}**`;
    case "EM":
    case "I": return `*${children}*`;
    case "CODE": return node.parentElement?.tagName === "PRE" ? children : `\`${children}\``;
    case "PRE": return `\`\`\`\n${node.textContent?.trimEnd() || ""}\n\`\`\`\n\n`;
    case "A": {
      const href = node.getAttribute("href") || "";
      return /^(?:https?:\/\/|mailto:|\/|#)/i.test(href) ? `[${children}](${href})` : children;
    }
    case "BR": return "\n";
    default: return children;
  }
}

function normalizeTopics(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return value.split(",").map((topic) => topic.trim()).filter(Boolean);
    }
  }
  return [];
}

function parseValue(raw) {
  if (raw && typeof raw === "object") return raw;
  try { return JSON.parse(String(raw || "")); } catch { return undefined; }
}

function normalizeMarkdown(value) {
  return String(value || "").trim().replace(/\n{3,}/g, "\n\n");
}

function stableId(kind, value, ordinal) {
  let hash = 2166136261;
  for (const character of `${kind}\0${value}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${kind}-${ordinal}-${hash.toString(16).padStart(8, "0")}`;
}
