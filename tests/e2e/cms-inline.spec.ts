import { expect, test } from "@playwright/test";
import manifest from "../../cms/manifest.json" with { type: "json" };
import binding from "../../cms/site-binding.json" with { type: "json" };
import site from "../../content/site.json" with { type: "json" };

const pageContent = Object.fromEntries(site.pages.map((page) => [page.id, page.content]));
const draftFragmentId = "00000000-0000-4000-8000-000000000905";
const draftPage = {
  id: "article-unpublished-e2e",
  title: "Unpublished E2E note",
  path: "/writing/unpublished-e2e",
  fragmentId: draftFragmentId,
  status: "draft",
};
const fragments = {
  [binding.globalFragmentId]: site.global,
  ...Object.fromEntries(
    Object.entries(binding.pageFragmentIds).map(([pageId, fragmentId]) => [
      fragmentId,
      pageContent[pageId as keyof typeof pageContent],
    ]),
  ),
  [draftFragmentId]: {
    type: "article",
    title: "Unpublished E2E note",
    slug: "unpublished-e2e",
    summary: "A secure draft preview used by the editor test.",
    publishedAt: "2026-08-05",
    updatedAt: "2026-08-05",
    status: "draft",
    topics: ["Testing"],
    canonicalUrl: "https://www.olavurellefsen.com/writing/unpublished-e2e",
    bodyMarkdown: "## Draft heading\n\nThis content must only appear after broker authorization.",
  },
};

test("CMS can refresh an expired Usable login", async ({ page }) => {
  await page.route("**/broker.js", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `
        window.__cmsCalls = [];
        window.usableCmsBroker = {
          session: async () => ({
            signedIn: true,
            authorized: false,
            user: { email: "olavur@ellefsen.fo" },
            capabilities: {}
          }),
          login: async (returnTo, options) => {
            window.__cmsCalls.push({ operation: "login", returnTo, options });
          }
        };
      `,
    });
  });

  await page.goto("/?cms=1");
  await expect(
    page.getByText("Your Usable login may have expired. Sign in again to refresh access.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign in again" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as Window & {
            __cmsCalls?: Array<{
              operation: string;
              options?: { forceLogin?: boolean; sameTab?: boolean };
            }>;
          }
        ).__cmsCalls?.some(
          (call) =>
            call.operation === "login" &&
            call.options?.forceLogin === true &&
            call.options?.sameTab === true,
        ),
      ),
    )
    .toBe(true);
});

test("CMS offers a fresh login when content access expires during startup", async ({ page }) => {
  await page.route("**/broker.js", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `
        window.__cmsCalls = [];
        window.usableCmsBroker = {
          session: async () => ({
            signedIn: true,
            authorized: true,
            user: { email: "olavur@ellefsen.fo" },
            capabilities: { edit: true }
          }),
          pages: async () => ({ pages: [] }),
          content: async () => {
            const error = new Error("Unable to read target fragment: 401");
            error.status = 401;
            throw error;
          },
          login: async (returnTo, options) => {
            window.__cmsCalls.push({ operation: "login", returnTo, options });
          }
        };
      `,
    });
  });

  await page.goto("/?cms=1");
  await expect(
    page.getByText("Your Usable login may have expired. Sign in again to refresh access.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in again" })).toBeVisible();
});

