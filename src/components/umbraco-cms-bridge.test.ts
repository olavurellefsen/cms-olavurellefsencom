import { describe, expect, it, vi } from "vitest";
import { type CmsBroker, performBridgeOperation } from "./umbraco-cms-bridge";

function broker(overrides: Partial<CmsBroker> = {}): CmsBroker {
  return {
    content: vi.fn(),
    draft: vi.fn(),
    login: vi.fn(),
    publish: vi.fn(),
    session: vi.fn(),
    upload: vi.fn(),
    ...overrides,
  } as CmsBroker;
}

describe("Umbraco CMS bridge", () => {
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
