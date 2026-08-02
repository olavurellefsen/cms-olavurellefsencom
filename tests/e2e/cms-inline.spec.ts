import { expect, test } from "@playwright/test";
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
});
