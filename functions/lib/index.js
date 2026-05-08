"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatWithJimmy = exports.migrateClosedJobsToArchive2026 = exports.closeJobAfterAccounting = exports.postJobCustomerChatMessage = exports.provisionCustomerPortalProfile = exports.rejectPortalCustomerRegistration = exports.lookupCustomerForPortalSignup = void 0;
const https_1 = require("firebase-functions/v2/https");
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const customerPortalSignup_1 = require("./customerPortalSignup");
Object.defineProperty(exports, "lookupCustomerForPortalSignup", { enumerable: true, get: function () { return customerPortalSignup_1.lookupCustomerForPortalSignup; } });
Object.defineProperty(exports, "rejectPortalCustomerRegistration", { enumerable: true, get: function () { return customerPortalSignup_1.rejectPortalCustomerRegistration; } });
Object.defineProperty(exports, "provisionCustomerPortalProfile", { enumerable: true, get: function () { return customerPortalSignup_1.provisionCustomerPortalProfile; } });
const jobCustomerChat_1 = require("./jobCustomerChat");
Object.defineProperty(exports, "postJobCustomerChatMessage", { enumerable: true, get: function () { return jobCustomerChat_1.postJobCustomerChatMessage; } });
(0, app_1.initializeApp)();
const db = (0, firestore_1.getFirestore)();
// --- 1. ฟังก์ชันปิดจ๊อบ (Close Job after Payment) ---
exports.closeJobAfterAccounting = (0, https_1.onCall)({ region: "us-central1", cors: true }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated.");
    const data = (request.data || {});
    const jobId = data.jobId;
    const paymentStatus = data.paymentStatus;
    if (!jobId)
        throw new https_1.HttpsError("invalid-argument", "Missing jobId.");
    try {
        const jobRef = db.collection("jobs").doc(jobId);
        const jobSnap = await jobRef.get();
        if (!jobSnap.exists)
            return { ok: true, alreadyClosed: true };
        const jobData = jobSnap.data();
        const now = new Date();
        const year = now.getFullYear();
        const closedDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
        const archiveRef = db.collection(`jobsArchive_${year}`).doc(jobId);
        const existingNo = jobData.jobNo && String(jobData.jobNo).trim();
        const inferredNo = existingNo ||
            (/^[A-Za-z]{1,8}\d{4}-\d{4,}$/.test(jobId) ? jobId : undefined);
        // Move main job data
        await archiveRef.set({
            ...jobData,
            ...(inferredNo ? { jobNo: inferredNo } : {}),
            status: "CLOSED",
            isArchived: true,
            archivedAt: firestore_1.FieldValue.serverTimestamp(),
            archivedAtDate: closedDate,
            closedDate: closedDate,
            paymentStatusAtClose: paymentStatus || "UNPAID",
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        // Move activities subcollection
        const activitiesSnap = await jobRef.collection("activities").get();
        if (!activitiesSnap.empty) {
            const batch = db.batch();
            activitiesSnap.docs.forEach(doc => {
                const newActRef = archiveRef.collection("activities").doc(doc.id);
                batch.set(newActRef, doc.data());
            });
            await batch.commit();
        }
        // Delete original job recursively
        await db.recursiveDelete(jobRef);
        return { ok: true, jobId };
    }
    catch (error) {
        console.error("Error in closeJobAfterAccounting:", error);
        throw new https_1.HttpsError("internal", (error === null || error === void 0 ? void 0 : error.message) || "Unknown error during closing");
    }
});
// --- 2. ฟังก์ชัน Migration (Fixing stuck CLOSED jobs) ---
exports.migrateClosedJobsToArchive2026 = (0, https_1.onCall)({ region: "us-central1", cors: true }, async (request) => {
    var _a;
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Auth required.");
    const userSnap = await db.collection("users").doc(request.auth.uid).get();
    const userData = userSnap.data();
    const isAdmin = (userData === null || userData === void 0 ? void 0 : userData.role) === "ADMIN" || (userData === null || userData === void 0 ? void 0 : userData.role) === "MANAGER" || (userData === null || userData === void 0 ? void 0 : userData.department) === "MANAGEMENT";
    if (!isAdmin)
        throw new https_1.HttpsError("permission-denied", "เฉพาะผู้ดูแลระบบเท่านั้นที่ทำรายการนี้ได้ค่ะ");
    const limitCount = Math.min(((_a = request.data) === null || _a === void 0 ? void 0 : _a.limit) || 40, 40);
    const closedJobsSnap = await db.collection("jobs").where("status", "==", "CLOSED").limit(limitCount).get();
    let migrated = 0;
    let skipped = 0;
    const errors = [];
    const now = new Date();
    const currentYear = now.getFullYear();
    const defaultClosedDate = now.toISOString().split('T')[0];
    for (const jobDoc of closedJobsSnap.docs) {
        try {
            const jobId = jobDoc.id;
            const jobData = jobDoc.data();
            let jobDate = jobData.closedDate || defaultClosedDate;
            if (!jobData.closedDate && jobData.updatedAt) {
                try {
                    const updatedVal = jobData.updatedAt;
                    const d = updatedVal.toDate ? updatedVal.toDate() : new Date(updatedVal);
                    jobDate = d.toISOString().split('T')[0];
                }
                catch (e) {
                    jobDate = defaultClosedDate;
                }
            }
            const rawYearStr = jobDate.split('-')[0];
            const archiveYear = parseInt(rawYearStr) || currentYear;
            const archiveRef = db.collection(`jobsArchive_${archiveYear}`).doc(jobId);
            const archiveSnap = await archiveRef.get();
            if (!archiveSnap.exists) {
                const mExistingNo = jobData.jobNo && String(jobData.jobNo).trim();
                const mInferredNo = mExistingNo ||
                    (/^[A-Za-z]{1,8}\d{4}-\d{4,}$/.test(jobId) ? jobId : undefined);
                await archiveRef.set({
                    ...jobData,
                    ...(mInferredNo ? { jobNo: mInferredNo } : {}),
                    status: "CLOSED",
                    isArchived: true,
                    archivedAt: firestore_1.FieldValue.serverTimestamp(),
                    archivedAtDate: jobDate,
                    closedDate: jobDate,
                    archivedByUid: request.auth.uid,
                    archivedByName: (userData === null || userData === void 0 ? void 0 : userData.displayName) || "Admin",
                    updatedAt: firestore_1.FieldValue.serverTimestamp(),
                });
                const activitiesSnap = await jobDoc.ref.collection("activities").get();
                if (!activitiesSnap.empty) {
                    const batch = db.batch();
                    activitiesSnap.docs.forEach(actDoc => {
                        const newActRef = archiveRef.collection("activities").doc(actDoc.id);
                        batch.set(newActRef, actDoc.data());
                    });
                    await batch.commit();
                }
                migrated++;
            }
            else {
                skipped++;
            }
            await db.recursiveDelete(jobDoc.ref);
        }
        catch (e) {
            console.error(`Migration error for job ${jobDoc.id}:`, e);
            errors.push({ jobId: jobDoc.id, message: (e === null || e === void 0 ? void 0 : e.message) || "Unknown error during migration" });
        }
    }
    return { totalFound: closedJobsSnap.size, migrated, skipped, errors };
});
// --- 3. ฟังก์ชัน น้องจิมมี่ (DISABLED - API Cost Control) ---
exports.chatWithJimmy = (0, https_1.onCall)({ region: "us-central1", cors: true }, async (request) => {
    // Completely disable logic to prevent any billing
    throw new https_1.HttpsError("failed-precondition", "ฟีเจอร์ AI นี้ถูกยกเลิกการใช้งานอย่างถาวรเพื่อลดค่าใช้จ่ายค่ะ");
});
