import { describe, expect, it, vi } from "vitest";
import {
  COLLECTION_IDENTITY_CONTRACT,
  legacyScalarValues,
  mergeLegacyObjectIdentities,
  mergeLegacyScalarValues,
} from "./collection-compatibility.js";

const stableId = { identityContract: COLLECTION_IDENTITY_CONTRACT.stableId };

describe("Umbraco scalar collection compatibility", () => {
  it("keeps the legacy topic view while preserving IDs across edit and reorder", () => {
    const canonical = [
      { $id: "11111111-1111-4111-8111-111111111111", $value: "Usable" },
      { $id: "22222222-2222-4222-8222-222222222222", $value: "Umbraco" },
    ];

    expect(legacyScalarValues(canonical)).toEqual(["Usable", "Umbraco"]);
    expect(mergeLegacyScalarValues(canonical, ["Umbraco", "Usable"], stableId)).toEqual([
      canonical[1],
      canonical[0],
    ]);
    expect(mergeLegacyScalarValues(canonical, ["Edited", "Umbraco"], stableId)).toEqual([
      { ...canonical[0], $value: "Edited" },
      canonical[1],
    ]);
  });

  it("assigns one UUID to an added wrapped topic and does not replace existing IDs", () => {
    const createUuid = vi.fn(() => "33333333-3333-4333-8333-333333333333");
    const canonical = [
      { $id: "11111111-1111-4111-8111-111111111111", $value: "Usable" },
    ];
    const result = mergeLegacyScalarValues(canonical, ["Usable", "New"], {
      ...stableId,
      createUuid,
    });

    expect(result).toEqual([
      canonical[0],
      { $id: "33333333-3333-4333-8333-333333333333", $value: "New" },
    ]);
    expect(createUuid).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: "partial",
      canonical: [
        { $id: "11111111-1111-4111-8111-111111111111", $value: "Usable" },
        { $value: "Umbraco" },
      ],
      message: "missing or invalid",
    },
    {
      name: "invalid",
      canonical: [{ $id: "not-a-uuid", $value: "Usable" }],
      message: "missing or invalid",
    },
    {
      name: "duplicate",
      canonical: [
        { $id: "11111111-1111-4111-8111-111111111111", $value: "Usable" },
        { $id: "11111111-1111-4111-8111-111111111111", $value: "Umbraco" },
      ],
      message: "duplicate",
    },
  ])("rejects $name existing scalar identities", ({ canonical, message }) => {
    const createUuid = vi.fn(() => "33333333-3333-4333-8333-333333333333");

    expect(() =>
      mergeLegacyScalarValues(canonical, ["Usable", "Umbraco"], {
        ...stableId,
        createUuid,
      }),
    ).toThrow(message);
    expect(createUuid).not.toHaveBeenCalled();
  });

  it("merges legacy native objects back onto canonical IDs across reorder, edit, add, and remove", () => {
    const canonical = [
      { $id: "11111111-1111-4111-8111-111111111111", name: "One", role: "Builder" },
      { $id: "22222222-2222-4222-8222-222222222222", name: "Two", role: "Advisor" },
    ];
    const merged = mergeLegacyObjectIdentities(
      canonical,
      [
        {
          __usableCanonicalId: canonical[1].$id,
          name: "Two",
          role: "Advisor",
        },
        {
          __usableCanonicalId: canonical[0].$id,
          name: "One edited",
          role: "Builder",
        },
        {
          __usableProjectionKey: "33333333-3333-4333-8333-333333333333",
          name: "Three",
          role: "Writer",
        },
      ],
      stableId,
    );

    expect(merged.map((item) => item.$id)).toEqual([
      canonical[1].$id,
      canonical[0].$id,
      "33333333-3333-4333-8333-333333333333",
    ]);
    expect(
      mergeLegacyObjectIdentities(
        merged,
        [
          {
            __usableCanonicalId: canonical[0].$id,
            name: "One edited",
            role: "Builder",
          },
        ],
        stableId,
      ),
    ).toEqual([{ ...merged[1] }]);
  });

  it("fails closed when an existing managed shadow has no canonical metadata", () => {
    expect(() =>
      mergeLegacyObjectIdentities(
        [{ $id: "11111111-1111-4111-8111-111111111111", name: "One" }],
        [
          {
            __usableProjectionKey: "33333333-3333-4333-8333-333333333333",
            name: "Edited",
          },
        ],
        stableId,
      ),
    ).toThrow("metadata is missing");
  });

  it("rejects partial identity loss instead of classifying an edited block as an add", () => {
    const canonical = [
      { $id: "11111111-1111-4111-8111-111111111111", name: "One" },
      { $id: "22222222-2222-4222-8222-222222222222", name: "Two" },
    ];

    expect(() =>
      mergeLegacyObjectIdentities(
        canonical,
        [
          {
            __usableCanonicalId: canonical[0].$id,
            __usableProjectionKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            name: "One",
          },
          {
            __usableProjectionKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            name: "Two edited",
          },
        ],
        stableId,
      ),
    ).toThrow("partially missing");
  });

  it("uses explicit projection identity state across simultaneous edit, reorder, add, and remove", () => {
    const canonical = [
      { $id: "11111111-1111-4111-8111-111111111111", name: "One" },
      { $id: "22222222-2222-4222-8222-222222222222", name: "Two" },
    ];
    const knownProjectionIdentities = new Map([
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", canonical[0].$id],
      ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", canonical[1].$id],
    ]);

    expect(
      mergeLegacyObjectIdentities(
        canonical,
        [
          {
            __usableCanonicalId: canonical[1].$id,
            __usableProjectionKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            name: "Two edited",
          },
          {
            __usableProjectionKey: "33333333-3333-4333-8333-333333333333",
            name: "Three",
          },
        ],
        { ...stableId, knownProjectionIdentities },
      ),
    ).toEqual([
      { $id: canonical[1].$id, name: "Two edited" },
      { $id: "33333333-3333-4333-8333-333333333333", name: "Three" },
    ]);
  });

  it("rejects canonical metadata tampering instead of trusting the projection key", () => {
    expect(() =>
      mergeLegacyObjectIdentities(
        [{ $id: "11111111-1111-4111-8111-111111111111", name: "One" }],
        [
          {
            __usableCanonicalId: "22222222-2222-4222-8222-222222222222",
            __usableProjectionKey: "11111111-1111-4111-8111-111111111111",
            name: "One",
          },
        ],
        stableId,
      ),
    ).toThrow("does not match");
  });

  it.each([
    {
      name: "partial",
      canonical: [
        { $id: "11111111-1111-4111-8111-111111111111", name: "One" },
        { name: "Two" },
      ],
      message: "missing or invalid",
    },
    {
      name: "invalid",
      canonical: [{ $id: "not-a-uuid", name: "One" }],
      message: "missing or invalid",
    },
    {
      name: "duplicate",
      canonical: [
        { $id: "11111111-1111-4111-8111-111111111111", name: "One" },
        { $id: "11111111-1111-4111-8111-111111111111", name: "Two" },
      ],
      message: "duplicate",
    },
  ])("rejects $name existing object identities", ({ canonical, message }) => {
    expect(() =>
      mergeLegacyObjectIdentities(
        canonical,
        [
          {
            __usableCanonicalId: "11111111-1111-4111-8111-111111111111",
            name: "One",
          },
        ],
        stableId,
      ),
    ).toThrow(message);
  });

  it("uses the explicit stable-ID contract when an empty scalar collection receives its first item", () => {
    const createUuid = vi.fn(() => "33333333-3333-4333-8333-333333333333");

    expect(
      mergeLegacyScalarValues([], ["First topic"], {
        ...stableId,
        createUuid,
      }),
    ).toEqual([
      { $id: "33333333-3333-4333-8333-333333333333", $value: "First topic" },
    ]);
  });

  it("uses the explicit stable-ID contract when an empty object collection receives its first item", () => {
    expect(
      mergeLegacyObjectIdentities(
        [],
        [
          {
            __usableProjectionKey: "33333333-3333-4333-8333-333333333333",
            name: "First project",
          },
        ],
        stableId,
      ),
    ).toEqual([
      {
        $id: "33333333-3333-4333-8333-333333333333",
        name: "First project",
      },
    ]);
  });

  it("requires callers to choose the migration identity contract", () => {
    expect(() => mergeLegacyScalarValues([], ["First topic"])).toThrow("explicitly set");
    expect(() =>
      mergeLegacyObjectIdentities([], [
        { __usableProjectionKey: "33333333-3333-4333-8333-333333333333" },
      ]),
    ).toThrow("explicitly set");
  });
});
