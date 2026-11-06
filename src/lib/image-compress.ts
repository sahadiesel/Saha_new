/** เกณฑ์ขนาดไฟล์รูปที่จัดเก็บ: ไม่เกิน 500KB */
export const FILE_SIZE_THRESHOLD_500KB = 500 * 1024;

type Drawable = {
  width: number;
  height: number;
  source: CanvasImageSource;
  close: () => void;
};

function loadDrawableFromImage(file: File): Promise<Drawable> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        source: img,
        close: () => URL.revokeObjectURL(url),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("เปิดไฟล์รูปไม่สำเร็จ กรุณาใช้ไฟล์ JPG หรือ PNG"));
    };
    img.src = url;
  });
}

function loadDrawable(file: File): Promise<Drawable> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file)
      .then((bitmap) => ({
        width: bitmap.width,
        height: bitmap.height,
        source: bitmap,
        close: () => bitmap.close(),
      }))
      .catch(() => loadDrawableFromImage(file));
  }
  return loadDrawableFromImage(file);
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("บีบอัดรูปไม่สำเร็จ"));
      },
      "image/jpeg",
      quality
    );
  });
}

/**
 * รูปที่เล็กกว่า 500KB อยู่แล้วจะถูกเก็บตามไฟล์เดิม
 * รูปที่ใหญ่กว่าจะถูกย่อความละเอียดและคุณภาพจนไฟล์ JPEG ไม่เกิน 500KB
 */
export async function compressImageIfNeeded(file: File): Promise<File> {
  const maxBytes = FILE_SIZE_THRESHOLD_500KB;
  if (file.size <= maxBytes && file.type.startsWith("image/")) {
    return file;
  }

  const image = await loadDrawable(file);
  try {
    if (!image.width || !image.height) {
      throw new Error("เปิดไฟล์รูปไม่สำเร็จ กรุณาใช้ไฟล์ JPG หรือ PNG");
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("ไม่สามารถบีบอัดรูปได้");

    let scale = Math.min(1, 1920 / Math.max(image.width, image.height));
    let quality = 0.82;

    for (let attempt = 0; attempt < 24; attempt++) {
      const tw = Math.max(1, Math.round(image.width * scale));
      const th = Math.max(1, Math.round(image.height * scale));
      canvas.width = tw;
      canvas.height = th;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, tw, th);
      ctx.drawImage(image.source, 0, 0, tw, th);

      const blob = await canvasToJpegBlob(canvas, quality);
      if (blob.size <= maxBytes) {
        const base = file.name.replace(/\.[^.]+$/, "") || "photo";
        return new File([blob], `${base}.jpg`, {
          type: "image/jpeg",
          lastModified: Date.now(),
        });
      }

      if (quality > 0.45) quality = Math.round((quality - 0.08) * 100) / 100;
      else scale *= 0.82;
    }

    throw new Error("ไม่สามารถบีบอัดรูปให้ไม่เกิน 500KB ได้");
  } finally {
    image.close();
  }
}

export function imageUploadMetadata(file: File): { contentType: string } {
  return {
    contentType: file.type.startsWith("image/") ? file.type : "image/jpeg",
  };
}
