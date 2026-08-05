export const CMS_IMAGE_MAX_WIDTH = 1440;
export const CMS_IMAGE_MAX_HEIGHT = 1080;
export const CMS_IMAGE_WEBP_QUALITY = 0.82;
export const CMS_IMAGE_COMPRESSION_THRESHOLD = 768 * 1024;

const optimizableImageTypes = new Set(["image/jpeg", "image/png"]);

export type CmsImagePreparation = {
  file: File;
  height?: number;
  optimized: boolean;
  originalBytes: number;
  uploadBytes: number;
  width?: number;
};

export function cmsImageTargetSize(
  width: number,
  height: number,
  maxWidth = CMS_IMAGE_MAX_WIDTH,
  maxHeight = CMS_IMAGE_MAX_HEIGHT,
) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { height: 0, resized: false, width: 0 };
  }

  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    height: Math.max(1, Math.round(height * scale)),
    resized: scale < 1,
    width: Math.max(1, Math.round(width * scale)),
  };
}

export function formatUploadBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes >= 10 ? Math.round(megabytes) : megabytes.toFixed(1)} MB`;
}

export async function prepareCmsImageUpload(file: File): Promise<CmsImagePreparation> {
  const unchanged = (dimensions: { width?: number; height?: number } = {}) => ({
    file,
    height: dimensions.height,
    optimized: false,
    originalBytes: file.size,
    uploadBytes: file.size,
    width: dimensions.width,
  });

  if (!optimizableImageTypes.has(file.type)) return unchanged();

  let decoded: Awaited<ReturnType<typeof decodeBrowserImage>> | undefined;
  try {
    decoded = await decodeBrowserImage(file);
    const target = cmsImageTargetSize(decoded.width, decoded.height);
    if (!target.resized && file.size <= CMS_IMAGE_COMPRESSION_THRESHOLD) {
      return unchanged({ width: decoded.width, height: decoded.height });
    }

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d", { alpha: file.type === "image/png" });
    if (!context) return unchanged({ width: decoded.width, height: decoded.height });
    context.drawImage(decoded.image, 0, 0, target.width, target.height);

    const blob = await canvasBlob(canvas, "image/webp", CMS_IMAGE_WEBP_QUALITY);
    if (!blob || blob.size >= file.size) {
      return unchanged({ width: decoded.width, height: decoded.height });
    }

    const baseName = file.name.replace(/\.[^.]+$/, "").trim() || "image";
    const preparedFile = new File([blob], `${baseName}.webp`, {
      lastModified: file.lastModified,
      type: "image/webp",
    });
    return {
      file: preparedFile,
      height: target.height,
      optimized: true,
      originalBytes: file.size,
      uploadBytes: preparedFile.size,
      width: target.width,
    };
  } catch {
    return unchanged();
  } finally {
    decoded?.release();
  }
}

async function decodeBrowserImage(file: File) {
  const url = URL.createObjectURL(file);
  const image = document.createElement("img");
  image.decoding = "async";
  image.src = url;

  try {
    if (typeof image.decode === "function") await image.decode();
    else {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("The image could not be decoded."));
      });
    }
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }

  return {
    height: image.naturalHeight,
    image,
    release: () => URL.revokeObjectURL(url),
    width: image.naturalWidth,
  };
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}
