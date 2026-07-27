import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import type { Document } from "@/lib/types";

/** เอกสารที่ผ่านบัญชีแล้วและยังไม่ได้ออกใบเสร็จ */
export function isDocumentAwaitingReceipt(
  doc: Pick<Document, "docType" | "status" | "receiptDocId">
): boolean {
  if (doc.receiptDocId) return false;
  const status = String(doc.status ?? "").toUpperCase();
  if (status === "CANCELLED") return false;

  if (doc.docType === "TAX_INVOICE") {
    /** APPROVED = flow ปกติ; PAID = ข้อมูลเก่าที่รับเงินก่อนมีขั้นตอนใบเสร็จ */
    return status === "APPROVED" || status === "PAID";
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

  const legacyPaidBase = query(
    collection(db, "documents"),
    where("status", "==", "PAID"),
    where("docType", "==", "TAX_INVOICE"),
    orderBy("updatedAt", "desc")
  );
  addSnap(await fetchPaged(db, legacyPaidBase, pageSize, 5));

  return Array.from(byId.values()).sort((a, b) => (b.docDate || "").localeCompare(a.docDate || ""));
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
