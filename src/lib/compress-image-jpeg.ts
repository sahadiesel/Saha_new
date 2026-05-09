/** บีบอัดรูปเป็น JPEG ให้ขนาดไม่เกิน maxBytes (ค่าเริ่มต้น 500KB) — ใช้ในเบราว์เซอร์เท่านั้น */
export async function compressImageToJpegUnderBytes(
  file: File,
  maxBytes: number
): Promise<Blob> {
  if (typeof createImageBitmap !== "function") {
    throw new Error("เบราว์เซอร์นี้ไม่รองรับการประมวลผลรูป");
  }

  const img = await createImageBitmap(file);
  const maxDim = 2048;
  let w = img.width;
  let h = img.height;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("ไม่สามารถสร้าง canvas สำหรับบีบอัดรูปได้");

  let scale = Math.min(1, maxDim / Math.max(w, h));
  let quality = 0.88;

  try {
    for (let attempt = 0; attempt < 28; attempt++) {
      const tw = Math.max(1, Math.round(w * scale));
      const th = Math.max(1, Math.round(h * scale));
      canvas.width = tw;
      canvas.height = th;
      ctx.drawImage(img, 0, 0, tw, th);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
      );
      if (!blob) throw new Error("บีบอัดรูปไม่สำเร็จ");
      if (blob.size <= maxBytes) return blob;

      if (quality > 0.38) {
        quality -= 0.07;
      } else {
        scale *= 0.86;
      }
    }
  } finally {
    img.close();
  }

  throw new Error(
    `ไม่สามารถบีบอัดรูปให้เล็กกว่า ${Math.round(maxBytes / 1024)}KB ได้ กรุณาใช้รูปที่มีความละเอียดต่ำกว่า`
  );
}
