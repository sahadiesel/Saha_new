import {
  collection,
  deleteField,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
  type Firestore,
  type WriteBatch,
} from 'firebase/firestore';
import type { BillingRun, Customer, Document } from '@/lib/types';
import { sanitizeForFirestore } from '@/lib/utils';
import {
  fpBillingRunCreatedMain,
  fpBillingRunCreatedSeparate,
} from '@/lib/billing-run-field-paths';

/** ยอดมีทิศทาง: ใบลดหนี้เป็นค่าลบ (หักจากยอดเก็บ) ใบอื่นเป็นบวก */
export function billingSignedGrandTotal(doc: Document): number {
  if (doc.docType === 'CREDIT_NOTE') return -(doc.grandTotal || 0);
  return doc.grandTotal || 0;
}

export function billingDocLineLabel(inv: Document): string {
  if (inv.docType === 'TAX_INVOICE') return 'ใบกำกับภาษี';
  if (inv.docType === 'DELIVERY_NOTE') return 'ใบส่งของ';
  if (inv.docType === 'CREDIT_NOTE') return 'ใบลดหนี้';
  if (inv.docType === 'DEBIT_NOTE') return 'ใบเพิ่มหนี้';
  return 'เอกสาร';
}

/** เอกสารที่รวมในรอบวางบิล (เครดิต + ใบลด/เพิ่มหนี้ที่ไม่ใช่เงินสด) */
export function isUnpaidBillingCandidate(doc: Document): boolean {
  if (['PAID', 'CANCELLED', 'REJECTED'].includes(doc.status)) return false;
  if (doc.docType === 'TAX_INVOICE' || doc.docType === 'DELIVERY_NOTE') {
    return doc.paymentTerms === 'CREDIT';
  }
  if (doc.docType === 'CREDIT_NOTE' || doc.docType === 'DEBIT_NOTE') {
    return doc.paymentTerms !== 'CASH';
  }
  return false;
}

/**
 * ชื่อ/ที่อยู่บนใบวางบิลต้องตรง snapshot บนบิลต้นทาง (ใบกำกับ/ใบส่งของ/ลดหนี้ ฯลฯ)
 * ไม่ใช้ customer จากแถวรวมใน batch ที่อาจเป็นบริษัทแม่คนละชื่อกับบิลจริง
 */
export function customerForBillingNoteDocument(groupInvoices: Document[], rowCustomer: Customer): Customer {
  if (groupInvoices.length === 0) return rowCustomer;
  const sorted = [...groupInvoices].sort((a, b) => {
    const da = String(a.docDate || '');
    const db = String(b.docDate || '');
    const cmp = da.localeCompare(db);
    if (cmp !== 0) return cmp;
    return String(a.docNo || '').localeCompare(String(b.docNo || ''));
  });
  const inv = sorted[0]!;
  const snap = inv.customerSnapshot;
  if (!snap) return rowCustomer;
  const cid = (inv.customerId || snap.id || rowCustomer.id) as string;
  /** snapshot จากบิลต้นทางทับชื่อแถวรวม / ชื่อสังเคราะห์ (แยก …) เพื่อให้ใบวางบิลตรงใบกำกับภาษี */
  return { ...rowCustomer, ...snap, id: cid } as Customer;
}

export type BillingCreatedNotes = { main?: string; separate?: Record<string, string> };

/** แถวก่อน/หลังแยกเป็นหลายแถวในตาราง */
export interface BillingTableRow {
  customer: Customer;
  includedInvoices: Document[];
  deferredInvoices: Document[];
  separateGroups: Record<string, Document[]>;
  totalIncludedAmount: number;
  createdNoteIds?: BillingCreatedNotes;
  /** โน้ตใบวางบิลจริงของ bucket ต้นทาง (ก่อน ::split::) */
  parentBillingNotesSnapshot?: BillingCreatedNotes | null;
  billingTargetBucketId?: string;
  splitInvoiceGroupKey?: string;
  /** เฉพาะแถวหลัก: มีแถวลูกแยกกลุ่มใดบ้าง */
  splitSubgroupKeys?: string[];
  warnings?: string[];
  mergedFollowerCount?: number;
}

export function bucketHasAnyCreatedNote(n?: BillingCreatedNotes | null): boolean {
  if (!n) return false;
  if (n.main) return true;
  return Object.values(n.separate || {}).some(Boolean);
}

