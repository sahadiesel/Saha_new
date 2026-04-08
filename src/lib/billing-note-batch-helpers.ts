import { collection, getDocs, query, where, type Firestore } from 'firebase/firestore';
import type { Customer, Document } from '@/lib/types';

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
  const label = c.useTax ? c.taxName || c.name || '' : c.name || '';
  const suffix = (k: string) => ` (แยก ${k})`;

  const mainRow: BillingTableRow = {
    ...row,
    separateGroups: {},
    splitSubgroupKeys: keys,
    totalIncludedAmount: row.includedInvoices.reduce((s, i) => s + i.grandTotal, 0),
    parentBillingNotesSnapshot: parentNotes,
    billingTargetBucketId: baseBucket,
    splitInvoiceGroupKey: undefined,
    createdNoteIds: parentNotes,
  };

  const subRows: BillingTableRow[] = keys.map((key) => {
    const invs = row.separateGroups[key]!;
    const virtualId = `${baseBucket}::split::${key}`;
    const sepId = parentNotes?.separate?.[key];
    const nextCustomer = c.useTax
      ? ({ ...c, id: virtualId, taxName: `${label}${suffix(key)}` } as Customer)
      : ({ ...c, id: virtualId, name: `${label}${suffix(key)}` } as Customer);

    return {
      ...row,
      customer: nextCustomer,
      includedInvoices: invs,
      deferredInvoices: [],
      separateGroups: {},
      totalIncludedAmount: invs.reduce((s, i) => s + i.grandTotal, 0),
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

/** สถานะแสดงผลแถว (หลัง explode) */
export function billingRowUiStatus(row: BillingTableRow): 'created' | 'pending' | 'empty' {
  if (row.splitInvoiceGroupKey) {
    if (row.createdNoteIds?.main) return 'created';
    return row.includedInvoices.length > 0 ? 'pending' : 'empty';
  }

  if (row.deferredInvoices.length > 0) return 'pending';

  const needMain = row.includedInvoices.length > 0;
  const keys = row.splitSubgroupKeys || [];
  const sep = row.createdNoteIds?.separate || {};

  if (needMain && !row.createdNoteIds?.main) return 'pending';
  for (const k of keys) {
    if (!sep[k]) return 'pending';
  }

  const hasSplitChildren = keys.length > 0;
  const anyCreated =
    !!row.createdNoteIds?.main || Object.values(sep).some(Boolean);
  if (!needMain && !hasSplitChildren) {
    return anyCreated ? 'created' : 'empty';
  }
  return anyCreated ? 'created' : 'pending';
}

export function billingTargetBucket(row: BillingTableRow): string {
  return row.billingTargetBucketId ?? row.customer.id;
}

/** บิลที่ถูกเลื่อนไปวางเดือน monthId (ดึงเพิ่มจากเอกสาร) */
export async function fetchDeferredRollInDocuments(db: Firestore, monthId: string): Promise<Document[]> {
  const q = query(collection(db, 'documents'), where('billingDeferUntilMonth', '==', monthId));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Document))
    .filter(
      (doc) =>
        (doc.docType === 'TAX_INVOICE' || doc.docType === 'DELIVERY_NOTE') &&
        doc.paymentTerms === 'CREDIT' &&
        !['PAID', 'CANCELLED', 'REJECTED'].includes(doc.status)
    );
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
