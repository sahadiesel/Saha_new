import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import type { Document } from "@/lib/types";

/** ประเภทเอกสารที่รอบัญชีตรวจสอบ (Inbox แท็บ Cash/Credit) */
export const INBOX_PENDING_REVIEW_DOC_TYPES = [
  "TAX_INVOICE",
  "DELIVERY_NOTE",
  "CREDIT_NOTE",
  "DEBIT_NOTE",
  "RECEIPT",
] as const;

/** สถานะเอกสารที่กำลังดำเนินการหลังผ่านบัญชี */
export const INBOX_ACTIVE_STATUSES = ["APPROVED", "UNPAID", "PARTIAL", "ISSUED"] as const;

/** เอกสารที่ผ่านบัญชีแล้วและยังไม่ได้ออกใบเสร็จ */
export function isDocumentAwaitingReceipt(
  doc: Pick<Document, "docType" | "status" | "receiptDocId">
): boolean {
  if (doc.receiptDocId) return false;
  const status = String(doc.status ?? "").toUpperCase();
  if (status === "CANCELLED") return false;

  if (doc.docType === "TAX_INVOICE") {
    /** APPROVED/UNPAID = flow ปกติ; PAID = ข้อมูลเก่าที่รับเงินก่อนมีขั้นตอนใบเสร็จ */
    return status === "APPROVED" || status === "UNPAID" || status === "PAID";
  }
  if (doc.docType === "DEBIT_NOTE") {
    return status === "APPROVED" || status === "UNPAID" || status === "PARTIAL";
  }
  return false;
}

async function fetchPaged(
  db: Firestore,
  baseQuery: ReturnType<typeof query>,
  pageSize: number,
  maxPages: number
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  const out: QueryDocumentSnapshot<DocumentData>[] = [];
  let last: QueryDocumentSnapshot<DocumentData> | undefined;

  for (let p = 0; p < maxPages; p++) {
    const q = last ? query(baseQuery, startAfter(last), limit(pageSize)) : query(baseQuery, limit(pageSize));
    const snap = await getDocs(q);
    if (snap.empty) break;
    out.push(...snap.docs);
    last = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < pageSize) break;
  }
  return out;
}

/** ดึงใบกำกับ/ใบเพิ่มหนี้ที่รอออกใบเสร็จ — แบ่งหน้า ไม่พลาดรายการนอก limit แรก */
export async function fetchDocumentsAwaitingReceipt(db: Firestore): Promise<Document[]> {
  const pageSize = 200;
  const maxPages = 25;
  const byId = new Map<string, Document>();

  const addSnap = (docs: QueryDocumentSnapshot<DocumentData>[]) => {
    for (const d of docs) {
      const row = { id: d.id, ...d.data() } as Document;
      if (isDocumentAwaitingReceipt(row)) byId.set(d.id, row);
    }
  };

  const approvedBase = query(
    collection(db, "documents"),
    where("status", "==", "APPROVED"),
    where("docType", "in", ["TAX_INVOICE", "DEBIT_NOTE"]),
    orderBy("updatedAt", "desc")
  );
  addSnap(await fetchPaged(db, approvedBase, pageSize, maxPages));

  const unpaidDebitBase = query(
    collection(db, "documents"),
    where("status", "==", "UNPAID"),
    where("docType", "==", "DEBIT_NOTE"),
    orderBy("updatedAt", "desc")
  );
  addSnap(await fetchPaged(db, unpaidDebitBase, pageSize, maxPages));

  const unpaidTaxBase = query(
    collection(db, "documents"),
    where("status", "==", "UNPAID"),
    where("docType", "==", "TAX_INVOICE"),
    orderBy("updatedAt", "desc")
  );
  addSnap(await fetchPaged(db, unpaidTaxBase, pageSize, maxPages));

  const legacyPaidBase = query(
    collection(db, "documents"),
    where("status", "==", "PAID"),
    where("docType", "==", "TAX_INVOICE"),
    orderBy("updatedAt", "desc")
  );
  addSnap(await fetchPaged(db, legacyPaidBase, pageSize, 5));

  return Array.from(byId.values()).sort((a, b) => (b.docDate || "").localeCompare(a.docDate || ""));
}