/** แยกแต่ละกลุ่ม "แยก" เป็นแถวตารางของตัวเอง */
export function explodeSeparateSubRows(row: BillingTableRow): BillingTableRow[] {
  const baseBucket = row.customer.id;
  const keys = Object.keys(row.separateGroups);
  const parentNotes = row.createdNoteIds;
  if (keys.length === 0) {
    return [
      {
        ...row,
        parentBillingNotesSnapshot: parentNotes,
        billingTargetBucketId: undefined,
        splitInvoiceGroupKey: undefined,
        splitSubgroupKeys: undefined,
      },
    ];
  }

  const c = row.customer;

  const mainRow: BillingTableRow = {
    ...row,
    separateGroups: {},
    splitSubgroupKeys: keys,
    totalIncludedAmount: row.includedInvoices.reduce((s, i) => s + billingSignedGrandTotal(i), 0),
    parentBillingNotesSnapshot: parentNotes,
    billingTargetBucketId: baseBucket,
    splitInvoiceGroupKey: undefined,
    createdNoteIds: parentNotes,
  };

  const subRows: BillingTableRow[] = keys.map((key) => {
    const invs = row.separateGroups[key]!;
    const virtualId = `${baseBucket}::split::${key}`;
    const sepId = parentNotes?.separate?.[key];
    const fromInvoices = customerForBillingNoteDocument(invs, c);
    const nextCustomer = { ...fromInvoices, id: virtualId } as Customer;

    return {
      ...row,
      customer: nextCustomer,
      includedInvoices: invs,
      deferredInvoices: [],
      separateGroups: {},
      totalIncludedAmount: invs.reduce((s, i) => s + billingSignedGrandTotal(i), 0),
      createdNoteIds: sepId ? { main: sepId, separate: {} } : undefined,
      parentBillingNotesSnapshot: parentNotes,
      warnings: row.warnings,
      mergedFollowerCount: 0,
      splitSubgroupKeys: undefined,
      billingTargetBucketId: baseBucket,
      splitInvoiceGroupKey: key,
    };
  });

  return [mainRow, ...subRows];
}

