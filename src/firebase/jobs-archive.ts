'use client';

import {
  type Firestore,
  doc,
  collection,
  runTransaction,
  serverTimestamp,
  getDocs,
  writeBatch,
  deleteField,
} from 'firebase/firestore';
import { archiveCollectionNameByYear } from '@/lib/archive-utils';
import type { UserProfile, Job } from '@/lib/types';
import { sanitizeForFirestore } from '@/lib/utils';
import { resolveJobNoForArchivedDocument } from '@/lib/job-no-utils';

/**
 * Moves a job and its activities subcollection to an annual archive collection.
 * Normalizes year to Gregorian.
 */
export async function archiveAndCloseJob(
  db: Firestore,
  jobId: string,
  closedDate: string,
  userProfile: UserProfile,
  salesDocInfo: { salesDocType: string; salesDocId: string; salesDocNo: string; paymentStatusAtClose: 'PAID' | 'UNPAID'; }
) {
  const jobRef = doc(db, 'jobs', jobId);
  
  // Extract and normalize year
  const rawYear = Number(String(closedDate || "").slice(0, 4));
  const year = rawYear > 2400 ? rawYear - 543 : (Number.isFinite(rawYear) ? rawYear : new Date().getFullYear());
  
  const archiveColName = archiveCollectionNameByYear(year);
  const archiveCol = collection(db, archiveColName);
  const archiveRef = doc(archiveCol, jobId);

  await runTransaction(db, async (transaction) => {
    const jobDoc = await transaction.get(jobRef);
    if (!jobDoc.exists()) {
      throw new Error("ไม่พบข้อมูลงานซ่อมในระบบปัจจุบัน (อาจถูกย้ายไปประวัติแล้ว)");
    }
    const jobData = jobDoc.data() as Job;

    if (salesDocInfo.salesDocId) {
        const docRef = doc(db, 'documents', salesDocInfo.salesDocId);
        transaction.update(docRef, { 
            jobId: jobId, 
            updatedAt: serverTimestamp() 
        });
    }

    const resolvedJobNo = resolveJobNoForArchivedDocument(jobId, jobData.jobNo);

    const archivedJobData = {
      ...jobData,
      ...(resolvedJobNo ? { jobNo: resolvedJobNo } : {}),
      status: 'CLOSED',
      isArchived: true,
      archivedAt: serverTimestamp(),
      archivedAtDate: closedDate,
      closedDate: closedDate,
      closedByName: userProfile.displayName,
      closedByUid: userProfile.uid,
      originalJobId: jobId,
      ...salesDocInfo,
    };
    
    transaction.set(archiveRef, sanitizeForFirestore(archivedJobData), { merge: true });
    transaction.delete(jobRef);
  });

  await moveJobActivities(db, jobId, archiveColName);
  
  return { archiveCollection: archiveColName, archiveJobId: jobId };
}

/**
 * Restores a job from the archive back to the active jobs collection.
 */
export async function restoreJobFromArchive(
  db: Firestore,
  jobId: string,
  year: number,
  userProfile: UserProfile
) {
  const archiveColName = archiveCollectionNameByYear(year);
  const archiveRef = doc(archiveColName, jobId);
  const jobRef = doc(db, 'jobs', jobId);

  await runTransaction(db, async (transaction) => {
    const archiveSnap = await transaction.get(archiveRef);
    if (!archiveSnap.exists()) {
      throw new Error("ไม่พบข้อมูลงานซ่อมในประวัติปีที่ระบุ");
    }

    const archiveData = archiveSnap.data() as Job;
    
    // Remove archive-specific fields and reset status
    const { 
      isArchived, archivedAt, archivedAtDate, archivedByUid, archivedByName,
      paymentStatusAtClose, closedByName, closedByUid, originalJobId,
      ...restOfData 
    } = archiveData as any;

    const restoredData = {
      ...restOfData,
      status: 'WAITING_CUSTOMER_PICKUP', // Restore to the state before closing
      isArchived: false,
      updatedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
    };

    transaction.set(jobRef, sanitizeForFirestore(restoredData));
    
    // LOG ACTIVITY: Standardized log for job restoration
    const activityRef = doc(collection(jobRef, 'activities'));
    transaction.set(activityRef, {
        text: `Admin กู้คืนงานจากประวัติ (ปี ${year}) กลับเข้าสู่ระบบงานปัจจุบัน`,
        userName: userProfile.displayName,
        userId: userProfile.uid,
        createdAt: serverTimestamp()
    });

    transaction.delete(archiveRef);
  });

  // Move activities back
  const archiveActivitiesRef = collection(db, archiveColName, jobId, 'activities');
  const activeActivitiesRef = collection(db, 'jobs', jobId, 'activities');
  
  const activitiesSnap = await getDocs(archiveActivitiesRef);
  if (!activitiesSnap.empty) {
    const batch = writeBatch(db);
    activitiesSnap.docs.forEach(actDoc => {
      const newActRef = doc(activeActivitiesRef, actDoc.id);
      batch.set(newActRef, actDoc.data());
      batch.delete(actDoc.ref);
    });
    await batch.commit();
  }

  return { jobId };
}

export async function moveJobActivities(db: Firestore, jobId: string, targetCollectionName: string) {
  const activitiesRef = collection(db, 'jobs', jobId, 'activities');
  const archiveActivitiesRef = collection(db, targetCollectionName, jobId, 'activities');

  try {
    const activitiesSnapshot = await getDocs(activitiesRef);
    if (activitiesSnapshot.empty) return;

    let writeBatchCount = 0;
    let batch = writeBatch(db);
    const docsToDelete: any[] = [];

    for (const activityDoc of activitiesSnapshot.docs) {
      const newActivityRef = doc(archiveActivitiesRef, activityDoc.id);
      batch.set(newActivityRef, activityDoc.data());
      docsToDelete.push(activityDoc.ref);
      writeBatchCount++;

      if (writeBatchCount >= 400) {
        await batch.commit();
        const deleteBatch = writeBatch(db);
        docsToDelete.forEach(ref => deleteBatch.delete(ref));
        await deleteBatch.commit();
        batch = writeBatch(db);
        writeBatchCount = 0;
        docsToDelete.length = 0;
      }
    }

    if (writeBatchCount > 0) {
      await batch.commit();
      const deleteBatch = writeBatch(db);
      docsToDelete.forEach(ref => deleteBatch.delete(ref));
      await deleteBatch.commit();
    }
  } catch (error) {
    console.error(`Failed to move activities for job ${jobId}.`, error);
  }
}