import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { customerDocumentIdFromPhone } from "./phone-utils";

/** เรียกเมื่อรันจริงเท่านั้น — ห้าม top-level getFirestore() เพราะ index.ts import โมดูลนี้ก่อน initializeApp() */
function db() {
  return getFirestore();
}

/**
 * ลูกค้าส่งข้อความแชตต่อ job — ตรวจสิทธิ์ด้วยเบอร์มาตรฐาน (เทียบกับ customerId / snapshot ของงาน)
 * เพื่อหลีกเลี่ยง PERMISSION_DENIED เมื่อกฎ Firestore เทียบ string ตรงๆ ไม่ตรงกับรูปแบบเบอร์
 */
export const postJobCustomerChatMessage = onCall(
  { region: "us-central1", cors: true, invoker: "public" },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
    }

    const payload = (request.data || {}) as { jobId?: string; text?: string };
    const jobId = String(payload.jobId || "").trim();
    const text = String(payload.text || "").trim();

    if (!jobId) {
      throw new HttpsError("invalid-argument", "ไม่พบรหัสงาน");
    }
    if (!text || text.length === 0) {
      throw new HttpsError("invalid-argument", "กรุณากรอกข้อความ");
    }
    if (text.length > 4000) {
      throw new HttpsError("invalid-argument", "ข้อความยาวเกิน 4000 ตัวอักษร");
    }

    const uid = request.auth.uid;
    const userSnap = await db().collection("users").doc(uid).get();
    if (!userSnap.exists) {
      throw new HttpsError("failed-precondition", "ไม่พบบัญชีผู้ใช้");
    }
    const user = userSnap.data()!;
    if (user.role !== "CUSTOMER") {
      throw new HttpsError("permission-denied", "ใช้ได้เฉพาะบัญชีลูกค้า");
    }
    if (user.status !== "ACTIVE") {
      throw new HttpsError("permission-denied", "บัญชียังไม่พร้อมใช้งาน");
    }

    const profilePhone = customerDocumentIdFromPhone(String(user.phone || ""));
    if (!profilePhone) {
      throw new HttpsError("failed-precondition", "ไม่มีเบอร์โทรในโปรไฟล์");
    }

    const jobRef = db().collection("jobs").doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) {
      throw new HttpsError("not-found", "ไม่พบงาน");
    }
    const job = jobSnap.data()!;
    const jobCustId = customerDocumentIdFromPhone(String(job.customerId || ""));
    const snap = job.customerSnapshot as { phone?: string } | undefined;
    const snapPhone = snap?.phone ? customerDocumentIdFromPhone(String(snap.phone)) : "";

    if (profilePhone !== jobCustId && profilePhone !== snapPhone) {
      throw new HttpsError("permission-denied", "ไม่ใช่เจ้าของงาน");
    }

    const dn = user.displayName;
    const em = user.email;
    const userName =
      typeof dn === "string" && dn.trim()
        ? dn.trim().slice(0, 200)
        : typeof em === "string" && em.trim()
          ? em.trim().slice(0, 200)
          : "ผู้ใช้";

    await jobRef.collection("customerChat").add({
      text,
      authorRole: "CUSTOMER",
      userName,
      userId: uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { ok: true as const };
  }
);
