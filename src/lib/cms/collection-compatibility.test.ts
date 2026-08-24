import { describe, expect, it } from "vitest";
import {
  ensureStableCollectionIdentity,
  hasStableCollectionIdentity,
  legacyContentView,
  requiresStableCollectionCommands,
  stableCollectionItemKey,
} from "./collection-compatibility";

const selectedWork = {
  path: "selectedWork",
  pageId: "home",
  itemIdentity: "stable-id",
  itemIdentityPath: "$id",
  fields: [{ path: "name" }],
};
const topics = {
  path: "topics",
  pageId: "article-one",
  itemIdentity: "stable-id",
  itemIdentityPath: "$id",
  fields: [{ path: "$value" }],
};

describe("manifest-v2 consumer compatibility", () => {
  it("hides object identities and unwraps scalar collections without mutating canonical content", () => {
    const canonical = {
      selectedWork: [{ $id: "11111111-1111-4111-8111-111111111111", name: "One" }],
      topics: [{ $id: "22222222-2222-4222-8222-222222222222", $value: "Usable" }],
    };

    expect(legacyContentView(canonical, [selectedWork])).toEqual({
      selectedWork: [{ name: "One" }],
      topics: canonical.topics,
    });
    expect(legacyContentView(canonical, [topics], "article-one")).toEqual({
      selectedWork: canonical.selectedWork,
      topics: ["Usable"],
    });
    expect(legacyContentView({ topics: canonical.topics }, [topics], "article-runtime")).toEqual({
      topics: ["Usable"],
    });
    expect(canonical.selectedWork[0].$id).toBe("11111111-1111-4111-8111-111111111111");
    expect(canonical.topics[0].$id).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("keeps existing UUIDs and assigns a new item identity exactly once", () => {
    const existing = { $id: "11111111-1111-4111-8111-111111111111", name: "One" };
    const createUuid = () => "33333333-3333-4333-8333-333333333333";
    const first = ensureStableCollectionIdentity(existing, "$id", createUuid);
    const added = ensureStableCollectionIdentity<Record<string, unknown>>(
      { name: "Two" },
      "$id",
      createUuid,
    );
    const repeated = ensureStableCollectionIdentity(added, "$id", () => {
      throw new Error("must not replace an existing identity");
    });

    expect(first).toEqual(existing);
    expect(added.$id).toBe("33333333-3333-4333-8333-333333333333");
    expect(repeated).toEqual(added);
    expect(stableCollectionItemKey(repeated, "$id")).toBe(added.$id);
    expect(hasStableCollectionIdentity([first, added], "$id")).toBe(true);
    expect(hasStableCollectionIdentity([first, first], "$id")).toBe(false);
  });

  it("fails closed only for stable-ID collections and leaves legacy editors available", () => {
    expect(requiresStableCollectionCommands(selectedWork)).toBe(true);
    expect(requiresStableCollectionCommands({ ...selectedWork, itemIdentity: "index" })).toBe(
      false,
    );
    expect(requiresStableCollectionCommands({ ...selectedWork, itemIdentity: undefined })).toBe(
      false,
    );
  });
});
