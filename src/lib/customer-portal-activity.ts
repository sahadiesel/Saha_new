import { JOB_STATUSES } from "@/lib/constants";
import { JOB_STATUS_LABELS } from "@/lib/ui-labels";

/** กรอง log ที่ลูกค้าน่าจะเห็นได้ (เน้นอัปเดตความคืบหน้า/สถานะ ไม่ใช่รายละเอียดภายใน) */
export function isCustomerFacingActivityText(text: string): boolean {
  const t = String(text || "");
  if (!t.trim()) return false;
  if (/สถานะ|อัปเดต|เปลี่ยน|ปิดงาน|รับงาน|รับรถ|ส่งมอบ|ใบงาน|ความคืบหน้า|แจ้ง/i.test(t)) {
    return true;
  }
  for (const s of JOB_STATUSES) {
    if (t.includes(s)) return true;
    const th = JOB_STATUS_LABELS[s];
    if (th && t.includes(th)) return true;
  }
  return false;
}
