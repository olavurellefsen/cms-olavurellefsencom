export function nativeBlockListFingerprint(value) {
  return JSON.stringify(normalizeNativeValue(value));
}

export function canonicalBodyFromNativeBlockList(value) {
  const parsed = normalizeNativeValue(value);
  const layout = parsed?.layout?.["Umbraco.BlockList"];
  const contentData = parsed?.contentData;
  if (!Array.isArray(layout) || !Array.isArray(contentData)) return undefined;

  const contentByKey = new Map(
    contentData
      .filter((item) => item && typeof item === "object" && item.key)
      .map((item) => [String(item.key).toLowerCase(), item]),
  );
  const blocks = [];
  for (const layoutItem of layout) {
    const content = contentByKey.get(String(layoutItem?.contentKey || "").toLowerCase());
    if (!content) continue;
    const values = Object.fromEntries(
      (Array.isArray(content.values) ? content.values : [])
        .filter((item) => item?.alias)
        .map((item) => [item.alias, item.value]),
    );
    const block = canonicalBlock(values, content.key);
    if (block) blocks.push(block);
  }
  return { version: 1, blocks };
}

function canonicalBlock(values, contentKey) {
  const id = text(values.usableBlockId) || `block-${String(contentKey).replaceAll("-", "")}`;
  if ("headingText" in values) {
    const level = Math.max(2, Math.min(4, Number(values.headingLevel) || 2));
    return { id, type: "heading", level, text: text(values.headingText) };
  }
  if ("textMarkdown" in values) {
    return { id, type: "richText", markdown: richTextMarkdown(values.textMarkdown) };
  }
  if ("listItems" in values) {
    return {
      id,
      type: "list",
      style: values.listStyle === "ordered" ? "ordered" : "unordered",
      items: text(values.listItems).split("\n").map((item) => item.trimEnd()),
    };
  }
  if ("quoteMarkdown" in values) {
    return { id, type: "quote", markdown: text(values.quoteMarkdown) };
  }
  if ("mediaSource" in values) {
    const alignment = ["wide", "left", "right"].includes(values.mediaAlignment)
      ? values.mediaAlignment
      : "center";
    return {
      id,
      type: "media",
      media: {
        id: text(values.assetId) || id,
        type: values.mediaType === "video" ? "video" : "image",
        src: text(values.mediaSource),
        alt: text(values.mediaAlt),
        caption: text(values.mediaCaption),
        placement: values.mediaPlacement === "hero" ? "hero" : "inline",
        alignment,
      },
    };
  }
  return undefined;
}

function normalizeNativeValue(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function text(value) {
  return value === undefined || value === null ? "" : String(value);
}

function richTextMarkdown(value) {
  let candidate = value;
  if (typeof candidate === "string" && candidate.trim().startsWith("{")) {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return candidate;
    }
  }
  if (!candidate || typeof candidate !== "object" || typeof candidate.markup !== "string") {
    return text(candidate);
  }
  const document = new DOMParser().parseFromString(`<div>${candidate.markup}</div>`, "text/html");
  const root = document.body.firstElementChild;
  if (!root) return "";
  return [...root.childNodes]
    .map(renderHtmlNode)
    .join("")
    .trim()
    .replace(/\n[\t ]*\n(?:[\t ]*\n)+/g, "\n\n");
}

function renderHtmlNode(node) {
  if (node.nodeType === 3) return node.nodeValue || "";
  if (node.nodeType !== 1) return "";
  const element = node;
  const children = [...element.childNodes].map(renderHtmlNode).join("");
  switch (element.tagName) {
    case "H2":
      return `## ${children.trim()}\n\n`;
    case "H3":
      return `### ${children.trim()}\n\n`;
    case "H4":
      return `#### ${children.trim()}\n\n`;
    case "P":
      return `${children.trim()}\n\n`;
    case "STRONG":
    case "B":
      return `**${children}**`;
    case "EM":
    case "I":
      return `*${children}*`;
    case "CODE":
      return element.parentElement?.tagName === "PRE" ? children : `\`${children}\``;
    case "PRE":
      return `\`\`\`\n${element.textContent.trimEnd()}\n\`\`\`\n\n`;
    case "A": {
      const href = element.getAttribute("href") || "";
      return /^(?:https?:\/\/|mailto:|\/|#)/i.test(href) ? `[${children}](${href})` : children;
    }
    case "BR":
      return "\n";
    case "BLOCKQUOTE":
      return `${children
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n\n`;
    case "UL":
    case "OL":
      return `${[...element.children]
        .filter((child) => child.tagName === "LI")
        .map((child, index) => {
          const marker = element.tagName === "OL" ? `${index + 1}.` : "-";
          return `${marker} ${[...child.childNodes].map(renderHtmlNode).join("").trim()}`;
        })
        .join("\n")}\n\n`;
    default:
      return children;
  }
}
