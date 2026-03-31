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

export function normalizeYear(year: number): number {
  return year > 2400 ? year - 543 : year;
}

/** Service purchases use `purchaseType: 'SERVICE'`; legacy docs may omit it (no partId on lines). */
export function isPurchaseDocServiceLike(
  d: Pick<PurchaseDoc, 'purchaseType' | 'items'> & { purchaseType?: string }
): boolean {
  if (d.purchaseType === 'SERVICE') return true;
  if (d.purchaseType === 'PARTS') return false;
  return !d.items?.some((i) => i.partId && String(i.partId).trim());
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
export async function findNextAvailablePurchaseSequence(db: Firestore, prefixYear: string): Promise<{ sequence: number; indexErrorUrl?: string }> {
  try {
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
 * Pre-calculates the next available purchase document number for UI preview.
 */
export async function getNextAvailablePurchaseDocNo(
  db: Firestore,
  docDate: string
): Promise<{ docNo: string; indexErrorUrl?: string }> {
  const dateObj = new Date(docDate || new Date());
  const year = normalizeYear(dateObj.getFullYear());
  
  const docSettingsSnap = await getDoc(doc(db, 'settings', 'documents'));
  const prefix = (docSettingsSnap.exists() ? (docSettingsSnap.data() as DocumentSettings).purchasePrefix : 'PUR') || 'PUR';

  const prefixSearch = `${prefix}${year}-`;
  const result = await findNextAvailablePurchaseSequence(db, prefixSearch);
  
  return { 
    docNo: `${prefix}${year}-${String(result.sequence).padStart(4, '0')}`,
    indexErrorUrl: result.indexErrorUrl
  };
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
  const seqResult = await findNextAvailablePurchaseSequence(db, prefixSearch);
  
  if (seqResult.indexErrorUrl) {
    throw new Error(`The query requires an index. You can create it here: ${seqResult.indexErrorUrl}`);
  }

  const documentNumber = await runTransaction(db, async (transaction) => {
    if (providedDocId) {
      const existingDoc = await transaction.get(newDocRef);
      if (existingDoc.exists()) return existingDoc.data().docNo as string;
    }

    const docNo = `${prefix}${year}-${String(seqResult.sequence).padStart(4, '0')}`;

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
        [`PURCHASE_${prefix.toUpperCase()}_count`]: seqResult.sequence
    }, { merge: true });

    return docNo;
  });

  return documentNumber;
}