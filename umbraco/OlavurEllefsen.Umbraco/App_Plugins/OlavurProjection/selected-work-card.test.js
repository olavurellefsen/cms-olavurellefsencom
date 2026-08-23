import { describe, expect, it } from "vitest";
import { normalizeSelectedWorkContent, selectedWorkCard } from "./selected-work-card.js";

describe("selected work block presentation", () => {
  it("shows the fields an editor needs to identify a block", () => {
    expect(
      selectedWorkCard({
        workName: "Usable",
        workRole: "Founder",
        workDescription: "A shared memory layer.",
        workHref: "https://www.usable.dev/product",
        workAccent: "green",
      }),
    ).toEqual({
      name: "Usable",
      role: "Founder",
      description: "A shared memory layer.",
      href: "https://www.usable.dev/product",
      linkLabel: "usable.dev",
      accent: "green",
      accentColor: "#4f8a6b",
    });
  });

  it("accepts Umbraco property arrays and provides useful fallbacks", () => {
    const content = normalizeSelectedWorkContent([
      { alias: "workName", value: "  " },
      { alias: "workRole", value: "Advisor" },
      { alias: "workHref", value: "not yet a URL" },
      { alias: "workAccent", value: "magenta" },
    ]);

    expect(selectedWorkCard(content)).toMatchObject({
      name: "Untitled work item",
      role: "Advisor",
      description: "No description yet.",
      linkLabel: "not yet a URL",
      accent: "blue",
    });
  });
});
