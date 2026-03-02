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
  getDoc
} from 'firebase/firestore';
import type { DocumentSettings, PurchaseDoc, UserProfile } from '@/lib/types';
import { sanitizeForFirestore } from '@/lib/utils';

function normalizeYear(year: number): number {
  return year > 2400 ? year - 543 : year;
}

function extractSequence(docNo: string): number {
  if (!docNo) return 0;
  const parts = docNo.split('-');
  if (parts.length < 2) return 0;
  const num = parseInt(parts[parts.length - 1], 10);
  return isNaN(num) ? 0 : num;
}

/**
 * Finds the next available sequence for PurchaseDocs.
 */
async function findNextAvailablePurchaseSequence(db: Firestore, prefixYear: string): Promise<number> {
  const q = query(
    collection(db, "purchaseDocs"),
    where("docNo", ">=", prefixYear),
    where("docNo", "<=", prefixYear + "\uf8ff"),
    orderBy("docNo", "asc")
  );
  
  const snap = await getDocs(q);
  const existingSeqs = new Set(snap.docs.map(d => extractSequence(d.data().docNo)));
  
  let candidate = 1;
  while (existingSeqs.has(candidate)) {
    candidate++;
  }
  return candidate;
}

export async function createPurchaseDoc(
  db: Firestore,
  data: Omit<PurchaseDoc, 'id' | 'docNo' | 'status' | 'createdAt' | 'updatedAt'>,
  userProfile: UserProfile,
  initialStatus: PurchaseDoc['status'] = 'DRAFT',
  providedDocId?: string
): Promise<string> {
  const dateObj = new Date(data.docDate);
  const year = normalizeYear(dateObj.getFullYear());
  
  const newDocRef = providedDocId ? doc(db, 'purchaseDocs', providedDocId) : doc(collection(db, 'purchaseDocs'));

  const docSettingsSnap = await getDoc(doc(db, 'settings', 'documents'));
  const prefix = (docSettingsSnap.exists() ? (docSettingsSnap.data() as DocumentSettings).purchasePrefix : 'PUR') || 'PUR';

  const prefixSearch = `${prefix}${year}-`;
  const nextSeq = await findNextAvailablePurchaseSequence(db, prefixSearch);

  const documentNumber = await runTransaction(db, async (transaction) => {
    if (providedDocId) {
      const existingDoc = await transaction.get(newDocRef);
      if (existingDoc.exists()) return existingDoc.data().docNo as string;
    }

    const docNo = `${prefix}${year}-${String(nextSeq).padStart(4, '0')}`;

    const docData = sanitizeForFirestore({
      ...data,
      id: newDocRef.id,
      docNo,
      status: initialStatus,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(initialStatus === 'PENDING_REVIEW' && { submittedAt: serverTimestamp() })
    });

    transaction.set(newDocRef, docData);
    
    const counterRef = doc(db, 'documentCounters', String(year));
    transaction.set(counterRef, { 
        [`PURCHASE_${prefix.toUpperCase()}_count`]: nextSeq
    }, { merge: true });

    return docNo;
  });

  return documentNumber;
}
