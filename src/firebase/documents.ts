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
  setDoc,
  limit,
  orderBy,
  getDoc,
  updateDoc,
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

  // Use Transaction for both manual and auto-generated numbers to ensure atomic Job link
  const result = await runTransaction(db, async (transaction) => {
    let finalDocNo = options?.manualDocNo;

    if (!finalDocNo) {
      // 1. Find the highest existing sequence for this prefix/year
      const highestQ = query(
        collection(db, "documents"),
        where("docType", "==", docType),
        where("docNo", ">=", prefixSearch),
        where("docNo", "<=", prefixSearch + "\uf8ff"),
        orderBy("docNo", "desc"),
        limit(1)
      );
      const highestSnap = await getDocs(highestQ);
      let collectionMax = 0;
      if (!highestSnap.empty) {
        collectionMax = extractSequence(highestSnap.docs[0].data().docNo);
      }

      // 2. Check documentCounters
      const counterRef = doc(db, 'documentCounters', String(year));
      const counterSnap = await transaction.get(counterRef);
      let counters = counterSnap.exists() ? counterSnap.data() : { year };

      const countKey = `${docType}_${prefix}_count`;
      let lastCount = counters[countKey] || 0;
      
      let nextCount = Math.max(lastCount, collectionMax) + 1;
      finalDocNo = `${prefix}${year}-${String(nextCount).padStart(4, '0')}`;

      // Update counters
      transaction.set(counterRef, { 
          ...counters, 
          [countKey]: nextCount
      }, { merge: true });
    } else {
      // Check for manual duplicate inside transaction
      const qDuplicate = query(collection(db, "documents"), where("docNo", "==", finalDocNo), where("docType", "==", docType), limit(1));
      const snapDuplicate = await getDocs(qDuplicate);
      if (!snapDuplicate.empty) {
        // If we are editing the same doc, it's fine.
        if (snapDuplicate.docs[0].id !== docId) {
          throw new Error(`เลขที่เอกสาร '${finalDocNo}' ถูกใช้ไปแล้วในระบบค่ะ`);
        }
      }
    }

    // 3. Prepare and Set the Document
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

    // 4. Update the Job atomically
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
