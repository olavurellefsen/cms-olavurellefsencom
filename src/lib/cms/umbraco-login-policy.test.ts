import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type UmbracoExtension = {
  type?: string;
  forProviderName?: string;
  meta?: {
    label?: string;
    behavior?: { autoRedirect?: boolean };
  };
};

describe("Umbraco login policy", () => {
  it("renders one explicit Sign in with Usable provider instead of auto-redirecting", () => {
    const manifest = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          "umbraco/OlavurEllefsen.Umbraco/App_Plugins/OlavurProjection/umbraco-package.json",
        ),
        "utf8",
      ),
    ) as { extensions: UmbracoExtension[] };
    const provider = manifest.extensions.find(
      (extension) =>
        extension.type === "authProvider" && extension.forProviderName === "Umbraco.Usable",
    );

    expect(provider?.meta?.label).toBe("Usable");
    expect(provider?.meta?.behavior?.autoRedirect).toBe(false);
  });
});
