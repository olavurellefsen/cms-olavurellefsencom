import { describe, expect, it } from "vitest";
import {
  auditUsablePageTopology,
  selectUsablePageReferences,
} from "../../../scripts/cms-sync-lib.mjs";

const fallbackPages = [
  { id: "home", title: "Home", path: "/" },
  { id: "writing", title: "Writing", path: "/writing" },
];

function article(
  fragmentId: string,
  pageId: string,
  slug: string,
  status: "draft" | "published",
  tags: string[] = [],
  updatedAt = "2026-08-20T10:00:00.000Z",
) {
  return {
    id: fragmentId,
    title: slug,
    tags: ["usable-cms-page", `ucms:page:${pageId}`, ...tags],
    updatedAt,
    content: JSON.stringify({ type: "article", title: slug, slug, status }),
  };
}

describe("Usable CMS synchronization page discovery", () => {
  it("reports page-local storage separately from duplicate physical fragments", () => {
    const workspaceFragments = [
      article("published", "article-duplicate", "duplicate", "published", ["cms-published"]),
      article("draft", "article-duplicate", "duplicate", "draft", ["cms-draft"]),
      article("other", "article-other", "other", "published", ["cms-published"]),
    ];

    const audit = auditUsablePageTopology({
      globalContent: { siteName: "Example" },
      fallbackPages: [],
      bindingPageFragmentIds: {},
      workspaceFragments,
      cmsPagesPayload: null,
    });

    expect(audit).toMatchObject({
      storageModel: "one-global-plus-one-fragment-per-page",
      globalContainsPagesArray: false,
      physicalPageFragments: 3,
      logicalPageIds: 2,
      selectablePages: 2,
      pageFragmentsContainingPagesArrays: [],
    });
    expect(audit.duplicates).toEqual([
      expect.objectContaining({ pageId: "article-duplicate", selectedFragmentId: "published" }),
    ]);
  });

  it("includes a runtime-only published article", () => {
    const pages = selectUsablePageReferences({
      fallbackPages,
      bindingPageFragmentIds: { home: "bound-home", writing: "bound-writing" },
      workspaceFragments: [
        article("runtime-published", "article-runtime", "runtime-article", "published", [
          "cms-published",
        ]),
      ],
      cmsPagesPayload: null,
    });

    expect(pages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "article-runtime",
          fragmentId: "runtime-published",
          path: "/writing/runtime-article",
        }),
      ]),
    );
  });

  it("keeps registered bindings authoritative over duplicate workspace fragments", () => {
    const pages = selectUsablePageReferences({
      fallbackPages,
      bindingPageFragmentIds: { home: "canonical-home" },
      workspaceFragments: [
        {
          id: "stale-home",
          tags: ["usable-cms-page", "cms-page:home", "cms-published"],
          content: JSON.stringify({ type: "home", title: "Stale", path: "/" }),
        },
      ],
      cmsPagesPayload: null,
    });

    expect(pages.find((page) => page.id === "home")?.fragmentId).toBe("canonical-home");
  });

  it("keeps a registered fragment id when the broker also returns that page", () => {
    const pages = selectUsablePageReferences({
      fallbackPages,
      bindingPageFragmentIds: { home: "canonical-home" },
      workspaceFragments: [],
      cmsPagesPayload: {
        pages: [
          {
            id: "home",
            title: "Home",
            path: "/",
            fragmentId: "broker-duplicate",
            status: "active",
          },
        ],
      },
    });

    expect(pages.find((page) => page.id === "home")?.fragmentId).toBe("canonical-home");
  });

  it("prefers an explicitly published runtime fragment over a duplicate draft", () => {
    const pages = selectUsablePageReferences({
      fallbackPages: [],
      bindingPageFragmentIds: {},
      workspaceFragments: [
        article(
          "published",
          "article-duplicate",
          "duplicate",
          "published",
          ["cms-published"],
          "2026-08-19T10:00:00.000Z",
        ),
        article(
          "newer-draft",
          "article-duplicate",
          "duplicate",
          "draft",
          ["cms-draft"],
          "2026-08-20T10:00:00.000Z",
        ),
      ],
      cmsPagesPayload: null,
    });

    expect(pages).toHaveLength(1);
    expect(pages[0]).toEqual(expect.objectContaining({ fragmentId: "published" }));
  });

  it("lets broker page references override workspace discovery and filters hidden pages", () => {
    const pages = selectUsablePageReferences({
      fallbackPages: [],
      bindingPageFragmentIds: {},
      workspaceFragments: [
        article("workspace", "article-runtime", "runtime", "published", ["cms-published"]),
      ],
      cmsPagesPayload: {
        pages: [
          {
            id: "article-runtime",
            title: "Runtime",
            path: "/writing/runtime",
            fragmentId: "broker-canonical",
            status: "active",
          },
          {
            id: "article-hidden",
            title: "Hidden",
            path: "/writing/hidden",
            fragmentId: "hidden",
            status: "hidden",
          },
        ],
      },
    });

    expect(pages).toHaveLength(1);
    expect(pages[0]).toEqual(expect.objectContaining({ fragmentId: "broker-canonical" }));
  });

  it("filters an explicitly archived workspace page", () => {
    const pages = selectUsablePageReferences({
      fallbackPages: [],
      bindingPageFragmentIds: {},
      workspaceFragments: [
        article("archived", "article-archived", "archived", "draft", ["cms-archived"]),
      ],
      cmsPagesPayload: null,
    });

    expect(pages).toHaveLength(0);
  });
});
