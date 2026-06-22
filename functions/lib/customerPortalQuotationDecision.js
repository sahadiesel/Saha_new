"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.customerPortalQuotationDecision = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const phone_utils_1 = require("./phone-utils");
function actorLabel(user, job) {
    var _a;
    const snapName = (_a = job.customerSnapshot) === null || _a === void 0 ? void 0 : _a.name;
    if (typeof snapName === "string" && snapName.trim())
        return snapName.trim();
    const dn = user.displayName;
    if (typeof dn === "string" && dn.trim())
        return dn.trim();
    const em = user.email;
    if (typeof em === "string" && em.trim())
        return em.trim();
    return "ลูกค้า";
}
function buildActivityText(decision, variant, label) {
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
function userDisplayForActivity(user) {
    const dn = user.displayName;
    const em = user.email;
    const userName = typeof dn === "string" && dn.trim()
        ? dn.trim()
        : typeof em === "string" && em.trim()
            ? em.trim()
            : "ลูกค้า";
    return { userName, userId: user.uid };
}
/**
 * อนุมัติ/ไม่ซ่อม/ขอแก้ไขใบเสนอราคา — ลูกค้าเท่านั้น; เทียบเบอร์แบบ normalize (เดียวกับแชตพอร์ทัล)
 */
exports.customerPortalQuotationDecision = (0, https_1.onCall)({ region: "us-central1", cors: true, invoker: "public" }, async (request) => {
    var _a;
    if (!((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid)) {
        throw new https_1.HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
    }
    const db = (0, firestore_1.getFirestore)();
    const payload = (request.data || {});
    const jobId = String(payload.jobId || "").trim();
    const decisionRaw = String(payload.decision || "").trim().toUpperCase();
    const variantRaw = String(payload.messageVariant || "jobPage").trim();
    const decision = decisionRaw === "APPROVE" || decisionRaw === "NO_REPAIR" || decisionRaw === "REQUEST_CHANGES"
        ? decisionRaw
        : null;
    const messageVariant = variantRaw === "documentPage" ? "documentPage" : "jobPage";
    if (!jobId)
        throw new https_1.HttpsError("invalid-argument", "ไม่พบรหัสงาน");
    if (!decision)
        throw new https_1.HttpsError("invalid-argument", "ประเภทการตัดสินใจไม่ถูกต้อง");
    const uid = request.auth.uid;
    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists)
        throw new https_1.HttpsError("failed-precondition", "ไม่พบบัญชีผู้ใช้");
    const portalUser = userSnap.data();
    if (portalUser.role !== "CUSTOMER") {
        throw new https_1.HttpsError("permission-denied", "ใช้ได้เฉพาะบัญชีลูกค้า");
    }
    if (portalUser.status !== "ACTIVE") {
        throw new https_1.HttpsError("permission-denied", "บัญชียังไม่พร้อมใช้งาน");
    }
    const profilePhone = (0, phone_utils_1.customerDocumentIdFromPhone)(String(portalUser.phone || ""));
    if (!profilePhone)
        throw new https_1.HttpsError("failed-precondition", "ไม่มีเบอร์โทรในโปรไฟล์");
    const jobRef = db.collection("jobs").doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists)
        throw new https_1.HttpsError("not-found", "ไม่พบงาน");
    const job = jobSnap.data();
    const jobCustId = (0, phone_utils_1.customerDocumentIdFromPhone)(String(job.customerId || ""));
    const snap = job.customerSnapshot;
    const snapPhone = (snap === null || snap === void 0 ? void 0 : snap.phone) ? (0, phone_utils_1.customerDocumentIdFromPhone)(String(snap.phone)) : "";
    if (profilePhone !== jobCustId && profilePhone !== snapPhone) {
        throw new https_1.HttpsError("permission-denied", "ไม่ใช่เจ้าของงาน");
    }
    if (job.status !== "WAITING_APPROVE") {
        throw new https_1.HttpsError("failed-precondition", "งานนี้ไม่อยู่ในสถานะรออนุมัติใบเสนอราคา");
    }
    const label = actorLabel(portalUser, job);
    const activityText = buildActivityText(decision, messageVariant, label);
    const { userName, userId } = userDisplayForActivity({ ...portalUser, uid });
    const batch = db.batch();
    if (decision === "APPROVE") {
        batch.update(jobRef, {
            status: "PENDING_PARTS",
            salesDocStatus: "APPROVED",
            quotationAwaitingOfficeResubmit: false,
            lastActivityAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
    }
    else if (decision === "NO_REPAIR") {
        batch.update(jobRef, {
            status: "DONE",
            quotationAwaitingOfficeResubmit: false,
            lastActivityAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
    }
    else if (decision === "REQUEST_CHANGES") {
        batch.update(jobRef, {
            quotationAwaitingOfficeResubmit: true,
            lastActivityAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
    }
    const actRef = jobRef.collection("activities").doc();
    batch.set(actRef, {
        text: activityText,
        userName,
        userId,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
    await batch.commit();
    return { ok: true };
});
