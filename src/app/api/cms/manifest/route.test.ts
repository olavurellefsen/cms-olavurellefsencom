import { describe, expect, it } from "vitest";
import { GET } from "./route";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("public CMS manifest v2", () => {
  it("emits a complete compiler-compatible identity envelope and four stable collections", async () => {
    const manifest = await GET().json();

    expect(manifest).toMatchObject({
      id: expect.stringMatching(uuid),
      siteId: "42782a7c-6918-4e84-b08b-cc3c859621ab",
      workspaceId: "f10b2793-6ac0-43c8-902c-5eb0a55f3713",
      version: 2,
      schemaVersion: "cms-manifest.2",
      compatibility: {
        readableVersions: [1, 2],
        writableVersions: [2],
        minimumAdapterVersion: 2,
      },
      projectionCompatibility: {
        keyVersion: 1,
        legacyKey:
          "f10b2793-6ac0-43c8-902c-5eb0a55f3713:manifest:42782a7c-6918-4e84-b08b-cc3c859621ab",
        retirement: { projectionRebuildVerified: false },
      },
      fields: [],
    });
    expect(manifest).not.toHaveProperty("site");
    expect(manifest.pages.length).toBeGreaterThan(0);
    expect(
      manifest.pages.every((page: { fragmentId?: string }) => uuid.test(page.fragmentId || "")),
    ).toBe(true);
    expect(manifest.collections).toHaveLength(4);
    for (const collection of manifest.collections) {
      expect(collection).toMatchObject({
        fragmentId: expect.stringMatching(uuid),
        itemIdentity: "stable-id",
        itemIdentityPath: "$id",
        allowedOperations: ["add", "update", "move", "remove", "restore"],
      });
    }
  });

  it("assigns each collection path to one mutation owner", async () => {
    const manifest = await GET().json();
    const regionOwners = new Set(
      manifest.regions.map(
        (region: { scope?: string; pageId?: string; path?: string }) =>
          `${region.scope || ""}:${region.pageId || ""}:${region.path || ""}`,
      ),
    );

    for (const collection of manifest.collections) {
      expect(
        regionOwners.has(
          `${collection.scope || ""}:${collection.pageId || ""}:${collection.path || ""}`,
        ),
      ).toBe(false);
    }
  });
});
