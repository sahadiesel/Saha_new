import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { customerDocumentIdFromPhone } from "./phone-utils";

type Decision = "APPROVE" | "NO_REPAIR" | "REQUEST_CHANGES";
type MessageVariant = "jobPage" | "documentPage";

function actorLabel(
  user: { displayName?: unknown; email?: unknown },
  job: { customerSnapshot?: { name?: string } }
): string {
  const snapName = job.customerSnapshot?.name;
  if (typeof snapName === "string" && snapName.trim()) return snapName.trim();
  const dn = user.displayName;
  if (typeof dn === "string" && dn.trim()) return dn.trim();
  const em = user.email;
  if (typeof em === "string" && em.trim()) return em.trim();
  return "ลูกค้า";
}

function buildActivityText(
  decision: Decision,
  variant: MessageVariant,
  label: string
): string {
  if (decision === "APPROVE") {
    return variant === "documentPage"
      ? `อนุมัติใบเสนอราคาแล้ว โดย ${label} (ผ่านพอร์ทัลลูกค้า — ดูเอกสาร)`
      : `อนุมัติใบเสนอราคาแล้ว โดย ${label} (ผ่านพอร์ทัลลูกค้า)`;
  }
  if (decision === "NO_REPAIR") {
    return variant === "documentPage"
      ? `ลูกค้าแจ้งประสงค์ไม่ซ่อม ขอนำกลับ — โดย ${label} (ผ่านพอร์ทัล — ดูเอกสาร)`
      : `ลูกค้าแจ้งประสงค์ไม่ซ่อม ขอนำกลับ — โดย ${label} (ผ่านพอร์ทัลลูกค้า)`;
  }
  return `ขอแก้ไขรายการในใบเสนอราคา — โดย ${label} — สถานะงานยังอยู่ที่รอลูกค้าอนุมัติ — กรุณาติดต่อสหดีเซลตามเบอร์โทรของศูนย์ หรือส่งข้อความทางช่อง "Chat with สหดีเซล" ในพอร์ทัล`;
}

function userDisplayForActivity(user: { displayName?: unknown; email?: unknown; uid: string }): {
  userName: string;
  userId: string;
} {
  const dn = user.displayName;
  const em = user.email;
  const userName =
    typeof dn === "string" && dn.trim()
      ? dn.trim()
      : typeof em === "string" && em.trim()
        ? em.trim()
        : "ลูกค้า";
  return { userName, userId: user.uid };
}

/**
 * อนุมัติ/ไม่ซ่อม/ขอแก้ไขใบเสนอราคา — ลูกค้าเท่านั้น; เทียบเบอร์แบบ normalize (เดียวกับแชตพอร์ทัล)
 */
export const customerPortalQuotationDecision = onCall(
  { region: "us-central1", cors: true, invoker: "public" },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
    }

    const db = getFirestore();
    const payload = (request.data || {}) as {
      jobId?: string;
      decision?: string;
      messageVariant?: string;
    };
    const jobId = String(payload.jobId || "").trim();
    const decisionRaw = String(payload.decision || "").trim().toUpperCase();
    const variantRaw = String(payload.messageVariant || "jobPage").trim();

    const decision: Decision | null =
      decisionRaw === "APPROVE" || decisionRaw === "NO_REPAIR" || decisionRaw === "REQUEST_CHANGES"
        ? (decisionRaw as Decision)
        : null;
    const messageVariant: MessageVariant =
      variantRaw === "documentPage" ? "documentPage" : "jobPage";

    if (!jobId) throw new HttpsError("invalid-argument", "ไม่พบรหัสงาน");
    if (!decision) throw new HttpsError("invalid-argument", "ประเภทการตัดสินใจไม่ถูกต้อง");

    const uid = request.auth.uid;
    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists) throw new HttpsError("failed-precondition", "ไม่พบบัญชีผู้ใช้");
    const portalUser = userSnap.data()!;
    if (portalUser.role !== "CUSTOMER") {
      throw new HttpsError("permission-denied", "ใช้ได้เฉพาะบัญชีลูกค้า");
    }
    if (portalUser.status !== "ACTIVE") {
      throw new HttpsError("permission-denied", "บัญชียังไม่พร้อมใช้งาน");
    }

    const profilePhone = customerDocumentIdFromPhone(String(portalUser.phone || ""));
    if (!profilePhone) throw new HttpsError("failed-precondition", "ไม่มีเบอร์โทรในโปรไฟล์");

    const jobRef = db.collection("jobs").doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) throw new HttpsError("not-found", "ไม่พบงาน");
    const job = jobSnap.data()!;
    const jobCustId = customerDocumentIdFromPhone(String(job.customerId || ""));
    const snap = job.customerSnapshot as { phone?: string } | undefined;
    const snapPhone = snap?.phone ? customerDocumentIdFromPhone(String(snap.phone)) : "";

    if (profilePhone !== jobCustId && profilePhone !== snapPhone) {
      throw new HttpsError("permission-denied", "ไม่ใช่เจ้าของงาน");
    }

    if (job.status !== "WAITING_APPROVE") {
      throw new HttpsError("failed-precondition", "งานนี้ไม่อยู่ในสถานะรออนุมัติใบเสนอราคา");
    }

    const label = actorLabel(portalUser, job as { customerSnapshot?: { name?: string } });
    const activityText = buildActivityText(decision, messageVariant, label);
    const { userName, userId } = userDisplayForActivity({ ...portalUser, uid });

    const batch = db.batch();

    if (decision === "APPROVE") {
      batch.update(jobRef, {
        status: "PENDING_PARTS",
        salesDocStatus: "APPROVED",
        quotationAwaitingOfficeResubmit: false,
        lastActivityAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else if (decision === "NO_REPAIR") {
      batch.update(jobRef, {
        status: "DONE",
        quotationAwaitingOfficeResubmit: false,
        lastActivityAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else if (decision === "REQUEST_CHANGES") {
      batch.update(jobRef, {
        quotationAwaitingOfficeResubmit: true,
        lastActivityAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    const actRef = jobRef.collection("activities").doc();
    batch.set(actRef, {
      text: activityText,
      userName,
      userId,
      createdAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();
    return { ok: true as const };
  }
);
