import { expect, test } from "@playwright/test";
import manifest from "../../cms/manifest.json" with { type: "json" };
import binding from "../../cms/site-binding.json" with { type: "json" };
import site from "../../content/site.json" with { type: "json" };

const pageContent = Object.fromEntries(site.pages.map((page) => [page.id, page.content]));
const fragments = {
  [binding.globalFragmentId]: site.global,
  ...Object.fromEntries(
    Object.entries(binding.pageFragmentIds).map(([pageId, fragmentId]) => [
      fragmentId,
      pageContent[pageId as keyof typeof pageContent],
    ]),
  ),
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

  await page.goto("http://localhost:3000/?cms=1");
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

test("CMS edits the real page inline and preserves broker workflows", async ({
  page,
}, testInfo) => {
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
          upload: async () => ({ assetPath: "/images/olavur-ellefsen.png" }),
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
          deletePage: async (pageId) => {
            window.__cmsCalls.push({ operation: "deletePage", pageId });
          },
          pages: async () => ({ pages: [] }),
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

  await page.goto("http://localhost:3000/?cms=1");
  await expect(page.getByRole("main", { name: "Usable CMS inline editor" })).toBeVisible();
  const preview = page.frameLocator('iframe[title="Home inline editor"]');
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
  await preview.getByRole("button", { name: "Add work item" }).click();
  const newWorkInspector = page.getByRole("complementary", { name: "Add Current work" });
  await newWorkInspector.getByLabel("Name").fill("Example Project");
  await newWorkInspector.getByLabel("Role").fill("Advisor");
  await newWorkInspector.getByLabel("Description").fill("A new long-horizon project.");
  await newWorkInspector.getByLabel("Work URL").fill("https://example.com/");
  await newWorkInspector.getByRole("button", { name: "Add to draft" }).click();
  await expect(
    preview.locator(".work-list").getByText("Example Project", { exact: true }),
  ).toBeVisible();
  await expect(preview.getByRole("textbox", { name: "Edit Work 5 name" })).toHaveText(
    "Example Project",
  );
  const workInspector = page.getByRole("complementary", { name: "Selected element settings" });
  await expect(workInspector.getByLabel("Work URL")).toHaveValue("https://example.com/");
  await workInspector.getByLabel("Work URL").fill("https://example.org/long-horizon");
  await preview.getByRole("button", { name: "Move Example Project up" }).click();
  await expect(preview.getByRole("textbox", { name: "Edit Work 4 name" })).toHaveText(
    "Example Project",
  );
  await expect(preview.getByRole("textbox", { name: "Edit Work 5 name" })).toHaveText("Tøkni");
  await expect(preview.getByRole("button", { name: "Move Example Project down" })).toBeEnabled();

  await page.reload();
  await expect(page.getByRole("main", { name: "Usable CMS inline editor" })).toBeVisible();
  await expect(
    preview.locator(".work-list").getByText("Example Project", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeEnabled();
  await expect(preview.getByRole("textbox", { name: "Edit Work 4 name" })).toHaveText(
    "Example Project",
  );

  await preview.getByRole("button", { name: "Remove Usable from Current work" }).click();
  await expect(
    preview.locator(".work-list").getByText("Usable", { exact: true }),
  ).not.toBeVisible();
  await expect(preview.getByRole("textbox", { name: "Edit Work 1 name" })).toHaveText(
    "University of the Faroe Islands",
  );
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
        const change = calls
          ?.filter((call) => call.operation === "draft")
          .flatMap((call) => call.input?.changes || [])
          .reverse()
          .find((candidate) => candidate.path === "selectedWork");
        if (!change?.afterRef) return false;
        const items = JSON.parse(change.afterRef) as Array<{ href?: string; name?: string }>;
        return (
          items.some(
            (item) =>
              item.name === "Example Project" && item.href === "https://example.org/long-horizon",
          ) &&
          items.findIndex((item) => item.name === "Example Project") <
            items.findIndex((item) => item.name === "Tøkni") &&
          !items.some((item) => item.name === "Usable")
        );
      }),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Content" }).click();
  const writingManager = page.getByRole("region", { name: "Writing" });
  await expect(writingManager.getByRole("button", { name: "Add" })).toBeVisible();
  await expect(
    writingManager.getByRole("button", { name: "Hide Why I am writing here from Writing" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();

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
  await expect(articlePreview.getByRole("textbox", { name: "Edit Article body" })).toHaveAttribute(
    "aria-multiline",
    "true",
  );

  await page.goto("http://localhost:3000/?cms=1");
  const homePreview = page.frameLocator('iframe[title="Home inline editor"]');
  await homePreview.getByRole("link", { name: "All writing" }).click();
  await expect(page).toHaveURL(/\/writing\?cms=1$/);
});
