import { describe, expect, it } from "vitest";
import { cmsImageTargetSize, formatUploadBytes } from "./image-upload";

describe("CMS image upload preparation", () => {
  it("fits landscape, portrait, and small images inside the upload envelope", () => {
    expect(cmsImageTargetSize(4032, 3024)).toEqual({
      width: 1440,
      height: 1080,
      resized: true,
    });
    expect(cmsImageTargetSize(3024, 4032)).toEqual({
      width: 810,
      height: 1080,
      resized: true,
    });
    expect(cmsImageTargetSize(720, 540)).toEqual({
      width: 720,
      height: 540,
      resized: false,
    });
  });

  it("formats author-facing upload sizes without false precision", () => {
    expect(formatUploadBytes(0)).toBe("0 B");
    expect(formatUploadBytes(923)).toBe("923 B");
    expect(formatUploadBytes(240 * 1024)).toBe("240 KB");
    expect(formatUploadBytes(10.3 * 1024 * 1024)).toBe("10 MB");
  });
});
