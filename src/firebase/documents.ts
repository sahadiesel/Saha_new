
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
  getDoc,
} from 'firebase/firestore';
import type { DocumentSettings, Document, DocType, JobStatus, UserProfile } from '@/lib/types';
import { sanitizeForFirestore } from '@/lib/utils';
import { docTypeLabel } from '@/lib/ui-labels';

/**
 * Normalizes year to Gregorian (CE).
 */
export function normalizeYear(year: number): number {
  return year > 2400 ? year - 543 : year;
}

/**
 * Extracts sequence from strings like "DN2026-0012" -> 12
 */
export function extractDocNoSequence(docNo: string): number {
  if (!docNo) return 0;
  const parts = docNo.split('-');
  if (parts.length < 2) return 0;
  const num = parseInt(parts[parts.length - 1], 10);
  return isNaN(num) ? 0 : num;
}

/** เรียงเลขที่เอกสารจากมากไปน้อย (0272 ก่อน 0269) ไม่ใช้ string sort ของวันที่ */
export function compareDocNoDescending(a: string, b: string): number {
  const seqDiff = extractDocNoSequence(b) - extractDocNoSequence(a);
  if (seqDiff !== 0) return seqDiff;
  return b.localeCompare(a, "en", { numeric: true, sensitivity: "base" });
}

function counterSeqValue(data: Record<string, unknown> | undefined, docType: string, prefix: string): number {
  if (!data) return 0;
  const seq = Number(data[`${docType}_${prefix}_seq`]) || 0;
  const count = Number(data[`${docType}_${prefix}_count`]) || 0;
  return Math.max(seq, count);
}

/**
 * Highest used sequence for prefix+year (SR2026-0272 → 272).
 * Next number is always max+1 so cancelled/deleted numbers are not reused and concurrent
 * creates cannot pick the same gap.
 */
export async function findMaxDocSequence(
  db: Firestore,
  docType: string,
  prefixYear: string
): Promise<{ max: number; indexErrorUrl?: string }> {
  try {
    const q = query(
      collection(db, "documents"),
      where("docType", "==", docType),
      where("docNo", ">=", prefixYear),
      where("docNo", "<=", prefixYear + "\uf8ff")
    );

    const snap = await getDocs(q);
    let max = 0;
    for (const d of snap.docs) {
      const seq = extractDocNoSequence(String(d.data().docNo || ""));
      if (seq > max) max = seq;
    }
    return { max };
  } catch (e: any) {
    if (e.message?.includes("requires an index")) {
      const urlMatch = e.message.match(/https?:\/\/[^\s]+/);
      return { max: 0, indexErrorUrl: urlMatch ? urlMatch[0] : undefined };
    }
    throw e;
  }
}

/**
 * Next sequence = max existing + 1 (preview only; createDocument allocates inside a transaction).
 */
export async function findNextAvailableSequence(db: Firestore, docType: string, prefixYear: string): Promise<{ sequence: number; indexErrorUrl?: string }> {
  const result = await findMaxDocSequence(db, docType, prefixYear);
  return { sequence: result.max + 1, indexErrorUrl: result.indexErrorUrl };
}

/**
 * Pre-calculates the next available document number for UI preview.
 */
export async function getNextAvailableDocNo(
  db: Firestore,
  docType: DocType,
  docDate: string
): Promise<{ docNo: string; indexErrorUrl?: string }> {
  let year = new Date().getFullYear();
  if (docDate) {
    const dateObj = new Date(docDate);
    if (!isNaN(dateObj.getTime())) {
      year = normalizeYear(dateObj.getFullYear());
    }
  }

  const docSettingsSnap = await getDoc(doc(db, 'settings', 'documents'));
  
  const prefixes: Record<DocType, keyof DocumentSettings> = {
    QUOTATION: 'quotationPrefix',
    DELIVERY_NOTE: 'deliveryNotePrefix',
    TAX_INVOICE: 'taxInvoicePrefix',
    RECEIPT: 'receiptPrefix',
    BILLING_NOTE: 'billingNotePrefix',
    CREDIT_NOTE: 'creditNotePrefix',
    DEBIT_NOTE: 'debitNotePrefix',
    WITHHOLDING_TAX: 'withholdingTaxPrefix',
    WITHDRAWAL: 'withdrawalPrefix',
  };

  const defaultPrefixMap: Record<DocType, string> = {
    QUOTATION: 'QT',
    DELIVERY_NOTE: 'DN',
    TAX_INVOICE: 'INV',
    RECEIPT: 'RE',
    BILLING_NOTE: 'BN',
    CREDIT_NOTE: 'CN',
    DEBIT_NOTE: 'DBN',
    WITHHOLDING_TAX: 'WHT',
    WITHDRAWAL: 'SWD',
  };

  const prefix = (docSettingsSnap.exists() 
    ? (docSettingsSnap.data()[prefixes[docType]] || defaultPrefixMap[docType]) 
    : defaultPrefixMap[docType]).toUpperCase();

  const prefixSearch = `${prefix}${year}-`;
  const result = await findNextAvailableSequence(db, docType, prefixSearch);
  
  return { 
    docNo: `${prefix}${year}-${String(result.sequence).padStart(4, '0')}`,
    indexErrorUrl: result.indexErrorUrl
  };
}

