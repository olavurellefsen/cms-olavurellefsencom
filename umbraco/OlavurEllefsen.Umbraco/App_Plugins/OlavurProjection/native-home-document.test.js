import { describe, expect, it } from "vitest";
import {
  applyNativeHomeValues,
  canonicalSelectedWorkFromNativeBlockList,
  nativeHomeFingerprint,
} from "./native-home-document.js";

function nativeValue(order = ["one", "two"], included = ["one", "two"]) {
  const entries = {
    one: {
      key: "11111111-1111-1111-1111-111111111111",
      values: [
        { alias: "workName", value: "One" },
        { alias: "workRole", value: "Builder" },
        { alias: "workDescription", value: "First project" },
        { alias: "workHref", value: "/one" },
        { alias: "workAccent", value: "blue" },
      ],
    },
    two: {
      key: "22222222-2222-2222-2222-222222222222",
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
    ]);

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
