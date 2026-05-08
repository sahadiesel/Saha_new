import { doc, getDoc, type Firestore } from "firebase/firestore";
import type { Document, UserProfile } from "@/lib/types";

/**
 * ตรวจว่าลูกค้า (เบอร์โทรในโปรไฟล์) มีสิทธิ์เปิดเอกสารนี้หรือไม่
 * — ผูกผ่าน jobId → jobs.customerId หรือเบอร์ใน customerSnapshot
 */
export async function customerCanViewDocument(db: Firestore, document: Document, customerPhone: string): Promise<boolean> {
  const phone = customerPhone.trim();
  if (!phone) return false;

  if (document.jobId) {
    const live = await getDoc(doc(db, "jobs", document.jobId));
    if (live.exists() && String((live.data() as { customerId?: string }).customerId || "") === phone) {
      return true;
    }
    const y0 = new Date().getFullYear();
    for (let i = 0; i < 8; i++) {
      const col = `jobsArchive_${y0 - i}`;
      const ar = await getDoc(doc(db, col, document.jobId));
      if (ar.exists() && String((ar.data() as { customerId?: string }).customerId || "") === phone) {
        return true;
      }
    }
    return false;
  }

  const snapPhone = String(document.customerSnapshot?.phone || "").trim();
  const custId = String(document.customerId || "").trim();
  return snapPhone === phone || custId === phone;
}

/** พนักงานที่เปิดใบเสนอราคาจากลิงก์พอร์ทัลเพื่อบันทึกแทนลูกค้าได้ — จำกัดแผนกออฟฟิศ/บริหารหรือแอดมิน */
export function isOfficePortalQuotationActor(profile: UserProfile | null): boolean {
  if (!profile || profile.role === "VIEWER" || profile.role === "CUSTOMER") return false;
  return profile.role === "ADMIN" || profile.department === "OFFICE" || profile.department === "MANAGEMENT";
}

/**
 * ใครเปิด `/customer/documents/:id` ได้บ้าง
 * — ลูกค้า: ตาม customerCanViewDocument
 * — เจ้าหน้าที่: เฉพาะใบเสนอราคาที่ผูกกับงาน (salesDocId ตรงกับเอกสารนี้)
 */
export async function resolveCustomerDocumentViewerAccess(
  db: Firestore,
  document: Document,
  profile: UserProfile
): Promise<"customer" | "office" | null> {
  if (profile.role === "VIEWER") return null;

  if (profile.role === "CUSTOMER") {
    const phone = profile.phone?.trim() || "";
    if (!phone) return null;
    const ok = await customerCanViewDocument(db, document, phone);
    return ok ? "customer" : null;
  }

  if (document.docType !== "QUOTATION") return null;
  if (!isOfficePortalQuotationActor(profile)) return null;
  if (!document.jobId) return null;

  const jobSnap = await getDoc(doc(db, "jobs", document.jobId));
  if (!jobSnap.exists()) return null;
  const salesDocId = String((jobSnap.data() as { salesDocId?: string }).salesDocId || "");
  if (salesDocId !== document.id) return null;

  return "office";
}
