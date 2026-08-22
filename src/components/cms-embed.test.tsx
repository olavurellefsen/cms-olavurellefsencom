import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CmsEmbed, configuredUmbracoAncestorOrigins } from "./cms-embed";

vi.mock("next/script", () => ({
  default: (props: React.ComponentProps<"script">) => <script {...props} />,
}));

vi.mock("./cms-editor", () => ({ CmsEditor: () => null }));

describe("CmsEmbed", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("declares the exact configured Umbraco origin to the Usable broker", () => {
    vi.stubEnv("UMBRACO_BACKOFFICE_ORIGIN", "https://olavurellefsen-umbraco.fly.dev/path");

    const { container } = render(<CmsEmbed />);

    expect(configuredUmbracoAncestorOrigins()).toBe("https://olavurellefsen-umbraco.fly.dev");
    expect(container.querySelector("script")).toHaveAttribute(
      "data-ancestor-origins",
      "https://olavurellefsen-umbraco.fly.dev",
    );
  });

  it("omits invalid or non-web ancestor origins", () => {
    vi.stubEnv("UMBRACO_BACKOFFICE_ORIGIN", "not-an-origin");

    const { container } = render(<CmsEmbed />);

    expect(configuredUmbracoAncestorOrigins()).toBe("");
    expect(container.querySelector("script")).not.toHaveAttribute("data-ancestor-origins");
  });
});
