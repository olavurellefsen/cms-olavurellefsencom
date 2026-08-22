import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const publicRoutes = [
  "/",
  "/writing",
  "/writing/claude-codex-usable-collaboration",
  "/writing/why-i-am-writing-here",
  "/about",
];

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test.describe(viewport.name, () => {
    test.use({ viewport });

    for (const route of publicRoutes) {
      test(`${route} renders without serious accessibility or overflow issues`, async ({
        page,
      }) => {
        const response = await page.goto(route);
        expect(response?.status()).toBe(200);
        await expect(page.locator("main")).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        expect(overflow).toBe(false);
        const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
        const materialViolations = audit.violations.filter((violation) =>
          ["serious", "critical"].includes(violation.impact || ""),
        );
        expect(materialViolations).toEqual([]);
      });
    }
  });
}

test("article HTML exposes canonical, dates, body and Article JSON-LD", async ({ page }) => {
  await page.goto("/writing/why-i-am-writing-here");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://www.olavurellefsen.com/writing/why-i-am-writing-here",
  );
  await expect(page.locator("article time")).toHaveAttribute("datetime", "2026-08-02");
  await expect(page.getByRole("heading", { name: "The work between the work" })).toBeVisible();
  const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(jsonLd.some((value) => value.includes('"@type":"Article"'))).toBe(true);
});

test("Usable collaboration article renders its product hero", async ({ page }) => {
  await page.goto("/writing/claude-codex-usable-collaboration");
  await expect(
    page.getByRole("img", {
      name: "Usable native apps for iOS and Android showing an answer grounded in shared workspace fragments",
    }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Preparing a shared memory" })).toBeVisible();
});

test("public pages load Usable Web Analytics for the canonical hostname", async ({ page }) => {
  await page.goto("/");
  const analytics = page.locator("#usable-web-analytics");
  await expect(analytics).toHaveAttribute("src", "https://web-analytics.usable.dev/js/uwa.js");
  await expect(analytics).toHaveAttribute("data-domain", "www.olavurellefsen.com");
});

test("machine-readable routes and CMS routing are healthy", async ({ page, request }) => {
  for (const route of [
    "/health",
    "/robots.txt",
    "/sitemap.xml",
    "/feed.xml",
    "/api/cms/manifest",
  ]) {
    const response = await request.get(route);
    expect(response.status()).toBe(200);
  }
  const cms = await request.get("/cms?page=about", { maxRedirects: 0 });
  expect([307, 308]).toContain(cms.status());
  expect(cms.headers().location).toBe("/about?cms=1");

  const editor = await request.get("/about?cms=1");
  expect(editor.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  expect(editor.headers()["cache-control"]).toContain("no-store");
  expect(editor.headers()["x-frame-options"]).toBe("SAMEORIGIN");

  const bridge = await request.get("/cms/umbraco-bridge");
  expect(bridge.status()).toBe(200);
  expect(bridge.headers()["x-frame-options"]).toBeUndefined();
  expect(bridge.headers()["content-security-policy"]).toContain("frame-ancestors");
  expect(bridge.headers()["cache-control"]).toContain("no-store");
  expect(bridge.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await page.route("https://cms.usable.dev/broker.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: "" }),
  );
  await page.goto("/cms/umbraco-bridge");
  await expect(page.locator("#usable-cms-broker")).toHaveAttribute(
    "data-ancestor-origins",
    "https://olavurellefsen-umbraco.fly.dev",
  );
});

test("Umbraco bridge opens Usable authentication outside the embedded page", async ({ page }) => {
  await page.route("https://cms.usable.dev/broker.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
        window.__usableLoginRequests = [];
        window.usableCmsBroker = {
          session: async () => ({ signedIn: false, authorized: false }),
          request: async (operation, payload) => {
            window.__usableLoginRequests.push({ operation, payload });
            return { loginUrl: window.location.origin + "/health?usable-login=1" };
          }
        };
      `,
    }),
  );
  await page.goto("/cms/umbraco-bridge");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Sign in with Usable" }).click();
  const popup = await popupPromise;
  await popup.waitForURL(/\/health\?usable-login=1$/);

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __usableLoginRequests?: Array<{
                operation: string;
                payload: { sameTab?: boolean };
              }>;
            }
          ).__usableLoginRequests?.[0],
      ),
    )
    .toMatchObject({ operation: "login-url", payload: { sameTab: false } });
  await popup.close();
});
