"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminResetCustomerPasswordAfterForgot = exports.submitCustomerPasswordResetRequest = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
const customerPortalSignup_1 = require("./customerPortalSignup");
const phone_utils_1 = require("./phone-utils");
function normalizeNationalIdDigits(raw) {
    return (0, phone_utils_1.normalizePhoneDigits)(String(raw || "").trim());
}
function isValidThaiNationalId13(digits) {
    return /^[0-9]{13}$/.test(digits);
}
async function assertCallerIsAdmin(uid) {
    var _a;
    const db = (0, firestore_1.getFirestore)();
    const snap = await db.collection("users").doc(uid).get();
    const role = (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.role;
    if (role !== "ADMIN") {
        throw new https_1.HttpsError("permission-denied", "เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น");
    }
}
/**
 * ลูกค้ายื่นคำขอลืมรหัส — ตรวจเบอร์ + เลขบัตรตรงกับ customers และบัญชี ACTIVE
 */
exports.submitCustomerPasswordResetRequest = (0, https_1.onCall)({ region: "us-central1", cors: true, invoker: "public" }, async (request) => {
    const payload = (request.data || {});
    const phoneRaw = String(payload.phone || "").trim();
    const nidSubmitted = normalizeNationalIdDigits(String(payload.nationalId || ""));
    if (!phoneRaw || phoneRaw.length < 9) {
        throw new https_1.HttpsError("invalid-argument", "กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง");
    }
    if (!isValidThaiNationalId13(nidSubmitted)) {
        throw new https_1.HttpsError("invalid-argument", "เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก");
    }
    const db = (0, firestore_1.getFirestore)();
    let customer;
    try {
        customer = await (0, customerPortalSignup_1.findCustomerDocByPhoneRaw)(phoneRaw);
    }
    catch (e) {
        if (e instanceof https_1.HttpsError)
            throw e;
        throw new https_1.HttpsError("failed-precondition", "ตรวจสอบข้อมูลไม่สำเร็จ กรุณาลองใหม่");
    }
    if (!(customer === null || customer === void 0 ? void 0 : customer.exists)) {
        throw new https_1.HttpsError("failed-precondition", "ข้อมูลไม่ตรงกับในระบบ กรุณาตรวจสอบเบอร์และเลขบัตรประชาชน หรือติดต่อศูนย์บริการ");
    }
    const data = customer.data() || {};
    const registration = await (0, customerPortalSignup_1.registrationStateForCustomer)(customer);
    if (registration !== "ACTIVE") {
        throw new https_1.HttpsError("failed-precondition", "บัญชีพอร์ทัลยังไม่พร้อมใช้งานหรือยังไม่ได้เปิดใช้ กรุณาติดต่อศูนย์บริการ");
    }
    const nidOnFile = normalizeNationalIdDigits(String(data.nationalId || ""));
    if (!nidOnFile || !isValidThaiNationalId13(nidOnFile)) {
        throw new https_1.HttpsError("failed-precondition", "ยังไม่มีเลขบัตรประชาชนในระบบสำหรับเบอร์นี้ กรุณาติดต่อศูนย์บริการ");
    }
    if (nidOnFile !== nidSubmitted) {
        throw new https_1.HttpsError("failed-precondition", "ข้อมูลไม่ตรงกับในระบบ กรุณาตรวจสอบเบอร์และเลขบัตรประชาชน หรือติดต่อศูนย์บริการ");
    }
    const authUid = data.authUid;
    if (!authUid) {
        throw new https_1.HttpsError("failed-precondition", "ไม่พบการผูกบัญชีพอร์ทัล กรุณาติดต่อศูนย์บริการ");
    }
    const pendingSnap = await db
        .collection("customerPasswordResetRequests")
        .where("authUid", "==", authUid)
        .where("status", "==", "PENDING")
        .limit(1)
        .get();
    if (!pendingSnap.empty) {
        throw new https_1.HttpsError("already-exists", "มีคำขอรีเซ็ตรหัสผ่านค้างอยู่แล้ว — กรุณารอเจ้าหน้าที่ติดต่อกลับจากศูนย์บริการ");
    }
    const customerName = String(data.name || "").trim() || "(ไม่มีชื่อในระบบ)";
    const phoneCanonical = customer.id;
    await db.collection("customerPasswordResetRequests").add({
        customerId: phoneCanonical,
        phone: phoneCanonical,
        customerName,
        nationalIdOnFile: nidOnFile,
        nationalIdSubmitted: nidSubmitted,
        authUid,
        status: "PENDING",
        createdAt: firestore_1.FieldValue.serverTimestamp(),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    });
    return { ok: true };
});
/** Admin ตั้งรหัสชั่วคราว + บังคับลูกค้าเปลี่ยนรหัสเมื่อเข้าครั้งถัดไป */
exports.adminResetCustomerPasswordAfterForgot = (0, https_1.onCall)({ region: "us-central1", cors: true, invoker: "public" }, async (request) => {
    var _a;
    if (!((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid)) {
        throw new https_1.HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
    }
    await assertCallerIsAdmin(request.auth.uid);
    const payload = (request.data || {});
    const requestDocId = String(payload.requestDocId || "").trim();
    const newPassword = String(payload.newPassword || "");
    if (!requestDocId) {
        throw new https_1.HttpsError("invalid-argument", "ไม่พบรายการคำขอ");
    }
    if (!newPassword || newPassword.length < 6) {
        throw new https_1.HttpsError("invalid-argument", "รหัสผ่านอย่างน้อย 6 ตัวอักษร");
    }
    const db = (0, firestore_1.getFirestore)();
    const reqRef = db.collection("customerPasswordResetRequests").doc(requestDocId);
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists) {
        throw new https_1.HttpsError("not-found", "ไม่พบคำขอรีเซ็ตรหัสผ่าน");
    }
    const reqData = reqSnap.data();
    if (reqData.status !== "PENDING") {
        throw new https_1.HttpsError("failed-precondition", "รายการนี้ดำเนินการแล้วหรือถูกปิด");
    }
    const authUid = String(reqData.authUid || "").trim();
    if (!authUid) {
        throw new https_1.HttpsError("failed-precondition", "ข้อมูลคำขอไม่สมบูรณ์");
    }
    const userSnap = await db.collection("users").doc(authUid).get();
    if (!userSnap.exists) {
        throw new https_1.HttpsError("not-found", "ไม่พบบัญชีผู้ใช้ลูกค้า");
    }
    const uData = userSnap.data();
    if (uData.role !== "CUSTOMER" || uData.status !== "ACTIVE") {
        throw new https_1.HttpsError("failed-precondition", "บัญชีลูกค้าไม่พร้อมให้รีเซ็ตรหัสในขณะนี้");
    }
    try {
        await (0, auth_1.getAuth)().updateUser(authUid, { password: newPassword });
    }
    catch (e) {
        console.error("adminResetCustomerPasswordAfterForgot updateUser", e);
        throw new https_1.HttpsError("internal", "ไม่สามารถตั้งรหัสผ่านใหม่ในระบบยืนยันตัวตนได้");
    }
    await db
        .collection("users")
        .doc(authUid)
        .set({
        mustChangePassword: true,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    }, { merge: true });
    await reqRef.set({
        status: "COMPLETED",
        completedAt: firestore_1.FieldValue.serverTimestamp(),
        completedByUid: request.auth.uid,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true };
});
