import { mergeLegacyObjectIdentities } from "./collection-compatibility.js";

export const SELECTED_WORK_KEY_MODE = Object.freeze({
  legacyShadow: "legacy-shadow",
  managedV2: "managed-v2",
});

export function applyNativeHomeValues(
  payload,
  values,
  keyMode = SELECTED_WORK_KEY_MODE.legacyShadow,
  identityContract,
  knownProjectionIdentities,
) {
  if (!payload || !Array.isArray(values)) return payload;
  const nativeValue = values.find((entry) => entry.alias === "selectedWorkBlocks")?.value;
  if (nativeValue === undefined) return payload;
  const nativeSelectedWork = canonicalSelectedWorkFromNativeBlockList(nativeValue, keyMode);
  const current = (payload.content || payload)?.selectedWork;
  const selectedWork =
    keyMode === SELECTED_WORK_KEY_MODE.legacyShadow
      ? mergeLegacyObjectIdentities(current, nativeSelectedWork, {
          identityContract,
          knownProjectionIdentities,
        })
      : nativeSelectedWork;
  if (!selectedWork) return payload;
  const next = structuredClone(payload);
  const content = next.content || next;
  content.selectedWork = selectedWork;
  return next;
}

export function nativeHomeIdentityState(values) {
  if (!Array.isArray(values)) return new Map();
  const nativeValue = values.find((entry) => entry.alias === "selectedWorkBlocks")?.value;
  const items = canonicalSelectedWorkFromNativeBlockList(
    nativeValue,
    SELECTED_WORK_KEY_MODE.legacyShadow,
  );
  return new Map(
    (items || [])
      .filter(
        (item) => isUuid(item.__usableProjectionKey) && isUuid(item.__usableCanonicalId),
      )
      .map((item) => [item.__usableProjectionKey, item.__usableCanonicalId]),
  );
}

export function nativeHomeFingerprint(values) {
  if (!Array.isArray(values)) return "";
  return JSON.stringify(
    values.find((entry) => entry.alias === "selectedWorkBlocks")?.value ?? null,
  );
}

export function canonicalSelectedWorkFromNativeBlockList(
  raw,
  keyMode = SELECTED_WORK_KEY_MODE.legacyShadow,
) {
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
      ...(keyMode === SELECTED_WORK_KEY_MODE.managedV2
        ? { $id: String(item.key || layoutItem?.contentKey || "").toLowerCase() }
        : {}),
      ...(keyMode === SELECTED_WORK_KEY_MODE.legacyShadow && values.workCanonicalId
        ? { __usableCanonicalId: text(values.workCanonicalId).toLowerCase() }
        : {}),
      ...(keyMode === SELECTED_WORK_KEY_MODE.legacyShadow
        ? {
            __usableProjectionKey: String(
              item.key || layoutItem?.contentKey || "",
            ).toLowerCase(),
          }
        : {}),
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

function isUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}
