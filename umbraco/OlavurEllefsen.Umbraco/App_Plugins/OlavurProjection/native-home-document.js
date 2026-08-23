export function applyNativeHomeValues(payload, values) {
  if (!payload || !Array.isArray(values)) return payload;
  const nativeValue = values.find((entry) => entry.alias === "selectedWorkBlocks")?.value;
  if (nativeValue === undefined) return payload;
  const selectedWork = canonicalSelectedWorkFromNativeBlockList(nativeValue);
  if (!selectedWork) return payload;
  const next = structuredClone(payload);
  const content = next.content || next;
  content.selectedWork = selectedWork;
  return next;
}

export function nativeHomeFingerprint(values) {
  if (!Array.isArray(values)) return "";
  return JSON.stringify(
    values.find((entry) => entry.alias === "selectedWorkBlocks")?.value ?? null,
  );
}

export function canonicalSelectedWorkFromNativeBlockList(raw) {
  const value = parseValue(raw);
  const layout = value?.layout?.["Umbraco.BlockList"];
  const contentData = value?.contentData;
  if (!Array.isArray(layout) || !Array.isArray(contentData)) return undefined;

  const contentByKey = new Map(
    contentData
      .filter((item) => item && typeof item === "object" && item.key)
      .map((item) => [String(item.key).toLowerCase(), item]),
  );
  const selectedWork = [];
  for (const layoutItem of layout) {
    const item = contentByKey.get(String(layoutItem?.contentKey || "").toLowerCase());
    if (!item) continue;
    const values = Object.fromEntries(
      (Array.isArray(item.values) ? item.values : [])
        .filter((entry) => entry?.alias)
        .map((entry) => [entry.alias, entry.value]),
    );
    selectedWork.push({
      name: text(values.workName),
      role: text(values.workRole),
      description: text(values.workDescription),
      href: text(values.workHref),
      accent: normalizeAccent(values.workAccent),
    });
  }
  return selectedWork;
}

function parseValue(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function normalizeAccent(value) {
  const accent = text(value);
  return ["coral", "blue", "green", "yellow"].includes(accent) ? accent : "coral";
}

function text(value) {
  return value === undefined || value === null ? "" : String(value);
}
