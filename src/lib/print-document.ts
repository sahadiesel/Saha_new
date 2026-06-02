/** ชื่อไฟล์แนะนำตอนบันทึก PDF — ตัดอักขระที่ Windows ไม่อนุญาต */
export function sanitizePrintFilenameBase(raw: string): string {
  let s = raw.replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim();
  if (!s.length) s = "document";
  if (s.length > 200) s = s.slice(0, 200);
  return s;
}

/** ตั้ง document.title + แท็ก <title> ให้เบราว์เซอร์ใช้เป็นชื่อไฟล์ PDF */
export function applyPrintDocumentTitle(docNo: string): void {
  const base = sanitizePrintFilenameBase(docNo);
  document.title = base;
  const titleEl = document.querySelector("title");
  if (titleEl) titleEl.textContent = base;
}

/** เอกสารที่แบ่ง 2 หน้าเมื่อพิมพ์ — หน้า 1 เฉพาะรายการ, หน้า 2 รายการต่อ + หมายเหตุ/ยอด/ลายเซ็น */
export const PRINT_MULTI_PAGE_DOC_TYPES = ["TAX_INVOICE", "DELIVERY_NOTE", "BILLING_NOTE"] as const;

/** ประมาณจำนวนแถวรายการในหน้าแรก (หัวเอกสาร ~85mm บน A4) */
export const PRINT_FIRST_PAGE_MAX_ITEMS = 17;

export function shouldSplitPrintPages(docType: string, itemCount: number): boolean {
  return (
    (PRINT_MULTI_PAGE_DOC_TYPES as readonly string[]).includes(docType) &&
    itemCount > PRINT_FIRST_PAGE_MAX_ITEMS
  );
}

export function getPrintFirstPageItemCount(itemCount: number): number {
  return itemCount <= PRINT_FIRST_PAGE_MAX_ITEMS ? itemCount : PRINT_FIRST_PAGE_MAX_ITEMS;
}