export async function createDocument(
  db: Firestore,
  docType: DocType,
  data: Omit<Document, 'id' | 'docNo' | 'docType' | 'createdAt' | 'updatedAt' | 'status'>,
  userProfile: UserProfile,
  newJobStatus?: JobStatus,
  options?: {
    manualDocNo?: string;
    initialStatus?: string;
    providedDocId?: string;
    /** ผูก salesDoc* กับงานโดยไม่เปลี่ยน job.status — ใช้ใบเสนอราคาฉบับร่างขณะงานยัง WAITING_QUOTATION */
    linkJobWithoutStatusChange?: boolean;
    /** ไม่เขียน salesDoc* / activities ลง job — ใช้ใบเสนอราคาฉบับร่างที่บันทึกไว้แก้ก่อน ยังไม่ให้โผล่บนจ๊อบ */
    skipJobAttachment?: boolean;
  }
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

  // Check for manual duplicates OUTSIDE transaction
  if (options?.manualDocNo) {
    const qDuplicate = query(
      collection(db, "documents"), 
      where("docNo", "==", options.manualDocNo), 
      where("docType", "==", docType), 
      limit(1)
    );
    const snapDuplicate = await getDocs(qDuplicate);
    if (!snapDuplicate.empty && snapDuplicate.docs[0].id !== docId) {
      throw new Error(`เลขที่เอกสาร '${options.manualDocNo}' ถูกใช้ไปแล้วในระบบค่ะ`);
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
    DEBIT_NOTE: 'debitNotePrefix',
    WITHHOLDING_TAX: 'withholdingTaxPrefix',
    WITHDRAWAL: 'withdrawalPrefix',
  };

  const defaultPrefixMap: Record<DocType, string> = {
    QUOTATION: 'QT',
    DELIVERY_NOTE: 'DN',
    TAX_INVOICE: 'INV',
    RECEIPT: 'RE',
    BILLING_NOTE: 'BN',
    CREDIT_NOTE: 'CN',
    DEBIT_NOTE: 'DBN',
    WITHHOLDING_TAX: 'WHT',
    WITHDRAWAL: 'SWD',
  };

  const prefix = (docSettingsSnap.exists() 
    ? (docSettingsSnap.data()[prefixes[docType]] || defaultPrefixMap[docType]) 
    : defaultPrefixMap[docType]).toUpperCase();

  const prefixSearch = `${prefix}${year}-`;
  const maxResult = await findMaxDocSequence(db, docType, prefixSearch);
  
  if (maxResult.indexErrorUrl) {
    throw new Error(`The query requires an index. You can create it here: ${maxResult.indexErrorUrl}`);
  }

  const result = await runTransaction(db, async (transaction) => {
    // ===== READS FIRST (Firestore requires all reads before any writes) =====
    const targetJobId = data.jobId;
    let jobSnap: Awaited<ReturnType<typeof transaction.get>> | null = null;
    if (!options?.skipJobAttachment && targetJobId && typeof targetJobId === "string" && targetJobId.trim() !== "") {
      const jobRef = doc(db, 'jobs', targetJobId);
      // Guard: ตรวจสอบว่าเอกสาร Job มีอยู่จริงก่อนทำการ write
      // เพื่อป้องกัน "No document to update" error กรณีงานถูกลบ/ไม่มีในระบบ
      jobSnap = await transaction.get(jobRef);
    }

    const counterRef = doc(db, 'documentCounters', String(year));
    const counterSnap = options?.manualDocNo ? null : await transaction.get(counterRef);

    // ===== WRITES =====
    let finalDocNo = options?.manualDocNo;

    if (!finalDocNo) {
      const cur = counterSeqValue(counterSnap?.data() as Record<string, unknown> | undefined, docType, prefix);
      const nextSeq = Math.max(cur, maxResult.max) + 1;
      finalDocNo = `${prefix}${year}-${String(nextSeq).padStart(4, '0')}`;
      transaction.set(counterRef, {
          [`${docType}_${prefix}_seq`]: nextSeq,
          [`${docType}_${prefix}_count`]: nextSeq,
      }, { merge: true });
    }

    const docStatus = options?.initialStatus ?? (
      docType === 'WITHDRAWAL' || docType === 'BILLING_NOTE' ? 'ISSUED' : 'DRAFT'
    );

    const docData = sanitizeForFirestore({
      ...data,
      docDate: dateInput || new Date().toISOString().split('T')[0],
      id: docId,
      docNo: finalDocNo,
      docType,
      status: docStatus,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    transaction.set(newDocRef, docData);

    if (!options?.skipJobAttachment && targetJobId && typeof targetJobId === "string" && targetJobId.trim() !== "") {
      const jobRef = doc(db, 'jobs', targetJobId);
      if (jobSnap?.exists()) {
        // LOG ACTIVITY: Standardized log for document creation
        const activityRef = doc(collection(jobRef, 'activities'));
        transaction.set(activityRef, {
          text: `สร้าง${docTypeLabel(docType)} เลขที่ ${finalDocNo} วันที่ ${docData.docDate}`,
          userName: userProfile.displayName,
          userId: userProfile.uid,
          createdAt: serverTimestamp(),
        });

        if (docType === 'WITHDRAWAL') {
          transaction.update(jobRef, {
            hasPartsWithdrawal: true,
            lastActivityAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          const jobSalesPatch = {
            salesDocId: docId,
            salesDocNo: finalDocNo,
            salesDocType: docType,
            salesDocStatus: docStatus,
            lastActivityAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          if (options?.linkJobWithoutStatusChange) {
            transaction.update(jobRef, jobSalesPatch);
          } else {
            transaction.update(jobRef, {
              status: newJobStatus || 'WAITING_APPROVE',
              ...jobSalesPatch,
            });
          }
        }
      }
      // หากไม่พบงานในระบบ ให้บันทึกเอกสารต่อไปโดยไม่ผูกกับงาน
    }

    return { finalDocNo };
  });

  return { docId, docNo: result.finalDocNo };
}
