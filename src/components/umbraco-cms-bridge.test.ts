import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CmsBroker,
  openUsableLoginPopup,
  performBridgeOperation,
  UmbracoCmsBridge,
} from "./umbraco-cms-bridge";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as unknown as { usableCmsBroker?: CmsBroker }).usableCmsBroker;
});

function broker(overrides: Partial<CmsBroker> = {}): CmsBroker {
  return {
    content: vi.fn(),
    draft: vi.fn(),
    login: vi.fn(),
    publish: vi.fn(),
    request: vi.fn(),
    session: vi.fn(),
    upload: vi.fn(),
    ...overrides,
  } as CmsBroker;
}

describe("Umbraco CMS bridge", () => {
  it("opens the Usable sign-in outside the embedded bridge and hands the popup its broker URL", async () => {
    const request = vi.fn(async () => ({ loginUrl: "https://cms.usable.dev/api/auth/login" }));
    const replace = vi.fn();
    const close = vi.fn();

    await openUsableLoginPopup(broker({ request }), "https://www.example.com/cms/bridge", () => ({
      close,
      location: { replace },
    }));

    expect(request).toHaveBeenCalledWith("login-url", {
      returnTo: "https://www.example.com/cms/bridge",
      sameTab: false,
    });
    expect(replace).toHaveBeenCalledWith("https://cms.usable.dev/api/auth/login");
    expect(close).not.toHaveBeenCalled();
  });

  it("explains when the browser blocks the Usable sign-in popup", async () => {
    await expect(
      openUsableLoginPopup(broker(), "https://www.example.com/cms/bridge", () => null),
    ).rejects.toThrow("Allow pop-ups for this Umbraco site");
  });

  it("closes the placeholder popup when the broker cannot create a sign-in URL", async () => {
    const close = vi.fn();
    await expect(
      openUsableLoginPopup(
        broker({ request: vi.fn(async () => ({})) }),
        "https://www.example.com/cms/bridge",
        () => ({ close, location: { replace: vi.fn() } }),
      ),
    ).rejects.toThrow("Usable did not return a sign-in URL");
    expect(close).toHaveBeenCalledOnce();
  });

  it("refreshes the bridge status when the popup handoff authenticates the broker", async () => {
    const cmsBroker = broker({
      session: vi.fn(async () => ({ signedIn: false, authorized: false })),
    });
    (window as unknown as { usableCmsBroker?: CmsBroker }).usableCmsBroker = cmsBroker;
    vi.spyOn(window.parent, "postMessage").mockImplementation(() => undefined);

    render(
      createElement(UmbracoCmsBridge, {
        parentOrigin: "https://olavurellefsen-umbraco.fly.dev",
      }),
    );
    await screen.findByText("Sign in to save canonical drafts.");

    window.dispatchEvent(
      new CustomEvent("usable-cms-broker:auth", {
        detail: {
          broker: cmsBroker,
          signedIn: true,
          authorized: true,
          user: { name: "Ólavur" },
          capabilities: { edit: true, publish: true, upload: true },
        },
      }),
    );

    expect(await screen.findByText("Connected as Ólavur")).toBeInTheDocument();
  });

  it("uploads preserved image formats through the Usable broker and returns an absolute URL", async () => {
    const file = new File(["image-bytes"], "portrait.webp", { type: "image/webp" });
    const upload = vi.fn(async () => ({ assetPath: "/api/v1/public/images/portrait.webp" }));
    const result = await performBridgeOperation(broker({ upload }), "upload", {
      file,
      regionId: "global.author.portrait",
      title: "Portrait",
    });

    expect(upload).toHaveBeenCalledWith(file, {
      regionId: "global.author.portrait",
      title: "Portrait",
    });
    expect(result).toMatchObject({
      url: "https://cms.usable.dev/api/v1/public/images/portrait.webp",
      preparation: {
        fileName: "portrait.webp",
        optimized: false,
        originalBytes: file.size,
        uploadBytes: file.size,
      },
    });
  });

  it("rejects an upload without a browser File", async () => {
    await expect(
      performBridgeOperation(broker(), "upload", {
        regionId: "global.author.portrait",
        title: "Portrait",
      }),
    ).rejects.toThrow("Choose an image before uploading.");
  });
});
