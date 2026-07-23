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

function getRecentYears(count: number): number[] {
  const year = new Date().getFullYear();
  return Array.from({ length: count }, (_, i) => year - i);
}

function defaultQuotationPrefixes(): string[] {
  return ["QJ", "QT", "SNV"];
}

/** คำค้นเป็นเลขที่/เลขท้ายบิล (ไม่ใช่ชื่อลูกค้า/เบอร์โทร) */
export function isQuotationDocNoSearch(rawTerm: string): boolean {
  const term = rawTerm.trim();
  if (!term) return false;
  const compact = term.replace(/\s|-/g, "");
  if (/^\d+$/.test(compact)) return true;
  if (/^[A-Za-z]/.test(term)) return true;
  if (/^\d{4}-?\d+/.test(compact)) return true;
  return false;
}

/** จับคู่เลขที่ใบเสนอราคากับคำค้น (เช่น 029 → QJ2026-0290, 0291, …) */
export function docNoMatchesQuotationSearch(docNo: string, rawTerm: string): boolean {
  const q = rawTerm.trim().toUpperCase().replace(/\s|-/g, "");
  if (!q) return true;
  const docUpper = docNo.toUpperCase();
  const docCompact = docUpper.replace(/\s|-/g, "");
  if (docCompact.includes(q)) return true;

  const baseDocNo = docUpper.replace(/\s+R\d+$/i, "");
  const baseCompact = baseDocNo.replace(/\s|-/g, "");
  if (baseCompact.includes(q)) return true;

  const seq = baseDocNo.match(/-(\d+)/)?.[1] || "";
  if (/^\d+$/.test(q) && seq) {
    if (seq.startsWith(q)) return true;
    if (q.length >= 3 && seq.includes(q)) return true;
  }
  return false;
}

/** สร้าง prefix สำหรับ query docNo บน Firestore จากคำค้น (รองรับเลขท้าย เช่น 029 → 0290, 0291) */
export function buildQuotationDocNoQueryPrefixes(
  rawTerm: string,
  prefixFilter: string,
  knownPrefixes: string[]
): string[] {
  const term = rawTerm.trim().toUpperCase();
  const compact = term.replace(/\s|-/g, "");
  const out = new Set<string>();

  const letterPrefixes =
    prefixFilter !== "ALL"
      ? [prefixFilter]
      : [...new Set([...knownPrefixes, ...defaultQuotationPrefixes()])];

  const fullMatch = compact.match(/^([A-Z]+)(\d{4})(\d+)$/);
  if (fullMatch) {
    const [, pre, year, num] = fullMatch;
    out.add(`${pre}${year}-${num}`);
    return [...out];
  }

  const yearNumMatch = compact.match(/^(\d{4})(\d+)$/);
  if (yearNumMatch) {
    const [, year, num] = yearNumMatch;
    for (const pre of letterPrefixes) {
      out.add(`${pre}${year}-${num}`);
    }
    return [...out];
  }

  if (/^[A-Z]/.test(term)) {
    out.add(term.replace(/\s/g, ""));
    return [...out];
  }

  if (/^\d+$/.test(compact)) {
    for (const pre of letterPrefixes) {
      for (const year of getRecentYears(8)) {
        out.add(`${pre}${year}-${compact}`);
      }
    }
    return [...out];
  }

  out.add(term);
  return [...out];
}

async function queryQuotationsByDocNoPrefix(
  db: Firestore,
  prefix: string,
  limitCount: number
): Promise<Document[]> {
  const searchSnap = await getDocs(
    query(
      collection(db, "documents"),
      where("docType", "==", "QUOTATION"),
      where("docNo", ">=", prefix),
      where("docNo", "<=", prefix + "\uf8ff"),
      limit(limitCount)
    )
  );
  return searchSnap.docs.map((d) => docToQuotation(d));
}

/** ค้นหาใบเสนอราคาจากเลขที่ — query ฝั่ง Firestore (ไม่จำกัดชุด 200 ใบล่าสุด) */
export async function searchQuotationsByDocNo(
  db: Firestore,
  opts: {
    searchTerm: string;
    prefixFilter?: string;
    knownPrefixes?: string[];
    limitPerQuery?: number;
  }
): Promise<Document[]> {
  const term = (opts.searchTerm || "").trim();
  if (term.length < 2) return [];

  const byId = new Map<string, Document>();
  const add = (docs: Document[]) => {
    for (const d of docs) byId.set(d.id, d);
  };

  const prefixes = buildQuotationDocNoQueryPrefixes(
    term,
    opts.prefixFilter || "ALL",
    opts.knownPrefixes || []
  );

  const limitPerQuery = opts.limitPerQuery ?? 50;
  await Promise.all(
    prefixes.map(async (prefix) => {
      try {
        add(await queryQuotationsByDocNoPrefix(db, prefix, limitPerQuery));
      } catch {
        /* อาจยังไม่มี composite index docType+docNo */
      }
    })
  );

  return Array.from(byId.values()).sort((a, b) => a.docNo.localeCompare(b.docNo));
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
      add(await searchQuotationsByDocNo(db, {
        searchTerm: term,
        limitPerQuery: 40,
      }));
    } catch {
      /* fallback ชุดล่าสุดด้านล่าง */
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