/** ดึงเอกสาร PENDING_REVIEW — แยกตาม docType + fallback รวมทุกประเภท */
export async function fetchPendingReviewDocuments(db: Firestore): Promise<Document[]> {
  const byId = new Map<string, Document>();
  const pendingTypes = new Set<string>(INBOX_PENDING_REVIEW_DOC_TYPES);

  const mapDocs = (docs: QueryDocumentSnapshot<DocumentData>[]) => {
    for (const d of docs) {
      const row = { id: d.id, ...d.data() } as Document;
      if (!pendingTypes.has(row.docType)) continue;
      byId.set(d.id, row);
    }
  };

  for (const docType of INBOX_PENDING_REVIEW_DOC_TYPES) {
    try {
      const snap = await getDocs(
        query(
          collection(db, "documents"),
          where("status", "==", "PENDING_REVIEW"),
          where("docType", "==", docType),
          orderBy("updatedAt", "desc"),
          limit(400)
        )
      );
      mapDocs(snap.docs);
    } catch {
      try {
        const snap = await getDocs(
          query(
            collection(db, "documents"),
            where("status", "==", "PENDING_REVIEW"),
            where("docType", "==", docType),
            limit(400)
          )
        );
        mapDocs(snap.docs);
      } catch {
        /* ข้าม docType นี้ */
      }
    }
  }

  /** fallback สุดท้าย — query แค่ status (ไม่ต้อง composite index) */
  if (byId.size === 0) {
    try {
      const snap = await getDocs(
        query(collection(db, "documents"), where("status", "==", "PENDING_REVIEW"), limit(500))
      );
      mapDocs(snap.docs);
    } catch {
      /* ignore */
    }
  }

  return Array.from(byId.values());
}

/** อนุมาน Cash vs Credit สำหรับแยกแท็บ Inbox */
export function inferInboxPaymentTerms(
  doc: Pick<Document, "paymentTerms" | "suggestedPayments" | "grandTotal" | "billingRequired">
): "CASH" | "CREDIT" {
  const terms = String(doc.paymentTerms ?? "").toUpperCase();
  if (terms === "CREDIT") return "CREDIT";
  if (terms === "CASH") return "CASH";
  const sum = (doc.suggestedPayments || [])
    .filter((p) => p?.accountId && (p.amount || 0) > 0.01)
    .reduce((a, p) => a + (p.amount || 0), 0);
  const balance = Math.round(Math.max(0, (doc.grandTotal || 0) - sum) * 100) / 100;
  if (doc.billingRequired || balance > 0.01) return "CREDIT";
  return "CASH";
}

/** @deprecated ใช้ fetchDocumentsAwaitingReceipt — คงไว้ให้หน้าลูกหนี้ที่ sync obligation */
export async function getApprovedTaxInvoiceSnapshotsPaged(
  db: Firestore
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  const pageSize = 200;
  const maxPages = 50;
  const out: QueryDocumentSnapshot<DocumentData>[] = [];
  let last: QueryDocumentSnapshot<DocumentData> | undefined;

  for (let p = 0; p < maxPages; p++) {
    const q = last
      ? query(
          collection(db, "documents"),
          where("status", "==", "APPROVED"),
          where("docType", "==", "TAX_INVOICE"),
          orderBy("updatedAt", "desc"),
          startAfter(last),
          limit(pageSize)
        )
      : query(
          collection(db, "documents"),
          where("status", "==", "APPROVED"),
          where("docType", "==", "TAX_INVOICE"),
          orderBy("updatedAt", "desc"),
          limit(pageSize)
        );
    const snap = await getDocs(q);
    if (snap.empty) break;
    out.push(...snap.docs);
    last = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < pageSize) break;
  }
  return out;
}
