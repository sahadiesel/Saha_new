/** เกณฑ์ลดขนาดรูปก่อนอัปโหลด (เทียบกับรับงาน/intake) */
export const FILE_SIZE_THRESHOLD_500KB = 500 * 1024;

export async function compressImageIfNeeded(file: File): Promise<File> {
  if (file.size <= FILE_SIZE_THRESHOLD_500KB) return file;

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new window.Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        const attemptCompression = (q: number) => {
          canvas.toBlob(
            (blob) => {
              if (blob) {
                if (blob.size <= FILE_SIZE_THRESHOLD_500KB || q <= 0.1) {
                  const compressedFile = new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
                    type: "image/jpeg",
                    lastModified: Date.now(),
                  });
                  resolve(compressedFile);
                } else {
                  attemptCompression(q - 0.1);
                }
              } else {
                resolve(file);
              }
            },
            "image/jpeg",
            q
          );
        };
        attemptCompression(0.9);
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
}
