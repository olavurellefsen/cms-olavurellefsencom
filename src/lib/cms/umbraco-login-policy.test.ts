import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type UmbracoExtension = {
  alias?: string;
  element?: string;
  forBlockEditor?: string;
  forContentTypeAlias?: string;
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
    ) as { extensions: UmbracoExtension[]; version: string };
    const provider = manifest.extensions.find(
      (extension) =>
        extension.type === "authProvider" && extension.forProviderName === "Umbraco.Usable",
    );

    expect(provider?.meta?.label).toBe("Usable");
    expect(provider?.meta?.behavior?.autoRedirect).toBe(false);
    expect(manifest.version).toBe("0.10.0");
    expect(manifest.extensions).toContainEqual(
      expect.objectContaining({
        type: "blockEditorCustomView",
        alias: "Olavur.BlockEditorCustomView.SelectedWork",
        element: "/App_Plugins/OlavurProjection/selected-work-block.js",
        forContentTypeAlias: "olavurSelectedWorkItem",
        forBlockEditor: "block-list",
      }),
    );
  });
});