export function billingNoteIdsOnInvoices(invoices: Document[]): string[] {
  const ids: string[] = [];
  for (const inv of invoices) {
    const id = String(inv.billingNoteId || '').trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** ทุกบิลในกลุ่มชี้ใบวางบิลใบเดียวกัน */
export function unanimousBillingNoteId(invoices: Document[]): string | undefined {
  if (invoices.length === 0) return undefined;
  const ids = billingNoteIdsOnInvoices(invoices);
  if (ids.length !== 1) return undefined;
  const only = ids[0]!;
  if (!invoices.every((inv) => String(inv.billingNoteId || '').trim() === only)) return undefined;
  return only;
}

/**
 * ใบวางบิลของแถวนี้
 * createdBillingNotes อาจไม่มี id เมื่อรหัสกลุ่มมี "." แล้ว Firestore มองเป็น path ซ้อน
 * แต่บิลต้นทางถูกผูก billingNoteId / เลขที่ไว้แล้ว
 */
export function billingRowResolvedNotes(row: BillingTableRow): BillingCreatedNotes | undefined {
  const run = row.createdNoteIds;
  const fromInvoices = unanimousBillingNoteId(row.includedInvoices);
  if (row.splitInvoiceGroupKey) {
    const main = run?.main || fromInvoices;
    return main ? { main, separate: {} } : undefined;
  }
  const main = run?.main || fromInvoices;
  const separate = run?.separate;
  if (!main && !Object.values(separate || {}).some(Boolean)) return undefined;
  return { main, separate };
}

/** สถานะแสดงผลแถว (หลัง explode) */
export function billingRowUiStatus(row: BillingTableRow): 'created' | 'pending' | 'empty' {
  const notes = billingRowResolvedNotes(row);

  if (row.splitInvoiceGroupKey) {
    if (notes?.main) return 'created';
    return row.includedInvoices.length > 0 ? 'pending' : 'empty';
  }

  const needMain = row.includedInvoices.length > 0;
  const keys = row.splitSubgroupKeys || [];
  const sep = notes?.separate || {};
  const mainIssued = !!notes?.main;
  const deferredStillOpen = row.deferredInvoices.some((inv) => !String(inv.billingNoteId || '').trim());

  // ใบของแถวนี้ถูกออกแล้ว — แถวแยกที่ยังค้างมีสถานะของตัวเอง ไม่ควรกลบปุ่มดู/พิมพ์ของแถวนี้
  if (needMain && mainIssued && !deferredStillOpen) return 'created';
  if (needMain) return 'pending';

  if (row.deferredInvoices.length > 0) return 'pending';

  if (keys.length === 0) {
    const anyCreated = mainIssued || Object.values(sep).some(Boolean);
    return anyCreated ? 'created' : 'empty';
  }
  if (keys.some((k) => !sep[k])) return 'pending';
  return 'created';
}

/** ล็อกรวมกลุ่ม / เลือกแถว — เฉพาะแถวที่สร้างใบวางบิลครบแล้ว */
export function billingRowIsMergeLocked(row: BillingTableRow): boolean {
  return billingRowUiStatus(row) === "created";
}

/** เลือกแถวเพื่อรวมกลุ่มได้ (รอดำเนินการ / ไม่มีรายการในแถวแต่ยังไม่ปิดงาน) */
export function billingRowIsMergeSelectable(row: BillingTableRow): boolean {
  const st = billingRowUiStatus(row);
  return st === "pending" || st === "empty";
}

/** แก้ไขการรวบรวม/แยกบิลได้เมื่อ bucket ยังมีแถวที่ไม่ปิดงาน */
export function billingRowCanEditGrouping(
  row: BillingTableRow,
  allRows: BillingTableRow[]
): boolean {
  const bucket = billingTargetBucket(row);
  return allRows
    .filter((r) => billingTargetBucket(r) === bucket)
    .some((r) => billingRowUiStatus(r) !== "created");
}

/** รวบรวมบิลทั้งหมดใน bucket (รวมแถวแยก) สำหรับ dialog แก้ไข */
export function billingRowCollectBucketInvoices(
  bucketId: string,
  rows: BillingTableRow[]
): Document[] {
  const m = new Map<string, Document>();
  for (const row of rows) {
    if (billingTargetBucket(row) !== bucketId) continue;
    for (const inv of row.includedInvoices) m.set(inv.id, inv);
    for (const inv of row.deferredInvoices) m.set(inv.id, inv);
    for (const group of Object.values(row.separateGroups)) {
      for (const inv of group) m.set(inv.id, inv);
    }
  }
  return Array.from(m.values()).sort((a, b) =>
    String(a.docDate || "").localeCompare(String(b.docDate || ""))
  );
}

/** บิลที่จะใส่ในใบวางบิลเมื่อกดสร้าง — รวมทุกใบใน bucket (หลังรวมกลุ่ม) */
export function billingInvoicesForNoteCreate(
  targetRow: BillingTableRow,
  allRows: BillingTableRow[],
  billingRun?: Pick<BillingRun, 'deferredInvoices' | 'separateInvoiceGroups'> | null
): Document[] {
  const deferred = billingRun?.deferredInvoices || {};
  const separate = billingRun?.separateInvoiceGroups || {};

  if (targetRow.splitInvoiceGroupKey) {
    return targetRow.includedInvoices.filter((inv) => !deferred[inv.id]);
  }

  const bucket = billingTargetBucket(targetRow);
  return billingRowCollectBucketInvoices(bucket, allRows).filter(
    (inv) => !deferred[inv.id] && !separate[inv.id]
  );
}

/** ล้าง separateInvoiceGroups ของทุกบิลใน bucket ที่เลือก (หลังรวมกลุ่มให้เหลือแถวเดียว) */
export function billingClearSeparateForBuckets(
  separate: Record<string, string>,
  bucketIds: string[],
  rows: BillingTableRow[]
): Record<string, string> {
  const next = { ...separate };
  for (const bucketId of bucketIds) {
    for (const inv of billingRowCollectBucketInvoices(bucketId, rows)) {
      delete next[inv.id];
    }
  }
  return next;
}

/** แถวนี้กดสร้างใบวางบิลได้หรือไม่ */
export function billingRowCanCreateNote(row: BillingTableRow): boolean {
  const status = billingRowUiStatus(row);
  if (status !== "pending") return false;
  if (row.splitInvoiceGroupKey) {
    return row.includedInvoices.length > 0;
  }
  if (row.includedInvoices.length > 0) return true;
  return false;
}

/**
 * รายการพรีวิวใบวางบิลต่อแถว — แถวแยกชื่อเห็นแค่ใบของแถวนั้น
 * (ไม่ใช้ parent snapshot ที่รวมทุกใบแยกในบัคเก็ต)
 */
export function billingRowPreviewItems(row: BillingTableRow): { docId: string; label: string }[] {
  const notes = billingRowResolvedNotes(row);
  const items: { docId: string; label: string }[] = [];
  const push = (docId?: string, label?: string) => {
    const id = (docId || '').trim();
    if (!id || items.some((item) => item.docId === id)) return;
    items.push({ docId: id, label: label || 'พรีวิว' });
  };

  if (row.splitInvoiceGroupKey) {
    push(notes?.main, 'พรีวิว');
    for (const id of billingNoteIdsOnInvoices(row.includedInvoices)) push(id, 'พรีวิว');
    return items;
  }

  push(notes?.main, 'พรีวิว (ใบหลัก)');
  for (const id of billingNoteIdsOnInvoices([...row.includedInvoices, ...row.deferredInvoices])) {
    push(id, 'พรีวิว');
  }
  return items;
}

/** เลขที่ใบวางบิลของแถว — จาก map ที่โหลดแล้ว หรือจากบิลต้นทาง */
export function billingRowNoteNumbers(
  row: BillingTableRow,
  noteNoByDocId?: Record<string, string>
): string[] {
  const nos: string[] = [];
  const push = (v?: string | null) => {
    const t = (v || "").trim();
    if (t && !nos.includes(t)) nos.push(t);
  };

  const noteIds: string[] = [];
  if (row.createdNoteIds?.main) noteIds.push(row.createdNoteIds.main);
  for (const id of Object.values(row.createdNoteIds?.separate || {})) {
    if (id) noteIds.push(id);
  }
  for (const id of noteIds) {
    push(noteNoByDocId?.[id]);
  }

  if (nos.length === 0) {
    for (const inv of [
      ...row.includedInvoices,
      ...row.deferredInvoices,
      ...Object.values(row.separateGroups).flat(),
    ]) {
      push(inv.billingNoteNo);
    }
  }

  return nos;
}

export function billingTargetBucket(row: BillingTableRow): string {
  return row.billingTargetBucketId ?? row.customer.id;
}

/** ลูกค้าจากแถว batch เมื่อไม่มีใน collection customers */
export function billingRowFallbackCustomer(row: BillingTableRow): Customer | null {
  const bucketId = billingTargetBucket(row);
  const base =
    row.includedInvoices.length > 0
      ? customerForBillingNoteDocument(row.includedInvoices, row.customer)
      : row.customer;
  if (!base?.name && !base?.taxName) return null;
  return { ...base, id: bucketId } as Customer;
}

/** จับคู่แถวเดียวกัน (รวมแถวแยกเล่ม) สำหรับลบ/อัปเดต UI */
export function billingRowMatchesTarget(
  row: BillingTableRow,
  target: Pick<BillingTableRow, "customer" | "splitInvoiceGroupKey" | "billingTargetBucketId">
): boolean {
  const targetBucket = target.billingTargetBucketId ?? target.customer.id;
  const rowBucket = billingTargetBucket(row);
  const targetSplit = target.splitInvoiceGroupKey ?? "";
  const rowSplit = row.splitInvoiceGroupKey ?? "";
  return targetBucket === rowBucket && targetSplit === rowSplit;
}

/** บิลที่ถูกเลื่อนไปวางเดือน monthId (ดึงเพิ่มจากเอกสาร) */
export async function fetchDeferredRollInDocuments(db: Firestore, monthId: string): Promise<Document[]> {
  const q = query(collection(db, 'documents'), where('billingDeferUntilMonth', '==', monthId));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Document))
    .filter((doc) => isUnpaidBillingCandidate(doc));
}

