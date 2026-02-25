import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

initializeApp();
const db = getFirestore();

// --- 1. ฟังก์ชันปิดจ๊อบ (Close Job after Payment) ---
export const closeJobAfterAccounting = onCall(
  { region: "us-central1", cors: true }, 
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "User must be authenticated.");

    const data = (request.data || {}) as any;
    const jobId = data.jobId;
    const paymentStatus = data.paymentStatus;

    if (!jobId) throw new HttpsError("invalid-argument", "Missing jobId.");

    try {
      const jobRef = db.collection("jobs").doc(jobId);
      const jobSnap = await jobRef.get();
      if (!jobSnap.exists) return { ok: true, alreadyClosed: true };

      const jobData = jobSnap.data()!;
      const now = new Date();
      const year = now.getFullYear();
      const closedDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
      
      const archiveRef = db.collection(`jobsArchive_${year}`).doc(jobId);

      // Move main job data
      await archiveRef.set(
        {
          ...jobData,
          status: "CLOSED",
          isArchived: true,
          archivedAt: FieldValue.serverTimestamp(),
          archivedAtDate: closedDate,
          closedDate: closedDate,
          paymentStatusAtClose: paymentStatus || "UNPAID",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

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
    } catch (error: any) {
      console.error("Error in closeJobAfterAccounting:", error);
      throw new HttpsError("internal", error?.message || "Unknown error during closing");
    }
  }
);

// --- 2. ฟังก์ชัน Migration (Fixing stuck CLOSED jobs) ---
export const migrateClosedJobsToArchive2026 = onCall(
  { region: "us-central1", cors: true },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Auth required.");

    const userSnap = await db.collection("users").doc(request.auth.uid).get();
    const userData = userSnap.data();
    const isAdmin =
      userData?.role === "ADMIN" || userData?.role === "MANAGER" || userData?.department === "MANAGEMENT";
    
    if (!isAdmin) throw new HttpsError("permission-denied", "เฉพาะผู้ดูแลระบบเท่านั้นที่ทำรายการนี้ได้ค่ะ");

    const limitCount = Math.min(request.data?.limit || 40, 40);
    const closedJobsSnap = await db.collection("jobs").where("status", "==", "CLOSED").limit(limitCount).get();

    let migrated = 0;
    let skipped = 0;
    const errors: any[] = [];

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
            } catch (e) {
                jobDate = defaultClosedDate;
            }
        }
        
        const rawYearStr = jobDate.split('-')[0];
        const archiveYear = parseInt(rawYearStr) || currentYear;
        
        const archiveRef = db.collection(`jobsArchive_${archiveYear}`).doc(jobId);
        const archiveSnap = await archiveRef.get();

        if (!archiveSnap.exists) {
          await archiveRef.set({
            ...jobData,
            status: "CLOSED",
            isArchived: true,
            archivedAt: FieldValue.serverTimestamp(),
            archivedAtDate: jobDate,
            closedDate: jobDate,
            archivedByUid: request.auth.uid,
            archivedByName: userData?.displayName || "Admin",
            updatedAt: FieldValue.serverTimestamp(),
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
        } else {
          skipped++;
        }

        await db.recursiveDelete(jobDoc.ref);
      } catch (e: any) {
        console.error(`Migration error for job ${jobDoc.id}:`, e);
        errors.push({ jobId: jobDoc.id, message: e?.message || "Unknown error during migration" });
      }
    }

    return { totalFound: closedJobsSnap.size, migrated, skipped, errors };
  }
);

// --- 3. ฟังก์ชัน น้องจิมมี่ (DISABLED - High Cost API) ---
export const chatWithJimmy = onCall(
  { region: "us-central1", cors: true },
  async (request) => {
    throw new HttpsError("failed-precondition", "ฟีเจอร์ AI นี้ถูกปิดการใช้งานชั่วคราวเพื่อลดค่าใช้จ่ายค่ะ");
  }
);