test("CMS edits the real page inline and preserves broker workflows", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);

  await page.route("**/broker.js", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `
        window.__cmsCalls = [];
        window.usableCmsBroker = {
          session: async () => ({
            signedIn: true,
            authorized: true,
            user: { email: "olavur@ellefsen.fo" },
            capabilities: { chat: true, edit: true, publish: true, restore: true, upload: true }
          }),
          login: async () => ({}),
          content: async ({ fragmentIds }) => ({
            fragments: fragmentIds.map((id) => ({ id, content: ${JSON.stringify(fragments)}[id] }))
          }),
          draft: async (input) => {
            const declaredPaths = new Set(${JSON.stringify(manifest.regions.map((region) => region.path))});
            const undeclared = input.changes?.find((change) => !declaredPaths.has(change.path));
            if (undeclared) throw new Error(\`Path \${undeclared.path} is not declared in the CMS manifest\`);
            window.__cmsCalls.push({ operation: "draft", input });
            return { revision: { id: "test-revision" } };
          },
          publish: async (input) => {
            window.__cmsCalls.push({ operation: "publish", input });
            return { revision: { id: "published-revision" } };
          },
          upload: async (file, input) => {
            window.__cmsCalls.push({
              operation: "upload",
              fileName: file.name,
              fileSize: file.size,
              fileType: file.type,
              input
            });
            return { url: "https://cms.usable.dev/api/sites/test/assets/uploaded-media" };
          },
          versions: async () => ({
            versions: [{ id: "version-1", summary: "Published version", createdAt: "2026-08-02T10:00:00Z" }]
          }),
          restore: async (versionId) => {
            window.__cmsCalls.push({ operation: "restore", versionId });
          },
          createPage: async (input) => {
            window.__cmsCalls.push({ operation: "createPage", input });
            return { page: { id: input.id, title: input.title, path: input.path } };
          },
          publishPage: async (pageId) => {
            window.__cmsCalls.push({ operation: "publishPage", pageId });
            return { page: { ...${JSON.stringify(draftPage)}, status: "active" } };
          },
          deletePage: async (pageId) => {
            window.__cmsCalls.push({ operation: "deletePage", pageId });
          },
          pages: async () => ({ pages: [${JSON.stringify(draftPage)}] }),
          chat: async (message, input) => {
            window.__cmsCalls.push({ operation: "chat", message, input });
            return {
              message: "I updated the headline in the draft.",
              changes: [{
                targetId: ${JSON.stringify(binding.pageFragmentIds.home)},
                path: "headline",
                afterRef: JSON.stringify("A chat-updated headline")
              }]
            };
          }
        };
      `,
    });
  });

  await page.goto("/?cms=1");
  await expect(page.getByRole("main", { name: "Usable CMS inline editor" })).toBeVisible();
  const preview = page.frameLocator('iframe[title="Home inline editor"]');
  const contentPanel = page.getByRole("complementary", { name: "content panel" });
  async function openContentPanel() {
    if (!(await contentPanel.isVisible())) {
      await page.getByRole("button", { name: "Content" }).click();
    }
    await expect(contentPanel).toBeVisible();
  }
  const headline = preview.getByRole("textbox", { name: "Edit Home headline" });
  await expect(headline).toHaveAttribute("contenteditable", "true");
  await expect(headline).toHaveText("Ólavur Ellefsen");
  await page.screenshot({ path: testInfo.outputPath("cms-inline-desktop.png"), fullPage: true });

  await headline.fill("Ólavur Ellefsen inline test");
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible({ timeout: 4_000 });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as Window & { __cmsCalls?: Array<{ operation: string }> }).__cmsCalls?.some(
          (call) => call.operation === "draft",
        ),
      ),
    )
    .toBe(true);

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as Window & { __cmsCalls?: Array<{ operation: string }> }).__cmsCalls?.some(
          (call) => call.operation === "publish",
        ),
      ),
    )
    .toBe(true);

  const portrait = preview.locator('[data-usable-cms-region="global.author.portrait"]');
  await expect(portrait).toHaveAttribute("aria-label", "Edit Portrait");
  await portrait.click();
  await expect(
    page.getByRole("complementary", { name: "Selected element settings" }),
  ).toContainText("Portrait");
  await expect(page.getByText("Replace image", { exact: true })).toBeVisible();
  await expect(page.getByText("Alternative text", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Mobile preview" }).click();
  await expect(page.locator(".cms-preview--mobile")).toBeVisible();
  await expect(page.locator(".cms-preview--mobile")).toHaveCSS("width", "390px");

  await page.getByRole("button", { name: "Desktop preview" }).click();
  await expect(preview.getByRole("button", { name: "Add work item" })).toHaveCount(0);
  const firstWorkName = preview.locator('[data-usable-cms-path="selectedWork.0.name"]');
  await expect(firstWorkName).toHaveAttribute("data-cms-editable", "read-only");
  await expect(firstWorkName).not.toHaveAttribute("contenteditable", "true");
  await expect(firstWorkName).toHaveAttribute(
    "title",
    "Manage this stable collection in the native Umbraco Block List editor.",
  );
  await openContentPanel();
  const currentWorkManager = page.getByRole("region", { name: "Current work" });
  await expect(
    currentWorkManager.getByText(
      "Selected work uses stable-ID commands and is read-only here. Manage it in the native Umbraco Block List editor.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(currentWorkManager.getByRole("button", { name: "Move Usable up" })).toBeDisabled();
  await expect(currentWorkManager.getByRole("button", { name: "Move Usable down" })).toBeDisabled();
  await expect(
    currentWorkManager.getByRole("button", { name: "Remove Usable from Current work" }),
  ).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = (
          window as Window & {
            __cmsCalls?: Array<{
              operation: string;
              input?: { changes?: Array<{ afterRef?: string; path?: string }> };
            }>;
          }
        ).__cmsCalls;
        return !calls
          ?.filter((call) => call.operation === "draft")
          .flatMap((call) => call.input?.changes || [])
          .some((candidate) => candidate.path === "selectedWork");
      }),
    )
    .toBe(true);
  await openContentPanel();
  const writingManager = page.getByRole("region", { name: "Writing" });
  await expect(writingManager.getByRole("button", { name: "Add" })).toBeVisible();
  await expect(
    writingManager.getByRole("button", { name: "Hide Why I am writing here from Writing" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(page.getByRole("button", { name: "Published", exact: true })).toBeDisabled();

  await page.getByRole("button", { name: "Pages" }).click();
  await expect(page.getByRole("navigation", { name: "Website pages" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New founder note" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Why I am writing here", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New founder note" }).click();
  await expect(page.getByRole("dialog", { name: "Create a writing page" })).toBeVisible();
  await expect(page.getByText("one independently editable CMS Page fragment")).toBeVisible();
  await page.getByRole("button", { name: "Close new page dialog" }).click();
  await page.getByRole("button", { name: "Close panel" }).click();

  await page.getByRole("button", { name: "Open Usable CMS chat" }).click();
  await page
    .getByRole("textbox", { name: "Ask Usable chat to work with CMS content" })
    .fill("Improve the headline");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("I updated the headline in the draft.")).toBeVisible();
  const chatPublish = page.getByRole("button", { name: "Publish", exact: true });
  await expect(chatPublish).toBeEnabled();
  await chatPublish.click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = (
          window as Window & {
            __cmsCalls?: Array<{
              operation: string;
              input?: { changes?: Array<{ afterRef?: string }> };
            }>;
          }
        ).__cmsCalls;
        return calls?.some(
          (call) =>
            call.operation === "publish" &&
            call.input?.changes?.some(
              (change) => change.afterRef === JSON.stringify("A chat-updated headline"),
            ),
        );
      }),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Close Usable CMS chat" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("cms-inline-mobile.png"), fullPage: true });

  await page.getByRole("button", { name: "Pages" }).click();
  await page.getByRole("button", { name: "Why I am writing here", exact: true }).click();
  await expect(page).toHaveURL(/\/writing\/why-i-am-writing-here\?cms=1$/);
  const articlePreview = page.frameLocator('iframe[title="Why I am writing here inline editor"]');
  await expect(articlePreview.getByRole("button", { name: "Edit Article body" })).toBeVisible();

  await page.goto("/?cms=1");
  const homePreview = page.frameLocator('iframe[title="Home inline editor"]');
  await homePreview.getByRole("link", { name: "All writing" }).click();
  await expect(page).toHaveURL(/\/writing\?cms=1$/);

  const publicDraftResponse = await page.request.get("/writing/unpublished-e2e");
  expect(publicDraftResponse.status()).toBe(404);
  expect(await publicDraftResponse.text()).not.toContain(
    "This content must only appear after broker authorization.",
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/writing/unpublished-e2e?cms=1");
  await expect(page.getByText("Draft · Usable CMS", { exact: true })).toBeVisible();
  const draftPreview = page.frameLocator('iframe[title="Unpublished E2E note inline editor"]');
  await expect(draftPreview.getByText("Unpublished draft", { exact: true })).toBeVisible();
  await expect(draftPreview.getByRole("textbox", { name: "Edit Article title" })).toHaveText(
    "Unpublished E2E note",
  );
  await draftPreview.getByRole("button", { name: "Edit Article body" }).click();
  const articleInspector = page.getByRole("complementary", {
    name: "Selected element settings",
  });
  await expect(
    articleInspector.getByText(
      "These are the same portable blocks projected into Umbraco. Drafts remain private until Publish.",
      { exact: true },
    ),
  ).toBeVisible();
  await articleInspector.getByRole("button", { name: "heading", exact: true }).click();
  await articleInspector.getByLabel("Heading text").last().fill("A structured section");
  await page.screenshot({
    path: testInfo.outputPath("cms-structured-article-editor.png"),
    fullPage: true,
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = (
          window as Window & {
            __cmsCalls?: Array<{
              input?: { changes?: Array<{ afterRef?: string; path?: string }> };
              operation: string;
            }>;
          }
        ).__cmsCalls;
        return calls
          ?.filter((call) => call.operation === "draft")
          .flatMap((call) => call.input?.changes || [])
          .some(
            (change) =>
              change.path === "bodyBlocks" &&
              change.afterRef?.includes("A structured section") === true,
          );
      }),
    )
    .toBe(true);
  await expect(page.getByRole("button", { name: "Page is not published yet" })).toBeDisabled();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = (
          window as Window & { __cmsCalls?: Array<{ operation: string; pageId?: string }> }
        ).__cmsCalls;
        return calls?.some(
          (call) => call.operation === "publishPage" && call.pageId === "article-unpublished-e2e",
        );
      }),
    )
    .toBe(true);
  await expect(page.getByRole("button", { name: "Published", exact: true })).toBeDisabled();
});
