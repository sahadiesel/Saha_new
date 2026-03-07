'use client';

import {
  type Firestore,
  doc,
  runTransaction,
  collection,
  serverTimestamp,
  getDocs,
  query,
  where,
  limit,
  orderBy,
  getDoc,
} from 'firebase/firestore';
import type { Job, UserProfile, JobStatus } from '@/lib/types';
import { sanitizeForFirestore } from '@/lib/utils';
import { normalizeYear } from './documents';

/**
 * Finds the next available Job sequence for a given year prefix.
 * Searches the 'jobs' collection by document ID.
 */
async function findNextJobSequence(db: Firestore, prefixYear: string): Promise<{ sequence: number; indexErrorUrl?: string }> {
  try {
    const q = query(
      collection(db, "jobs"),
      where("__name__", ">=", prefixYear),
      where("__name__", "<=", prefixYear + "\uf8ff"),
      orderBy("__name__", "asc")
    );
    
    const snap = await getDocs(q);
    const existingSeqs = new Set(snap.docs.map(d => {
      const parts = d.id.split('-');
      if (parts.length < 2) return 0;
      const num = parseInt(parts[parts.length - 1], 10);
      return isNaN(num) ? 0 : num;
    }));
    
    let candidate = 1;
    while (existingSeqs.has(candidate)) {
      candidate++;
    }
    return { sequence: candidate };
  } catch (e: any) {
    if (e.message?.includes('requires an index')) {
      const urlMatch = e.message.match(/https?:\/\/[^\s]+/);
      return { sequence: 1, indexErrorUrl: urlMatch ? urlMatch[0] : undefined };
    }
    throw e;
  }
}

/**
 * Generates the next available Job ID for preview in the UI.
 */
export async function getNextAvailableJobId(db: Firestore): Promise<{ jobId: string; indexErrorUrl?: string }> {
  const now = new Date();
  const year = normalizeYear(now.getFullYear());
  const prefix = `SJ${year}-`;
  
  const result = await findNextJobSequence(db, prefix);
  
  return {
    jobId: `${prefix}${String(result.sequence).padStart(4, '0')}`,
    indexErrorUrl: result.indexErrorUrl
  };
}

/**
 * Creates a new Job with a sequential ID within a transaction.
 */
export async function createJob(
  db: Firestore,
  data: Omit<Job, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'lastActivityAt'>,
  userProfile: UserProfile
): Promise<{ jobId: string }> {
  const now = new Date();
  const year = normalizeYear(now.getFullYear());
  const prefix = `SJ${year}-`;

  const seqResult = await findNextJobSequence(db, prefix);
  if (seqResult.indexErrorUrl) {
    throw new Error(`The query requires an index. You can create it here: ${seqResult.indexErrorUrl}`);
  }

  const result = await runTransaction(db, async (transaction) => {
    const finalJobId = `${prefix}${String(seqResult.sequence).padStart(4, '0')}`;
    const jobRef = doc(db, 'jobs', finalJobId);
    
    // Update counter
    const counterRef = doc(db, 'documentCounters', String(year));
    transaction.set(counterRef, { 
        [`JOB_SJ_count`]: seqResult.sequence
    }, { merge: true });

    const jobData = sanitizeForFirestore({
      ...data,
      id: finalJobId,
      status: 'RECEIVED',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
    });

    transaction.set(jobRef, jobData);

    // Initial activity log
    const activityRef = doc(collection(jobRef, 'activities'));
    transaction.set(activityRef, {
      text: `เปิดงานใหม่ (Sequential ID: ${finalJobId})`,
      userName: userProfile.displayName,
      userId: userProfile.uid,
      createdAt: serverTimestamp(),
      photos: data.photos || [],
    });

    return { jobId: finalJobId };
  });

  return { jobId: result.jobId };
}
