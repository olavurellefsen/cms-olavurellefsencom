export type CompatibleCollection = {
  fields?: Array<{ path?: string }>;
  itemIdentity?: string;
  itemIdentityPath?: string;
  pageId?: string;
  path: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Exposes a manifest-v2 fragment through the site's unchanged public/legacy shape.
 * The source is never mutated: stable object identities are omitted and wrapped
 * scalar collections are unwrapped to their former scalar arrays.
 */
export function legacyContentView(
  source: unknown,
  collections: readonly CompatibleCollection[],
  pageId?: string,
): unknown {
  const result = clone(source);
  const pageCollections = pageId
    ? collections.filter((collection) => collection.pageId === pageId)
    : collections;
  const applicable = pageCollections.length
    ? pageCollections
    : [...new Map(collections.map((collection) => [collection.path, collection])).values()];
  for (const collection of applicable) {
    const items = valueAt(result, collection.path);
    if (!Array.isArray(items)) continue;
    setAt(result, collection.path, legacyCollectionView(items, collection));
  }
  return result;
}

export function legacyCollectionView(
  items: readonly unknown[],
  collection: CompatibleCollection,
): unknown[] {
  const scalarValuePath = scalarWrapperPath(collection);
  if (scalarValuePath) {
    return items.map((item) =>
      isRecord(item) && valueAt(item, scalarValuePath) !== undefined
        ? clone(valueAt(item, scalarValuePath))
        : clone(item),
    );
  }

  const identityPath = collection.itemIdentityPath;
  return items.map((item) => {
    const copy = clone(item);
    if (identityPath && isRecord(copy)) deleteAt(copy, identityPath);
    return copy;
  });
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export function hasStableCollectionIdentity(
  items: readonly unknown[],
  identityPath: string,
): boolean {
  const identities = items.map((item) => valueAt(item, identityPath));
  return identities.every(isUuid) && new Set(identities).size === identities.length;
}

export function ensureStableCollectionIdentity<T extends Record<string, unknown>>(
  item: T,
  identityPath: string,
  createUuid: () => string = () => globalThis.crypto.randomUUID(),
): T {
  const copy = clone(item);
  if (!isUuid(valueAt(copy, identityPath))) setAt(copy, identityPath, createUuid());
  return copy;
}

export function stableCollectionItemKey(item: unknown, identityPath: string): string | undefined {
  const identity = valueAt(item, identityPath);
  return isUuid(identity) ? identity : undefined;
}

export function requiresStableCollectionCommands(collection: CompatibleCollection): boolean {
  return collection.itemIdentity === "stable-id";
}

function scalarWrapperPath(collection: CompatibleCollection): string | undefined {
  return collection.fields?.length === 1 && collection.fields[0]?.path === "$value"
    ? "$value"
    : undefined;
}

function valueAt(source: unknown, path: string): unknown {
  let value = source;
  for (const segment of path.split(".")) {
    if (!isRecord(value)) return undefined;
    value = value[segment];
  }
  return value;
}

function setAt(source: unknown, path: string, value: unknown): void {
  if (!isRecord(source)) return;
  const segments = path.split(".");
  let target = source;
  for (const segment of segments.slice(0, -1)) {
    if (!isRecord(target[segment])) target[segment] = {};
    target = target[segment] as Record<string, unknown>;
  }
  target[segments.at(-1) || path] = value;
}

function deleteAt(source: Record<string, unknown>, path: string): void {
  const segments = path.split(".");
  let target = source;
  for (const segment of segments.slice(0, -1)) {
    if (!isRecord(target[segment])) return;
    target = target[segment] as Record<string, unknown>;
  }
  delete target[segments.at(-1) || path];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}
