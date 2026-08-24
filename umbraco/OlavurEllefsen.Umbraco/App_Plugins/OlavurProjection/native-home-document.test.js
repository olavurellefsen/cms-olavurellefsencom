import { describe, expect, it } from "vitest";
import { COLLECTION_IDENTITY_CONTRACT } from "./collection-compatibility.js";
import {
  applyNativeHomeValues,
  canonicalSelectedWorkFromNativeBlockList,
  nativeHomeFingerprint,
  SELECTED_WORK_KEY_MODE,
} from "./native-home-document.js";

function nativeValue(order = ["one", "two"], included = ["one", "two"]) {
  const entries = {
    one: {
      key: "11111111-1111-4111-8111-111111111111",
      values: [
        { alias: "workName", value: "One" },
        { alias: "workRole", value: "Builder" },
        { alias: "workDescription", value: "First project" },
        { alias: "workHref", value: "/one" },
        { alias: "workAccent", value: "blue" },
      ],
    },
    two: {
      key: "22222222-2222-4222-8222-222222222222",
      values: [
        { alias: "workName", value: "Two" },
        { alias: "workRole", value: "Advisor" },
        { alias: "workDescription", value: "Second project" },
        { alias: "workHref", value: "/two" },
        { alias: "workAccent", value: "green" },
      ],
    },
  };
  return {
    layout: {
      "Umbraco.BlockList": order.map((key) => ({ contentKey: entries[key].key })),
    },
    contentData: included.map((key) => entries[key]),
    settingsData: [],
    expose: [],
  };
}

describe("native Home document projection", () => {
  it("uses Block List layout order as the canonical selected-work order", () => {
    const result = canonicalSelectedWorkFromNativeBlockList(nativeValue(["two", "one"]));

    expect(result.map((item) => item.name)).toEqual(["Two", "One"]);
  });

  it("maps additions and deletions into the unchanged Usable array shape", () => {
    const payload = { id: "home", content: { type: "home", selectedWork: [] } };
    const oneItem = nativeValue(["two"], ["two"]);

    const result = applyNativeHomeValues(payload, [
      { alias: "selectedWorkBlocks", value: oneItem },
    ], SELECTED_WORK_KEY_MODE.legacyShadow, COLLECTION_IDENTITY_CONTRACT.legacy);

    expect(result.content.selectedWork).toEqual([
      {
        name: "Two",
        role: "Advisor",
        description: "Second project",
        href: "/two",
        accent: "green",
      },
    ]);
    expect(payload.content.selectedWork).toEqual([]);
  });

  it("preserves Block List UUIDs after the explicit managed-v2 cutover", () => {
    const value = nativeValue(["two", "one"]);
    const result = canonicalSelectedWorkFromNativeBlockList(
      value,
      SELECTED_WORK_KEY_MODE.managedV2,
    );

    expect(result.map((item) => [item.$id, item.name])).toEqual([
      ["22222222-2222-4222-8222-222222222222", "Two"],
      ["11111111-1111-4111-8111-111111111111", "One"],
    ]);
    expect(
      applyNativeHomeValues(
        {
          content: {
            type: "home",
            selectedWork: [
              { $id: "11111111-1111-4111-8111-111111111111", name: "One" },
            ],
          },
        },
        [{ alias: "selectedWorkBlocks", value }],
        SELECTED_WORK_KEY_MODE.managedV2,
        COLLECTION_IDENTITY_CONTRACT.stableId,
      ).content.selectedWork,
    ).toEqual(result);
  });

  it("keeps canonical IDs while the runtime remains on the legacy shadow", () => {
    const value = nativeValue(["two", "one"]);
    for (const block of value.contentData) {
      const name = block.values.find((entry) => entry.alias === "workName")?.value;
      block.values.push({
        alias: "workCanonicalId",
        value:
          name === "One"
            ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
            : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      });
      if (name === "One") {
        block.values.find((entry) => entry.alias === "workName").value = "One edited";
      }
    }
    const payload = {
      content: {
        type: "home",
        selectedWork: [
          {
            $id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            name: "One",
            role: "Builder",
            description: "First project",
            href: "/one",
            accent: "blue",
          },
          {
            $id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            name: "Two",
            role: "Advisor",
            description: "Second project",
            href: "/two",
            accent: "green",
          },
        ],
      },
    };

    const result = applyNativeHomeValues(payload, [
      { alias: "selectedWorkBlocks", value },
    ], SELECTED_WORK_KEY_MODE.legacyShadow, COLLECTION_IDENTITY_CONTRACT.stableId);

    expect(result.content.selectedWork.map((item) => item.$id)).toEqual([
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ]);
    expect(result.content.selectedWork.map((item) => item.name)).toEqual(["Two", "One edited"]);
  });

  it("creates a stable ID when the stable collection adds its first native block", () => {
    const result = applyNativeHomeValues(
      { content: { type: "home", selectedWork: [] } },
      [{ alias: "selectedWorkBlocks", value: nativeValue(["one"], ["one"]) }],
      SELECTED_WORK_KEY_MODE.legacyShadow,
      COLLECTION_IDENTITY_CONTRACT.stableId,
    );

    expect(result.content.selectedWork).toEqual([
      expect.objectContaining({
        $id: "11111111-1111-4111-8111-111111111111",
        name: "One",
      }),
    ]);
  });

  it("fingerprints native changes without depending on the other document fields", () => {
    const value = nativeValue();
    expect(nativeHomeFingerprint([{ alias: "selectedWorkBlocks", value }])).toBe(
      nativeHomeFingerprint([
        { alias: "pageId", value: "home" },
        { alias: "selectedWorkBlocks", value },
      ]),
    );
  });
});
