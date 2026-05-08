"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rejectPortalCustomerRegistration = exports.provisionCustomerPortalProfile = exports.lookupCustomerForPortalSignup = void 0;
exports.findCustomerDocByPhoneRaw = findCustomerDocByPhoneRaw;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
const phone_utils_1 = require("./phone-utils");
function isLegalFullName(displayName) {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    return parts.length >= 2 && parts.every((p) => p.length >= 2);
}
function isValidThaiNationalId13(digits) {
    return /^[0-9]{13}$/.test(digits);
}
function isSubstantialIdCardAddress(addr) {
    return addr.trim().length >= 15;
}
async function collectCustomerCandidates(tokens) {
    const db = (0, firestore_1.getFirestore)();
    const byId = new Map();
    for (const t of tokens) {
        if (!t || t.length < 9)
            continue;
        const d = await db.collection("customers").doc(t).get();
        if (d.exists) {
            byId.set(d.id, d);
        }
    }
    for (const t of tokens) {
        if (!t)
            continue;
        const qPhone = await db.collection("customers").where("phone", "==", t).limit(25).get();
        for (const d of qPhone.docs) {
            byId.set(d.id, d);
        }
        const qPhones = await db.collection("customers").where("phones", "array-contains", t).limit(25).get();
        for (const d of qPhones.docs) {
            byId.set(d.id, d);
        }
    }
    return [...byId.values()];
}
async function findCustomerDocByPhoneRaw(raw) {
    var _a;
    const tokens = (0, phone_utils_1.phoneSearchTokens)(raw);
    if (tokens.every((t) => !t || t.length < 9)) {
        return null;
    }
    const candidates = await collectCustomerCandidates(tokens);
    if (candidates.length === 0)
        return null;
    if (candidates.length > 1) {
        const ids = new Set(candidates.map((c) => c.id));
        if (ids.size > 1) {
            throw new https_1.HttpsError("failed-precondition", "พบเบอร์ซ้ำในหลายรายชื่อลูกค้า กรุณาติดต่อศูนย์ค่ะ");
        }
    }
    return (_a = candidates[0]) !== null && _a !== void 0 ? _a : null;
}
async function registrationStateForCustomer(customer) {
    var _a, _b;
    const db = (0, firestore_1.getFirestore)();
    const authUid = (_a = customer.data()) === null || _a === void 0 ? void 0 : _a.authUid;
    if (!authUid)
        return "NONE";
    const u = await db.collection("users").doc(authUid).get();
    if (!u.exists)
        return "NONE";
    const st = (_b = u.data()) === null || _b === void 0 ? void 0 : _b.status;
    if (st === "ACTIVE")
        return "ACTIVE";
    if (st === "PENDING")
        return "PENDING";
    return "NONE";
}
/** ค้นหาลูกค้าจากเบอร์ (ไม่ต้องล็อกอิน) — ส่งเฉพาะข้อมูลที่จำเป็นสำหรับฟอร์มสมัคร */
exports.lookupCustomerForPortalSignup = (0, https_1.onCall)({
    region: "us-central1",
    cors: true,
    /** Gen 2 รันบน Cloud Run — ต้องเปิด public invoker ไม่งั้นผู้ไม่ล็อกอินเรียกแล้วได้ INTERNAL */
    invoker: "public",
}, async (request) => {
    var _a;
    const phone = String(((_a = request.data) === null || _a === void 0 ? void 0 : _a.phone) || "").trim();
    if (!phone || phone.length < 9) {
        throw new https_1.HttpsError("invalid-argument", "กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง");
    }
    try {
        const customer = await findCustomerDocByPhoneRaw(phone);
        if (!customer || !customer.exists) {
            return {
                found: false,
            };
        }
        const data = customer.data() || {};
        const registration = await registrationStateForCustomer(customer);
        return {
            found: true,
            customerId: customer.id,
            name: data.name || "",
            nationalId: data.nationalId || "",
            idCardAddress: data.idCardAddress || "",
            registration,
        };
    }
    catch (e) {
        if (e instanceof https_1.HttpsError)
            throw e;
        console.error("lookupCustomerForPortalSignup", e);
        // ใช้รหัสที่ไม่ใช่ internal เพื่อให้ข้อความไทยส่งถึง client ได้ (internal มักถูกตัดเหลือแค่ "internal")
        throw new https_1.HttpsError("failed-precondition", "ระบบตรวจสอบเบอร์ขัดข้องชั่วคราว กรุณาลองใหม่ หรือแจ้งผู้ดูแลให้ตรวจสอบว่า deploy Cloud Functions แล้ว");
    }
});
/**
 * หลัง createUserWithEmailAndPassword สำเร็จแล้ว — เขียน users + customers ด้วย Admin SDK
 * (หลีกเลี่ยง PERMISSION_DENIED จาก Firestore rules บน client)
 */
