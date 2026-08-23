const accentColors = {
  blue: "#596fb0",
  coral: "#d96f56",
  green: "#4f8a6b",
  yellow: "#c69a22",
};

export function selectedWorkCard(content) {
  const value = normalizeSelectedWorkContent(content);
  const accent = normalizeAccent(value.workAccent);
  return {
    name: clean(value.workName) || "Untitled work item",
    role: clean(value.workRole) || "Role not set",
    description: clean(value.workDescription) || "No description yet.",
    href: clean(value.workHref),
    linkLabel: linkLabel(value.workHref),
    accent,
    accentColor: accentColors[accent],
  };
}

export function normalizeSelectedWorkContent(content) {
  if (Array.isArray(content)) {
    return Object.fromEntries(
      content
        .filter((entry) => entry && typeof entry === "object" && typeof entry.alias === "string")
        .map((entry) => [entry.alias, entry.value]),
    );
  }
  return content && typeof content === "object" ? content : {};
}

function normalizeAccent(value) {
  const accent = clean(value).toLowerCase();
  return Object.hasOwn(accentColors, accent) ? accent : "blue";
}

function linkLabel(value) {
  const href = clean(value);
  if (!href) return "No link set";
  try {
    const url = new URL(href);
    return url.hostname.replace(/^www\./, "") || href;
  } catch {
    return href;
  }
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
