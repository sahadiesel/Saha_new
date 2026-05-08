"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.postJobCustomerChatMessage = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const phone_utils_1 = require("./phone-utils");
/** เรียกเมื่อรันจริงเท่านั้น — ห้าม top-level getFirestore() เพราะ index.ts import โมดูลนี้ก่อน initializeApp() */
function db() {
    return (0, firestore_1.getFirestore)();
}
/**
 * ลูกค้าส่งข้อความแชตต่อ job — ตรวจสิทธิ์ด้วยเบอร์มาตรฐาน (เทียบกับ customerId / snapshot ของงาน)
 * เพื่อหลีกเลี่ยง PERMISSION_DENIED เมื่อกฎ Firestore เทียบ string ตรงๆ ไม่ตรงกับรูปแบบเบอร์
 */
exports.postJobCustomerChatMessage = (0, https_1.onCall)({ region: "us-central1", cors: true, invoker: "public" }, async (request) => {
    var _a;
    if (!((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid)) {
        throw new https_1.HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
    }
    const payload = (request.data || {});
    const jobId = String(payload.jobId || "").trim();
    const text = String(payload.text || "").trim();
    if (!jobId) {
        throw new https_1.HttpsError("invalid-argument", "ไม่พบรหัสงาน");
    }
    if (!text || text.length === 0) {
        throw new https_1.HttpsError("invalid-argument", "กรุณากรอกข้อความ");
    }
    if (text.length > 4000) {
        throw new https_1.HttpsError("invalid-argument", "ข้อความยาวเกิน 4000 ตัวอักษร");
    }
    const uid = request.auth.uid;
    const userSnap = await db().collection("users").doc(uid).get();
    if (!userSnap.exists) {
        throw new https_1.HttpsError("failed-precondition", "ไม่พบบัญชีผู้ใช้");
    }
    const user = userSnap.data();
    if (user.role !== "CUSTOMER") {
        throw new https_1.HttpsError("permission-denied", "ใช้ได้เฉพาะบัญชีลูกค้า");
    }
    if (user.status !== "ACTIVE") {
        throw new https_1.HttpsError("permission-denied", "บัญชียังไม่พร้อมใช้งาน");
    }
    const profilePhone = (0, phone_utils_1.customerDocumentIdFromPhone)(String(user.phone || ""));
    if (!profilePhone) {
        throw new https_1.HttpsError("failed-precondition", "ไม่มีเบอร์โทรในโปรไฟล์");
    }
    const jobRef = db().collection("jobs").doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) {
        throw new https_1.HttpsError("not-found", "ไม่พบงาน");
    }
    const job = jobSnap.data();
    const jobCustId = (0, phone_utils_1.customerDocumentIdFromPhone)(String(job.customerId || ""));
    const snap = job.customerSnapshot;
    const snapPhone = (snap === null || snap === void 0 ? void 0 : snap.phone) ? (0, phone_utils_1.customerDocumentIdFromPhone)(String(snap.phone)) : "";
    if (profilePhone !== jobCustId && profilePhone !== snapPhone) {
        throw new https_1.HttpsError("permission-denied", "ไม่ใช่เจ้าของงาน");
    }
    const dn = user.displayName;
    const em = user.email;
    const userName = typeof dn === "string" && dn.trim()
        ? dn.trim().slice(0, 200)
        : typeof em === "string" && em.trim()
            ? em.trim().slice(0, 200)
            : "ผู้ใช้";
    const msgRef = jobRef.collection("customerChat").doc();
    const batch = db().batch();
    batch.set(msgRef, {
        text,
        authorRole: "CUSTOMER",
        userName,
        userId: uid,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
    batch.set(jobRef, { customerChatLastCustomerMessageAt: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
    await batch.commit();
    return { ok: true };
});
