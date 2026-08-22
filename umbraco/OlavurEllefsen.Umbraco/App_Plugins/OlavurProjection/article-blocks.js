export function splitArticleEditorBlocks(markdown, decodeMediaBlock = () => undefined) {
  const blocks = [];
  const separator = /\n[\t ]*\n+/g;
  let cursor = 0;
  const addBlock = (raw, start) => {
    if (!raw) return;
    const leading = raw.length - raw.trimStart().length;
    const trailing = raw.length - raw.trimEnd().length;
    const value = raw.trim();
    if (!value) return;
    const media = decodeMediaBlock(value);
    blocks.push({
      type: media ? "media" : "markdown",
      value: media || value,
      start: start + leading,
      end: start + raw.length - trailing,
    });
  };
  for (const match of markdown.matchAll(separator)) {
    addBlock(markdown.slice(cursor, match.index), cursor);
    cursor = (match.index ?? cursor) + match[0].length;
  }
  addBlock(markdown.slice(cursor), cursor);
  return blocks;
}

export function joinArticleEditorBlocks(blocks, encodeMediaBlock) {
  return blocks
    .map((block) =>
      block.type === "media" ? encodeMediaBlock(block.value) : String(block.value).trim(),
    )
    .filter(Boolean)
    .join("\n\n");
}

export function describeMarkdownBlock(markdown) {
  const value = String(markdown || "").trim();
  const heading = /^(#{2,4})\s+([\s\S]*)$/.exec(value);
  if (heading) {
    return { kind: "Heading", level: heading[1].length, text: heading[2] };
  }
  if (/^<!--[\s\S]*-->$/.test(value)) {
    return { kind: "Hidden metadata", text: value };
  }
  const lines = value.split("\n");
  if (lines.length && lines.every((line) => /^\s*>/.test(line))) {
    return {
      kind: "Quote",
      text: lines.map((line) => line.replace(/^\s*>\s?/, "")).join("\n"),
    };
  }
  const unordered = lines.length && lines.every((line) => /^\s*[-*+]\s+/.test(line));
  const ordered = lines.length && lines.every((line) => /^\s*\d+\.\s+/.test(line));
  if (unordered || ordered) {
    return {
      kind: "List",
      style: ordered ? "ordered" : "unordered",
      text: lines
        .map((line) => line.replace(/^\s*(?:[-*+] |\d+\.\s+)/, ""))
        .join("\n"),
    };
  }
  return { kind: "Text", text: value };
}

export function inlineMarkdownToHtml(markdown) {
  return escapeHtml(String(markdown || ""))
    .replace(/\[([^\]]+)]\(((?:https?:\/\/|\/)[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\n/g, "<br>");
}

export function inlineHtmlToMarkdown(html) {
  const document = new DOMParser().parseFromString(`<div>${String(html || "")}</div>`, "text/html");
  const root = document.body.firstElementChild;
  if (!root) return "";

  const visit = (node) => {
    if (node.nodeType === 3) return node.nodeValue || "";
    if (node.nodeType !== 1) return "";
    const element = node;
    const children = [...element.childNodes].map(visit).join("");
    switch (element.tagName) {
      case "STRONG":
      case "B":
        return `**${children}**`;
      case "EM":
      case "I":
        return `*${children}*`;
      case "CODE":
        return `\`${children}\``;
      case "A": {
        const href = element.getAttribute("href") || "";
        return /^(?:https?:\/\/|\/)/i.test(href) ? `[${children}](${href})` : children;
      }
      case "BR":
        return "\n";
      case "DIV":
      case "P":
        return node === root ? children : `${children}\n`;
      default:
        return children;
    }
  };

  return visit(root).replace(/\n{3,}/g, "\n\n").trimEnd();
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