/** ซ่อนบิลในเดือนนี้ที่เลื่อนไปเดือนถัดไปแล้ว (billingDeferUntilMonth เป็นเดือนหลัง monthId) */
export function excludeInvoicesDeferredToFutureMonth(
  invoices: Document[],
  monthId: string
): Document[] {
  return invoices.filter((inv) => {
    const d = inv.billingDeferUntilMonth;
    if (d && d > monthId) return false;
    return true;
  });
}

/** บิลเครดิตที่ควรผูกลูกหนี้เมื่อออกใบวางบิล */
export function billingCreditDocNeedsAr(inv: Document): boolean {
  if (inv.arObligationId) return false;
  if (["PAID", "CANCELLED", "REJECTED", "DRAFT"].includes(inv.status)) return false;
  if (inv.docType === "TAX_INVOICE" || inv.docType === "DELIVERY_NOTE") {
    return inv.paymentTerms === "CREDIT";
  }
  if (inv.docType === "DEBIT_NOTE") return inv.paymentTerms !== "CASH";
  return false;
}

/** อัปเดตบิลต้นทางเมื่อสร้างใบวางบิล — ผูกเลขที่ + อนุมัติ/ตั้งลูกหนี้ถ้ายังรอบัญชี */
export function appendBillingNoteLinkToInvoiceBatch(
  batch: WriteBatch,
  db: Firestore,
  inv: Document,
  billingNoteId: string,
  billingNoteNo: string
): void {
  const updates: Record<string, unknown> = {
    billingNoteId,
    billingNoteNo,
    billingDeferUntilMonth: deleteField(),
    updatedAt: serverTimestamp(),
  };

  const creditSalesDoc =
    inv.docType === "TAX_INVOICE" ||
    inv.docType === "DELIVERY_NOTE" ||
    inv.docType === "DEBIT_NOTE";

  if (creditSalesDoc && inv.status === "PENDING_REVIEW") {
    updates.status = inv.docType === "DEBIT_NOTE" ? "UNPAID" : "APPROVED";
    updates.arStatus = "UNPAID";
    updates.paymentSummary = {
      paidTotal: 0,
      balance: inv.grandTotal || 0,
      paymentStatus: "UNPAID",
    };
  }

  if (billingCreditDocNeedsAr(inv)) {
    const arId = `AR_${inv.id}`;
    const customerName =
      inv.customerSnapshot?.name || inv.customerSnapshot?.taxName || "Unknown";
    updates.arObligationId = arId;
    batch.set(
      doc(db, "accountingObligations", arId),
      sanitizeForFirestore({
        id: arId,
        type: "AR",
        status: "UNPAID",
        sourceDocType: inv.docType,
        sourceDocId: inv.id,
        sourceDocNo: inv.docNo,
        amountTotal: inv.grandTotal || 0,
        amountPaid: 0,
        balance: inv.grandTotal || 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        customerId: inv.customerId || inv.customerSnapshot?.id || null,
        customerNameSnapshot: customerName,
        jobId: inv.jobId || null,
        dueDate: inv.dueDate || null,
        docDate: inv.docDate || null,
      }),
      { merge: true }
    );
  }

  batch.update(doc(db, "documents", inv.id), sanitizeForFirestore(updates));
}

