"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createJob = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const location_1 = require("./location");
/**
 * เปิดใบงาน — ให้เว็บและแอป Android เรียกฟังก์ชันเดียวกัน (region us-central1)
 *
 * ก่อนเรียก ให้อัปโหลดรูปเข้า Firebase Storage ใต้ jobs/ แล้วส่ง download URL มาใน photos
 * ฟังก์ชันอ่านลูกค้า ออกเลขที่ใบงาน และเขียน jobs + activities เอง
 * ไม่รับ customerSnapshot / jobNo / status จากไคลเอนต์
 *
 * data: {
 *   customerId: string
 *   department: "OFFICE" | "CAR_SERVICE" | "COMMONRAIL" | "MECHANIC" | "OUTSOURCE"
 *   description: string
 *   photos: string[]          // 1–4 download URL
 *   carServiceDetails?: { brand, model, licensePlate }
 *   commonrailDetails?: { brand, partNumber, registrationNumber }
 *   mechanicDetails?: { brand, partNumber, registrationNumber }
 * }
 * returns: { jobId, jobNo }
 */
const JOB_DEPARTMENTS = ["OFFICE", "CAR_SERVICE", "COMMONRAIL", "MECHANIC", "OUTSOURCE"];
const DEPARTMENT_LABELS = {
    OFFICE: "แผนกออฟฟิศ",
    CAR_SERVICE: "งานซ่อมหน้าร้าน",
    COMMONRAIL: "แผนกคอมมอนเรล",
    MECHANIC: "แผนกแมคคานิค",
    OUTSOURCE: "งานนอก",
};
const MAX_DESCRIPTION = 1000;
const MAX_DETAIL = 200;
const MAX_PHOTOS = 4;
function db() {
    return (0, firestore_1.getFirestore)(location_1.FIRESTORE_DATABASE_ID);
}
function sanitizeForFirestore(data) {
    if (Array.isArray(data)) {
        return data.map((v) => sanitizeForFirestore(v)).filter((v) => v !== undefined);
    }
    if (data !== null && typeof data === "object") {
        if (Object.getPrototypeOf(data) !== Object.prototype)
            return data;
        const out = {};
        for (const [key, value] of Object.entries(data)) {
            if (value === undefined)
                continue;
            const sanitized = sanitizeForFirestore(value);
            if (sanitized !== undefined)
                out[key] = sanitized;
        }
        return out;
    }
    return data;
}
function extractSequenceFromJobNo(jobNo) {
    if (!jobNo)
        return 0;
    const parts = jobNo.split("-");
    if (parts.length < 2)
        return 0;
    const num = parseInt(parts[parts.length - 1], 10);
    return Number.isNaN(num) ? 0 : num;
}
function sanitizeJobPrefix(raw) {
    const p = String(raw || "SJ")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
    return p || "SJ";
}
function normalizeYear(year) {
    return year > 2400 ? year - 543 : year;
}
async function maxJobNoSequenceInCollection(collectionId, prefix, year) {
    const prefixYear = `${prefix}${year}-`;
    try {
        const snap = await db()
            .collection(collectionId)
            .where("jobNo", ">=", prefixYear)
            .where("jobNo", "<=", prefixYear + "\uf8ff")
            .orderBy("jobNo", "desc")
            .limit(1)
            .get();
        if (snap.empty)
            return 0;
        return extractSequenceFromJobNo(String(snap.docs[0].data().jobNo || ""));
    }
    catch (error) {
        console.error(`maxJobNoSequenceInCollection ${collectionId} failed`, error);
        return 0;
    }
}
function projectBuckets() {
    const buckets = new Set();
    const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
    if (project) {
        buckets.add(`${project}.appspot.com`);
        buckets.add(`${project}.firebasestorage.app`);
    }
    buckets.add(location_1.STORAGE_BUCKET);
    if (process.env.FIREBASE_CONFIG) {
        try {
            const parsed = JSON.parse(process.env.FIREBASE_CONFIG);
            if (parsed.storageBucket)
                buckets.add(parsed.storageBucket);
        }
        catch {
            /* ignore malformed config */
        }
    }
    return buckets;
}
function decodeObjectPath(raw) {
    try {
        return decodeURIComponent(raw);
    }
    catch {
        return null;
    }
}
function objectPathFromPhotoUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return null;
    }
    if (parsed.protocol !== "https:")
        return null;
    const buckets = projectBuckets();
    const apiMatch = parsed.pathname.match(/\/b\/([^/]+)\/o\/(.+)$/) ||
        parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (apiMatch) {
        const bucket = decodeObjectPath(apiMatch[1]);
        const objectPath = decodeObjectPath(apiMatch[2]);
        if (bucket && objectPath && buckets.has(bucket))
            return objectPath;
    }
    const host = parsed.hostname;
    if (host === "storage.googleapis.com") {
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (parts.length >= 2 && buckets.has(parts[0])) {
            return decodeObjectPath(parts.slice(1).join("/"));
        }
        return null;
    }
    if (buckets.has(host)) {
        return decodeObjectPath(parsed.pathname.replace(/^\//, ""));
    }
    return null;
}
function assertJobPhotoUrl(url) {
    if (typeof url !== "string" || url.length === 0 || url.length > 2048) {
        throw new https_1.HttpsError("invalid-argument", "ลิงก์รูปภาพไม่ถูกต้อง");
    }
    const objectPath = objectPathFromPhotoUrl(url);
    if (!objectPath || !objectPath.startsWith("jobs/") || objectPath.includes("..")) {
        throw new https_1.HttpsError("invalid-argument", "รูปภาพต้องอัปโหลดเข้าที่เก็บของระบบก่อน");
    }
    return url;
}
function requiredText(value, label, max) {
    if (typeof value !== "string") {
        throw new https_1.HttpsError("invalid-argument", `กรุณาระบุ${label}`);
    }
    const text = value.trim();
    if (!text)
        throw new https_1.HttpsError("invalid-argument", `กรุณาระบุ${label}`);
    if (text.length > max) {
        throw new https_1.HttpsError("invalid-argument", `${label}ต้องไม่เกิน ${max} ตัวอักษร`);
    }
    return text;
}
function detailRecord(raw, label) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new https_1.HttpsError("invalid-argument", `กรุณาระบุ${label}`);
    }
    return raw;
}
function assertCanOpenJob(user) {
    const role = String(user.role || "");
    const department = String(user.department || "");
    const status = user.status;
    if (status && status !== "ACTIVE") {
        throw new https_1.HttpsError("permission-denied", "บัญชียังไม่พร้อมใช้งาน");
    }
    if (role === "VIEWER" || role === "CUSTOMER" || !role) {
        throw new https_1.HttpsError("permission-denied", "ไม่มีสิทธิ์เปิดงานใหม่");
    }
    const allowed = role === "ADMIN" || role === "MANAGER" || department === "OFFICE";
    if (!allowed) {
        throw new https_1.HttpsError("permission-denied", "เปิดงานใหม่ได้เฉพาะแอดมิน ผู้จัดการ หรือแผนกออฟฟิศ");
    }
}
exports.createJob = (0, https_1.onCall)({ region: "us-central1", cors: true, invoker: "public" }, async (request) => {
    var _a, _b;
    if (!((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid)) {
        throw new https_1.HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
    }
    const uid = request.auth.uid;
    const userSnap = await db().collection("users").doc(uid).get();
    if (!userSnap.exists) {
        throw new https_1.HttpsError("failed-precondition", "ไม่พบบัญชีผู้ใช้");
    }
    const user = userSnap.data();
    assertCanOpenJob(user);
    const payload = (request.data || {});
    const customerId = requiredText(payload.customerId, "ลูกค้า", 200);
    if (customerId.includes("/")) {
        throw new https_1.HttpsError("invalid-argument", "รหัสลูกค้าไม่ถูกต้อง");
    }
    const department = String(payload.department || "");
    if (!JOB_DEPARTMENTS.includes(department)) {
        throw new https_1.HttpsError("invalid-argument", "กรุณาเลือกแผนก");
    }
    const dept = department;
    const description = requiredText(payload.description, "รายละเอียดงาน", MAX_DESCRIPTION);
    if (!Array.isArray(payload.photos) || payload.photos.length < 1) {
        throw new https_1.HttpsError("invalid-argument", "กรุณาแนบรูปภาพประกอบอย่างน้อย 1 รูป");
    }
    if (payload.photos.length > MAX_PHOTOS) {
        throw new https_1.HttpsError("invalid-argument", `แนบรูปได้สูงสุด ${MAX_PHOTOS} รูป`);
    }
    const photos = payload.photos.map((url) => assertJobPhotoUrl(url));
    const customerSnap = await db().collection("customers").doc(customerId).get();
    if (!customerSnap.exists) {
        throw new https_1.HttpsError("not-found", "ไม่พบลูกค้า");
    }
    const customer = customerSnap.data();
    const marketingSource = String(customer.acquisitionSource || "EXISTING");
    const isActuallyNew = marketingSource !== "EXISTING" && marketingSource !== "NONE";
    const jobData = {
        customerId,
        department: dept,
        mainDepartment: dept,
        description,
        customerSnapshot: { id: customerSnap.id, ...customer },
        customerType: isActuallyNew ? "NEW" : "EXISTING",
        customerAcquisitionSource: marketingSource,
        photos,
    };
    if (dept === "CAR_SERVICE") {
        const details = detailRecord(payload.carServiceDetails, "รายละเอียดรถยนต์");
        jobData.carServiceDetails = {
            brand: requiredText(details.brand, "ยี่ห้อรถ", MAX_DETAIL),
            model: requiredText(details.model, "รุ่นรถ", MAX_DETAIL),
            licensePlate: requiredText(details.licensePlate, "ทะเบียนรถ", MAX_DETAIL),
        };
    }
    if (dept === "COMMONRAIL" || dept === "MECHANIC") {
        const details = detailRecord(dept === "COMMONRAIL" ? payload.commonrailDetails : payload.mechanicDetails, "รายละเอียดชิ้นส่วน");
        const partDetails = {
            brand: requiredText(details.brand, "ยี่ห้อ", MAX_DETAIL),
            partNumber: requiredText(details.partNumber, "เลขอะไหล่", MAX_DETAIL),
            registrationNumber: requiredText(details.registrationNumber, "เลขทะเบียนชิ้นส่วน", MAX_DETAIL),
        };
        if (dept === "COMMONRAIL")
            jobData.commonrailDetails = partDetails;
        else
            jobData.mechanicDetails = partDetails;
    }
    const displayNameRaw = user.displayName;
    const emailRaw = user.email;
    const displayName = typeof displayNameRaw === "string" && displayNameRaw.trim()
        ? displayNameRaw.trim().slice(0, 200)
        : typeof emailRaw === "string" && emailRaw.trim()
            ? emailRaw.trim().slice(0, 200)
            : "พนักงาน";
    const newJobRef = db().collection("jobs").doc();
    if (newJobRef.id.length !== 20) {
        throw new https_1.HttpsError("internal", "สร้างรหัสใบงานไม่สำเร็จ");
    }
    const year = normalizeYear(new Date().getFullYear());
    const settingsSnap = await db().collection("settings").doc("documents").get();
    const prefix = sanitizeJobPrefix((_b = settingsSnap.data()) === null || _b === void 0 ? void 0 : _b.jobPrefix);
    const archiveName = `jobsArchive_${year}`;
    const activeMax = await maxJobNoSequenceInCollection("jobs", prefix, year);
    const archivedMax = await maxJobNoSequenceInCollection(archiveName, prefix, year);
    const bootstrapMax = Math.max(activeMax, archivedMax);
    const counterRef = db().collection("documentCounters").doc(String(year));
    const counterKey = `JOB_${prefix}_seq`;
    let assignedJobNo = "";
    await db().runTransaction(async (transaction) => {
        var _a;
        const counterSnap = await transaction.get(counterRef);
        const cur = Number((_a = counterSnap.data()) === null || _a === void 0 ? void 0 : _a[counterKey]) || 0;
        const nextSeq = Math.max(cur, bootstrapMax) + 1;
        assignedJobNo = `${prefix}${year}-${String(nextSeq).padStart(4, "0")}`;
        transaction.set(counterRef, { [counterKey]: nextSeq }, { merge: true });
        transaction.set(newJobRef, sanitizeForFirestore({
            ...jobData,
            id: newJobRef.id,
            jobNo: assignedJobNo,
            status: "RECEIVED",
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            lastActivityAt: firestore_1.FieldValue.serverTimestamp(),
        }));
        const deptLabel = DEPARTMENT_LABELS[dept] || dept;
        transaction.set(newJobRef.collection("activities").doc(), {
            text: `รับงาน (เปิดใบงาน) โดย ${displayName} · เลขที่ ${assignedJobNo} · แผนก ${deptLabel} · แนบรูปตอนรับงาน ${photos.length} รูป`,
            userName: displayName,
            userId: uid,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            photos,
        });
    });
    return { jobId: newJobRef.id, jobNo: assignedJobNo };
});
