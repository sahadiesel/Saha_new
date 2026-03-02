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
import type { DocumentSettings, Document, DocType, JobStatus, UserProfile } from '@/lib/types';
import { sanitizeForFirestore } from '@/lib/utils';

/**
 * Normalizes year to Gregorian (CE).
 */
function normalizeYear(year: number): number {
  return year > 2400 ? year - 543 : year;
}

/**
 * Extracts sequence from strings like "DN2026-0012" -> 12
 */
function extractSequence(docNo: string): number {
  if (!docNo) return 0;
  const parts = docNo.split('-');
  if (parts.length < 2) return 0;
  const num = parseInt(parts[parts.length - 1], 10);
  return isNaN(num) ? 0 : num;
}

/**
 * Finds the next available sequence number for a given prefix/year.
 * It fetches existing doc numbers and finds the smallest gap (1, 2, [gap], 4 -> returns 3).
 * If no gaps, returns max + 1.
 */
async function findNextAvailableSequence(db: Firestore, docType: string, prefixYear: string): Promise<number> {
  const q = query(
    collection(db, "documents"),
    where("docType", "==", docType),
    where("docNo", ">=", prefixYear),
    where("docNo", "<=", prefixYear + "\uf8ff"),
    orderBy("docNo", "asc") // Sort ascending to find the first gap
  );
  
  const snap = await getDocs(q);
  const existingSeqs = new Set(snap.docs.map(d => extractSequence(d.data().docNo)));
  
  let candidate = 1;
  while (existingSeqs.has(candidate)) {
    candidate++;
  }
  return candidate;
}

export async function createDocument(
  db: Firestore,
  docType: DocType,
  data: Omit<Document, 'id' | 'docNo' | 'docType' | 'createdAt' | 'updatedAt' | 'status'>,
  userProfile: UserProfile,
  newJobStatus?: JobStatus,
  options?: { manualDocNo?: string; initialStatus?: string; providedDocId?: string }
): Promise<{ docId: string; docNo: string }> {

  const newDocRef = options?.providedDocId ? doc(db, 'documents', options.providedDocId) : doc(collection(db, 'documents'));
  const docId = newDocRef.id;

  let year = new Date().getFullYear();
  const dateInput = data.docDate || (data as any).issueDate;
  if (dateInput) {
    const dateObj = new Date(dateInput);
    if (!isNaN(dateObj.getTime())) {
      year = normalizeYear(dateObj.getFullYear());
    }
  }

  // Determine the prefix from settings
  const docSettingsSnap = await getDoc(doc(db, 'settings', 'documents'));
  
  const prefixes: Record<DocType, keyof DocumentSettings> = {
    QUOTATION: 'quotationPrefix',
    DELIVERY_NOTE: 'deliveryNotePrefix',
    TAX_INVOICE: 'taxInvoicePrefix',
    RECEIPT: 'receiptPrefix',
    BILLING_NOTE: 'billingNotePrefix',
    CREDIT_NOTE: 'creditNotePrefix',
    WITHHOLDING_TAX: 'withholdingTaxPrefix',
  };

  const defaultPrefixMap: Record<DocType, string> = {
    QUOTATION: 'QT',
    DELIVERY_NOTE: 'DN',
    TAX_INVOICE: 'INV',
    RECEIPT: 'RE',
    BILLING_NOTE: 'BN',
    CREDIT_NOTE: 'CN',
    WITHHOLDING_TAX: 'WHT',
  };

  const prefix = (docSettingsSnap.exists() 
    ? (docSettingsSnap.data()[prefixes[docType]] || defaultPrefixMap[docType]) 
    : defaultPrefixMap[docType]).toUpperCase();

  const prefixSearch = `${prefix}${year}-`;

  // Find the next available number BEFORE the transaction to use as baseline
  const nextSeq = await findNextAvailableSequence(db, docType, prefixSearch);

  const result = await runTransaction(db, async (transaction) => {
    let finalDocNo = options?.manualDocNo;

    if (!finalDocNo) {
      // Use the sequence we found. In a high-concurrency environment, we might check 
      // if someone took it, but for a single shop, this baseline is very reliable.
      finalDocNo = `${prefix}${year}-${String(nextSeq).padStart(4, '0')}`;

      // Sync documentCounters just in case, though the new logic trusts the collection max/gap
      const counterRef = doc(db, 'documentCounters', String(year));
      transaction.set(counterRef, { 
          [`${docType}_${prefix}_count`]: nextSeq
      }, { merge: true });
    } else {
      // Manual check for duplicates
      const qDuplicate = query(collection(db, "documents"), where("docNo", "==", finalDocNo), where("docType", "==", docType), limit(1));
      const snapDuplicate = await getDocs(qDuplicate);
      if (!snapDuplicate.empty && snapDuplicate.docs[0].id !== docId) {
        throw new Error(`เลขที่เอกสาร '${finalDocNo}' ถูกใช้ไปแล้วในระบบค่ะ`);
      }
    }

    // Prepare and Set the Document
    const docData = sanitizeForFirestore({
      ...data,
      docDate: dateInput || new Date().toISOString().split('T')[0],
      id: docId,
      docNo: finalDocNo,
      docType,
      status: options?.initialStatus ?? 'DRAFT',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    transaction.set(newDocRef, docData);

    // Update the Job atomically
    const targetJobId = data.jobId;
    if (targetJobId && typeof targetJobId === 'string' && targetJobId.trim() !== '') {
      const jobRef = doc(db, 'jobs', targetJobId);
      transaction.update(jobRef, {
        status: newJobStatus || 'WAITING_APPROVE',
        salesDocId: docId,
        salesDocNo: finalDocNo,
        salesDocType: docType,
        lastActivityAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }

    return { finalDocNo };
  });

  return { docId, docNo: result.finalDocNo };
}
