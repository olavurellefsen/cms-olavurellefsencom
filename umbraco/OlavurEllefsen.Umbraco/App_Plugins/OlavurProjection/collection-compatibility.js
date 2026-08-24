export const COLLECTION_IDENTITY_CONTRACT = Object.freeze({
  legacy: "legacy",
  stableId: "stable-id",
});

export function legacyScalarValues(items, valuePath = "$value") {
  if (!Array.isArray(items)) return [];
  return items.map((item) =>
    item && typeof item === "object" && !Array.isArray(item) && valuePath in item
      ? item[valuePath]
      : item,
  );
}

export function mergeLegacyScalarValues(
  canonicalItems,
  legacyValues,
  {
    identityContract,
    identityPath = "$id",
    valuePath = "$value",
    createUuid = () => crypto.randomUUID(),
  } = {},
) {
  if (!Array.isArray(legacyValues)) return canonicalItems;
  const existing = Array.isArray(canonicalItems) ? canonicalItems : [];
  assertIdentityContract(identityContract);
  if (identityContract === COLLECTION_IDENTITY_CONTRACT.legacy) {
    return structuredClone(legacyValues);
  }
  assertManagedIdentities(existing, identityPath, "scalar collection");

  const consumed = new Set();
  const matches = legacyValues.map((value) => {
    const matchIndex = existing.findIndex(
      (item, candidateIndex) =>
        !consumed.has(candidateIndex) &&
        isObject(item) &&
        item[valuePath] === value,
    );
    if (matchIndex >= 0) consumed.add(matchIndex);
    return matchIndex;
  });
  const unmatchedValues = matches.flatMap((matchIndex, index) => (matchIndex < 0 ? [index] : []));
  const unmatchedExisting = existing.flatMap((_, index) => (!consumed.has(index) ? [index] : []));
  if (unmatchedValues.length && unmatchedExisting.length) {
    if (unmatchedValues.length !== 1 || unmatchedExisting.length !== 1) {
      throw new Error(
        "Ambiguous scalar collection edit: save one renamed value at a time or use stable-ID commands.",
      );
    }
    matches[unmatchedValues[0]] = unmatchedExisting[0];
  }
  return legacyValues.map((value, index) => {
    const matchIndex = matches[index];
    const matched = existing[matchIndex];
    const identity =
      isObject(matched) ? matched[identityPath] : undefined;
    return {
      ...(isObject(matched) ? matched : {}),
      [identityPath]: isUuid(identity) ? identity : createUuid(),
      [valuePath]: value,
    };
  });
}

export function mergeLegacyObjectIdentities(
  canonicalItems,
  legacyItems,
  {
    identityPath = "$id",
    metadataPath = "__usableCanonicalId",
    projectionKeyPath = "__usableProjectionKey",
    knownProjectionIdentities,
    identityContract,
  } = {},
) {
  if (!Array.isArray(legacyItems)) return canonicalItems;
  const existing = Array.isArray(canonicalItems) ? canonicalItems : [];
  assertIdentityContract(identityContract);
  const visible = (item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const copy = structuredClone(item);
    delete copy[identityPath];
    delete copy[metadataPath];
    delete copy[projectionKeyPath];
    return copy;
  };
  if (identityContract === COLLECTION_IDENTITY_CONTRACT.legacy) {
    return legacyItems.map(visible);
  }
  assertManagedIdentities(existing, identityPath, "object collection");

  const existingById = new Map(
    existing.map((item) => [item[identityPath].toLowerCase(), item]),
  );
  const knownEntries =
    knownProjectionIdentities instanceof Map
      ? [...knownProjectionIdentities.entries()]
      : Object.entries(knownProjectionIdentities || {});
  const knownByProjectionKey = new Map(
    knownEntries.map(([projectionKey, canonicalId]) => [
      String(projectionKey).toLowerCase(),
      String(canonicalId).toLowerCase(),
    ]),
  );
  const suppliedIds = legacyItems
    .map((item) => item?.[metadataPath])
    .filter((identity) => isUuid(identity));
  if (existing.length && legacyItems.length && suppliedIds.length === 0) {
    const projectionKeysMatchCanonical = legacyItems.every(
      (item) =>
        isUuid(item?.[projectionKeyPath]) &&
        existingById.has(item[projectionKeyPath].toLowerCase()),
    );
    if (!projectionKeysMatchCanonical) {
      throw new Error(
        "Stable Selected Work metadata is missing. Refresh the legacy shadow before editing.",
      );
    }
  }
  const hasIdentityFreeItem = legacyItems.some((item) => !isUuid(item?.[metadataPath]));
  if (
    !knownByProjectionKey.size &&
    hasIdentityFreeItem &&
    suppliedIds.length < existing.length
  ) {
    throw new Error(
      "Stable Selected Work metadata is partially missing. Refresh the legacy shadow before editing.",
    );
  }
  if (new Set(suppliedIds.map((identity) => identity.toLowerCase())).size !== suppliedIds.length) {
    throw new Error("Stable Selected Work metadata contains duplicate canonical IDs.");
  }

  return legacyItems.map((item) => {
    const suppliedId = item?.[metadataPath];
    if (
      suppliedId !== undefined &&
      (!isUuid(suppliedId) || !existingById.has(suppliedId.toLowerCase()))
    ) {
      throw new Error("Stable Selected Work metadata does not match the canonical collection.");
    }
    const projectionKey = item?.[projectionKeyPath];
    const expectedId = isUuid(projectionKey)
      ? knownByProjectionKey.get(projectionKey.toLowerCase())
      : undefined;
    if (
      expectedId !== undefined &&
      (!isUuid(suppliedId) || suppliedId.toLowerCase() !== String(expectedId).toLowerCase())
    ) {
      throw new Error(
        "Stable Selected Work metadata changed or is missing for an existing projection block.",
      );
    }
    if (!isUuid(suppliedId) && !isUuid(projectionKey)) {
      throw new Error("Stable Selected Work projection key is missing or invalid.");
    }
    if (!isUuid(suppliedId) && existingById.has(projectionKey.toLowerCase())) {
      throw new Error(
        "A new Selected Work projection block cannot reuse an existing canonical ID.",
      );
    }
    return {
      ...visible(item),
      [identityPath]: isUuid(suppliedId) ? suppliedId : projectionKey,
    };
  });
}

function assertManagedIdentities(items, identityPath, label) {
  const identities = items.map((item) => (isObject(item) ? item[identityPath] : undefined));
  if (identities.some((identity) => !isUuid(identity))) {
    throw new Error(`Managed ${label} contains a missing or invalid canonical ID.`);
  }
  const normalized = identities.map((identity) => identity.toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Managed ${label} contains duplicate canonical IDs.`);
  }
}

function assertIdentityContract(identityContract) {
  if (!Object.values(COLLECTION_IDENTITY_CONTRACT).includes(identityContract)) {
    throw new Error("Collection identity contract must be explicitly set to legacy or stable-id.");
  }
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function isUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}