exports.provisionCustomerPortalProfile = (0, https_1.onCall)({
    region: "us-central1",
    cors: true,
    /** Cloud Run ต้องเปิด invoker — ภายในยังตรวจ request.auth อยู่ */
    invoker: "public",
}, async (request) => {
    var _a;
    if (!((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid)) {
        throw new https_1.HttpsError("unauthenticated", "ต้องเข้าสู่ระบบหลังสมัครก่อนบันทึกโปรไฟล์");
    }
    const uid = request.auth.uid;
    const payload = (request.data || {});
    const phoneRaw = String(payload.phoneRaw || "").trim();
    const displayName = String(payload.displayName || "").trim();
    const nid = (0, phone_utils_1.normalizePhoneDigits)(String(payload.nationalId || ""));
    const addr = String(payload.idCardAddress || "").trim();
    if (!isLegalFullName(displayName)) {
        throw new https_1.HttpsError("invalid-argument", "กรุณากรอกชื่อและนามสกุลจริงให้ครบ");
    }
    if (!isValidThaiNationalId13(nid)) {
        throw new https_1.HttpsError("invalid-argument", "เลขบัตรประชาชนไม่ถูกต้อง");
    }
    if (!isSubstantialIdCardAddress(addr)) {
        throw new https_1.HttpsError("invalid-argument", "กรุณากรอกที่อยู่ตามบัตรให้ครบถ้วน");
    }
    if (!phoneRaw || phoneRaw.length < 9) {
        throw new https_1.HttpsError("invalid-argument", "เบอร์โทรไม่ถูกต้อง");
    }
    const db = (0, firestore_1.getFirestore)();
    let customer;
    try {
        const c = await findCustomerDocByPhoneRaw(phoneRaw);
        if (!(c === null || c === void 0 ? void 0 : c.exists)) {
            throw new https_1.HttpsError("failed-precondition", "ไม่พบเบอร์นี้ในรายชื่อลูกค้า");
        }
        customer = c;
    }
    catch (e) {
        if (e instanceof https_1.HttpsError)
            throw e;
        console.error("provisionCustomerPortalProfile lookup", e);
        throw new https_1.HttpsError("failed-precondition", "ค้นหาข้อมูลลูกค้าไม่สำเร็จ");
    }
    const registration = await registrationStateForCustomer(customer);
    if (registration === "ACTIVE") {
        throw new https_1.HttpsError("failed-precondition", "เบอร์นี้ลงทะเบียนแล้ว");
    }
    if (registration === "PENDING") {
        throw new https_1.HttpsError("failed-precondition", "เบอร์นี้อยู่ระหว่างรอการอนุมัติ");
    }
    const canonicalId = customer.id;
    const expectedEmail = (0, phone_utils_1.customerAuthEmailFromDocId)(canonicalId);
    let authUser;
    try {
        authUser = await (0, auth_1.getAuth)().getUser(uid);
    }
    catch (e) {
        console.error("provisionCustomerPortalProfile getUser", e);
        throw new https_1.HttpsError("failed-precondition", "ไม่พบบัญชีผู้ใช้ กรุณาลองสมัครใหม่");
    }
    const authEmail = (authUser.email || "").toLowerCase();
    if (authEmail !== expectedEmail.toLowerCase()) {
        throw new https_1.HttpsError("failed-precondition", "ข้อมูลบัญชีไม่ตรงกับรายชื่อลูกค้าในระบบ กรุณาติดต่อศูนย์");
    }
    const prev = customer.data() || {};
    const existingAuthUid = prev.authUid;
    if (existingAuthUid && existingAuthUid !== uid) {
        throw new https_1.HttpsError("failed-precondition", "เบอร์นี้ผูกบัญชีอื่นในระบบแล้ว กรุณาติดต่อศูนย์");
    }
    const mergedPhones = (0, phone_utils_1.dedupePhoneList)([
        ...(Array.isArray(prev.phones) ? prev.phones : []),
        ...(prev.phone ? [String(prev.phone)] : []),
        canonicalId,
        phoneRaw,
    ]);
    const custRef = db.collection("customers").doc(canonicalId);
    const custSnap = await custRef.get();
    await db
        .collection("users")
        .doc(uid)
        .set({
        displayName: displayName.trim(),
        email: expectedEmail,
        phone: canonicalId,
        role: "CUSTOMER",
        status: "PENDING",
        createdAt: firestore_1.FieldValue.serverTimestamp(),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    }, { merge: true });
    await custRef.set({
        name: displayName.trim(),
        phone: canonicalId,
        phones: mergedPhones.length > 0 ? mergedPhones : [canonicalId],
        nationalId: nid,
        idCardAddress: addr,
        authUid: uid,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
        ...(custSnap.exists ? {} : { createdAt: firestore_1.FieldValue.serverTimestamp() }),
    }, { merge: true });
    return { ok: true, customerId: canonicalId };
});
async function assertAdmin(uid) {
    var _a;
    const db = (0, firestore_1.getFirestore)();
    const snap = await db.collection("users").doc(uid).get();
    const role = (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.role;
    if (role !== "ADMIN") {
        throw new https_1.HttpsError("permission-denied", "เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น");
    }
}
/** ปฏิเสธการสมัครลูกค้า: ลบ Firebase Auth + ลบ users + เอา authUid ออกจาก customers */
exports.rejectPortalCustomerRegistration = (0, https_1.onCall)({ region: "us-central1", cors: true }, async (request) => {
    var _a, _b;
    if (!((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid)) {
        throw new https_1.HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
    }
    await assertAdmin(request.auth.uid);
    const payload = (request.data || {});
    const targetUid = String(payload.targetUid || "").trim();
    const customerId = String(payload.customerId || "").trim();
    if (!targetUid || !customerId) {
        throw new https_1.HttpsError("invalid-argument", "ข้อมูลไม่ครบ");
    }
    const db = (0, firestore_1.getFirestore)();
    const userSnap = await db.collection("users").doc(targetUid).get();
    if (!userSnap.exists) {
        throw new https_1.HttpsError("not-found", "ไม่พบผู้ใช้");
    }
    const uData = userSnap.data();
    if (uData.role !== "CUSTOMER" || uData.status !== "PENDING") {
        throw new https_1.HttpsError("failed-precondition", "รายการนี้ไม่อยู่ในสถานะรออนุมัติ");
    }
    const custRef = db.collection("customers").doc(customerId);
    const custSnap = await custRef.get();
    if (!custSnap.exists) {
        throw new https_1.HttpsError("not-found", "ไม่พบข้อมูลลูกค้า");
    }
    const authUid = (_b = custSnap.data()) === null || _b === void 0 ? void 0 : _b.authUid;
    if (authUid !== targetUid) {
        throw new https_1.HttpsError("failed-precondition", "ข้อมูลการผูกบัญชีไม่ตรงกัน");
    }
    try {
        await (0, auth_1.getAuth)().deleteUser(targetUid);
    }
    catch (e) {
        console.error("deleteUser", e);
        throw new https_1.HttpsError("internal", "ลบบัญชีผู้ใช้ไม่สำเร็จ (อาจถูกลบไปแล้ว)");
    }
    await db.collection("users").doc(targetUid).delete();
    await custRef.set({
        authUid: firestore_1.FieldValue.delete(),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true };
});
