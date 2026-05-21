import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
  type Firestore,
} from "firebase/firestore";
import type { Document } from "@/lib/types";

function docToQuotation(d: { id: string; data: () => Record<string, unknown> }): Document {
  return { id: d.id, ...d.data() } as Document;
}

/** รวมใบเสนอราคาสำหรับเลือกตอนออกบิล — งานที่ผูก, ค้นหาเลขที่, ชุดล่าสุด */
export async function fetchQuotationsForBilling(
  db: Firestore,
  opts: {
    jobId?: string | null;
    linkedSalesDocId?: string | null;
    searchTerm?: string;
    recentLimit?: number;
  }
): Promise<Document[]> {
  const byId = new Map<string, Document>();

  const add = (docs: Document[]) => {
    for (const d of docs) {
      if (d.status !== "CANCELLED") byId.set(d.id, d);
    }
  };

  if (opts.linkedSalesDocId) {
    const snap = await getDoc(doc(db, "documents", opts.linkedSalesDocId));
    if (snap.exists()) add([docToQuotation(snap)]);
  }

  if (opts.jobId) {
    const jobQtSnap = await getDocs(
      query(
        collection(db, "documents"),
        where("jobId", "==", opts.jobId),
        where("docType", "==", "QUOTATION"),
        limit(30)
      )
    );
    add(jobQtSnap.docs.map((d) => docToQuotation(d)));
  }

  const term = (opts.searchTerm || "").trim();
  if (term.length >= 2) {
    try {
      const prefix = term.toUpperCase();
      const searchSnap = await getDocs(
        query(
          collection(db, "documents"),
          where("docType", "==", "QUOTATION"),
          where("docNo", ">=", prefix),
          where("docNo", "<=", prefix + "\uf8ff"),
          limit(40)
        )
      );
      add(searchSnap.docs.map((d) => docToQuotation(d)));
    } catch {
      /* อาจยังไม่มี composite index docType+docNo — ใช้ชุดล่าสุดแทน */
    }
  }

  const recentSnap = await getDocs(
    query(collection(db, "documents"), where("docType", "==", "QUOTATION"), limit(opts.recentLimit ?? 300))
  );
  add(recentSnap.docs.map((d) => docToQuotation(d)));

  const getTime = (v: unknown) => {
    const t = v as { toMillis?: () => number; seconds?: number };
    return t?.toMillis?.() ?? (t?.seconds ? t.seconds * 1000 : 0);
  };

  return Array.from(byId.values()).sort(
    (a, b) => getTime(b.updatedAt ?? b.createdAt) - getTime(a.updatedAt ?? a.createdAt)
  );
}

export function mapDocItemsToInvoiceLines(sourceDoc: Document) {
  return (sourceDoc.items || []).map((item) => ({
    description: String(item.description ?? ""),
    quantity: Number(item.quantity ?? 1),
    unitPrice: Number(item.unitPrice ?? 0),
    total: Math.round(Number(item.quantity ?? 1) * Number(item.unitPrice ?? 0) * 100) / 100,
  }));
}