/** บันทึก id ใบวางบิลลงรัน — ใช้ FieldPath เพื่อไม่ให้ "." ในรหัสกลุ่มกลายเป็น path ซ้อน */
export async function saveBillingRunCreatedNote(
  billingRunRef: DocumentReference,
  args: {
    monthId: string;
    bucketId: string;
    runExists: boolean;
    mainId?: string;
    separateKey?: string;
    separateId?: string;
    existingSeparate?: Record<string, string>;
  }
): Promise<void> {
  const { monthId, bucketId, runExists, mainId, separateKey, separateId, existingSeparate } = args;
  if (!runExists) {
    const separate = { ...(existingSeparate || {}) };
    if (separateKey && separateId) separate[separateKey] = separateId;
    await setDoc(
      billingRunRef,
      {
        monthId,
        createdBillingNotes: {
          [bucketId]: {
            ...(mainId ? { main: mainId } : {}),
            ...(Object.keys(separate).length > 0 ? { separate } : {}),
          },
        },
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return;
  }
  if (separateKey && separateId) {
    await updateDoc(
      billingRunRef,
      fpBillingRunCreatedSeparate(bucketId, separateKey),
      separateId,
      'updatedAt',
      serverTimestamp()
    );
    return;
  }
  if (mainId) {
    await updateDoc(
      billingRunRef,
      fpBillingRunCreatedMain(bucketId),
      mainId,
      'updatedAt',
      serverTimestamp()
    );
  }
}

/** ถอดลิงก์ใบวางบิลออกจากบิลต้นทาง — ใช้ตอนรีเซ็ตหรือยกเลิกใบวางบิล */
export async function clearBillingNoteLinksByIds(db: Firestore, invoiceIds: string[]): Promise<void> {
  const ids = invoiceIds.map((id) => id.trim()).filter(Boolean);
  for (let i = 0; i < ids.length; i += 400) {
    const slice = ids.slice(i, i + 400);
    const batch = writeBatch(db);
    for (const id of slice) {
      batch.update(doc(db, 'documents', id), {
        billingNoteId: deleteField(),
        billingNoteNo: deleteField(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }
}

export async function clearBillingNoteLinks(db: Firestore, invoices: Document[]): Promise<void> {
  const ids = invoices.filter((inv) => inv.billingNoteId || inv.billingNoteNo).map((inv) => inv.id);
  await clearBillingNoteLinksByIds(db, ids);
}
