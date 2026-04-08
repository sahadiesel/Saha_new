'use client';

import {
  type Firestore,
  doc,
  runTransaction,
  collection,
  serverTimestamp,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore';
import type { Job, UserProfile } from '@/lib/types';
import { sanitizeForFirestore } from '@/lib/utils';
import { normalizeYear } from '@/firebase/documents';
import { archiveCollectionNameByYear } from '@/lib/archive-utils';

function extractSequenceFromJobNo(jobNo: string): number {
  if (!jobNo) return 0;
  const parts = jobNo.split('-');
  if (parts.length < 2) return 0;
  const num = parseInt(parts[parts.length - 1], 10);
  return Number.isNaN(num) ? 0 : num;
}

function sanitizeJobPrefix(raw: string | undefined): string {
  const p = (raw || 'SJ').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return p || 'SJ';
}

/** Max sequence for prefix/year from one collection (active jobs or archive). */
async function maxJobNoSequenceInCollection(
  db: Firestore,
  collectionId: string,
  prefix: string,
  year: number
): Promise<number> {
  const prefixYear = `${prefix}${year}-`;
  try {
    const q = query(
      collection(db, collectionId),
      where('jobNo', '>=', prefixYear),
      where('jobNo', '<=', prefixYear + '\uf8ff'),
      orderBy('jobNo', 'desc'),
      limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return 0;
    return extractSequenceFromJobNo(String(snap.docs[0].data().jobNo || ''));
  } catch {
    return 0;
  }
}

/**
 * Highest jobNo sequence among open jobs and the same year's archive (งานที่ปิดแล้ว).
 * เอกสารขายยังผูกด้วย jobId (รหัสเอกสาร Firestore) — ไม่แตะเลขที่ QJ/DN/INV
 */
async function getBootstrapJobSequenceMax(
  db: Firestore,
  prefix: string,
  year: number
): Promise<number> {
  const active = await maxJobNoSequenceInCollection(db, 'jobs', prefix, year);
  const archiveName = archiveCollectionNameByYear(year);
  const archived = await maxJobNoSequenceInCollection(db, archiveName, prefix, year);
  return Math.max(active, archived);
}

/**
 * Creates a new Job: Firestore document id เป็นรหัสสุ่มของระบบ (ไม่ใช้ SJ… เป็นรหัสเอกสาร)
 * เพื่อไม่ให้เอกสารเก่าที่ยังมี jobId เดิมถูกดึงมาผูกกับงานใหม่
 * jobNo เป็นเลขอ่านง่ายแยกต่างหาก — เอกสารอื่นยังใช้เลขที่เดิมตามของตัวเอง
 */
export async function createJob(
  db: Firestore,
  data: Omit<Job, 'id' | 'jobNo' | 'status' | 'createdAt' | 'updatedAt' | 'lastActivityAt'>,
  userProfile: UserProfile
): Promise<{ jobId: string; jobNo: string }> {
  const newJobRef = doc(collection(db, 'jobs'));
  const finalJobId = newJobRef.id;

  const year = normalizeYear(new Date().getFullYear());
  const settingsSnap = await getDoc(doc(db, 'settings', 'documents'));
  const prefix = sanitizeJobPrefix(settingsSnap.data()?.jobPrefix as string | undefined);

  const bootstrapMax = await getBootstrapJobSequenceMax(db, prefix, year);
  const counterRef = doc(db, 'documentCounters', String(year));
  const counterKey = `JOB_${prefix}_seq`;

  let assignedJobNo = '';

  await runTransaction(db, async (transaction) => {
    const counterSnap = await transaction.get(counterRef);
    const cur = Number((counterSnap.data() as Record<string, unknown> | undefined)?.[counterKey]) || 0;
    const nextSeq = Math.max(cur, bootstrapMax) + 1;
    assignedJobNo = `${prefix}${year}-${String(nextSeq).padStart(4, '0')}`;

    transaction.set(counterRef, { [counterKey]: nextSeq }, { merge: true });

    const jobData = sanitizeForFirestore({
      ...data,
      id: finalJobId,
      jobNo: assignedJobNo,
      status: 'RECEIVED',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
    });

    transaction.set(newJobRef, jobData);

    const activityRef = doc(collection(newJobRef, 'activities'));
    transaction.set(activityRef, {
      text: `เปิดงานใหม่ เลขที่ ${assignedJobNo}`,
      userName: userProfile.displayName,
      userId: userProfile.uid,
      createdAt: serverTimestamp(),
      photos: data.photos || [],
    });
  });

  return { jobId: finalJobId, jobNo: assignedJobNo };
}
