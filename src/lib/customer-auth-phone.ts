import { normalizePhoneDigits } from "@/lib/customer-utils";

/** รหัสเอกสารลูกค้า = เบอร์มาตรฐาน (หลักเป็นเลขไทย 10 หลักขึ้นต้น 0) */
export function customerDocumentIdFromPhone(raw: string): string {
  let d = normalizePhoneDigits(String(raw || "").trim());
  if (!d) return "";
  if (d.startsWith("66") && d.length >= 11) {
    d = "0" + d.slice(2);
  }
  if (!d.startsWith("0") && d.length === 9) {
    d = "0" + d;
  }
  return d;
}

/**
 * Firebase Auth ใช้ email+password เท่านั้น — สร้างอีเมลสังเคราะห์จาก doc id เบอร์
 * (ผู้ใช้ไม่ต้องรู้หรือจำค่านี้)
 */
export function customerAuthEmailFromDocId(customerDocId: string): string {
  const safe = normalizePhoneDigits(customerDocId);
  return `cust_${safe}@customer.sahadiesel.local`;
}
