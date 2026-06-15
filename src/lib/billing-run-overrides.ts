import {
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';
import type { BillingRun } from '@/lib/types';
import { sanitizeBillingMergedBuckets } from '@/lib/billing-bucket-merge';
import {
  type BillingTableRow,
  billingRowCollectBucketInvoices,
} from '@/lib/billing-note-batch-helpers';

/** บิลทั้งหมดบนแถว (รวมแถวแยกที่ explode แล้ว) */
export function billingRowCollectRowInvoices(row: BillingTableRow) {
  return [
    ...row.includedInvoices,
    ...row.deferredInvoices,
    ...Object.values(row.separateGroups).flat(),
  ];
}

/** bucket หัวกลุ่ม + follower ที่ชี้มา (รวม chain) */
export function billingExpandedBucketIds(
  anchorBucket: string,
  merged?: Record<string, string>
): string[] {
  const m = sanitizeBillingMergedBuckets(merged);
  const ids = new Set<string>([anchorBucket]);
  for (let guard = 0; guard < 20; guard++) {
    let changed = false;
    for (const [follower, leader] of Object.entries(m)) {
      if (ids.has(leader) && !ids.has(follower)) {
        ids.add(follower);
        changed = true;
      }
      if (ids.has(follower) && !ids.has(leader)) {
        ids.add(leader);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return Array.from(ids);
}

/** รายการ invoice id ที่ต้อง reset แผนวางบิล */
export function billingResolveOverrideScopeIds(args: {
  anchorBucket: string;
  customerData: BillingTableRow[];
  merged?: Record<string, string>;
  selectedRows?: BillingTableRow[];
  existingSeparate?: Record<string, string>;
}): string[] {
  const bucketIds = billingExpandedBucketIds(args.anchorBucket, args.merged);
  const ids = new Set<string>();

  for (const bucketId of bucketIds) {
    for (const inv of billingRowCollectBucketInvoices(bucketId, args.customerData)) {
      ids.add(inv.id);
    }
  }
  for (const row of args.selectedRows ?? []) {
    for (const inv of billingRowCollectRowInvoices(row)) {
      ids.add(inv.id);
    }
  }

  // stale keys ใน separate map ที่เป็นบิลใน bucket กลุ่มนี้
  for (const invId of Object.keys(args.existingSeparate ?? {})) {
    for (const bucketId of bucketIds) {
      if (
        billingRowCollectBucketInvoices(bucketId, args.customerData).some((i) => i.id === invId)
      ) {
        ids.add(invId);
      }
    }
  }

  return Array.from(ids);
}

/** บันทึกแผนเลื่อน/แยก/รวม — เขียน map ทั้งก้อนให้ sync กับ Firestore */
export async function billingPersistRunOverrides(
  billingRunRef: DocumentReference,
  args: {
    monthId: string;
    profile: { uid: string; displayName: string };
    scopeIds: string[];
    prevDeferred: Record<string, boolean>;
    prevSeparate: Record<string, string>;
    deferred: Record<string, boolean>;
    separate: Record<string, string>;
    billingMergedBuckets?: Record<string, string>;
  }
): Promise<{ deferred: Record<string, boolean>; separate: Record<string, string> }> {
  const newDeferred: Record<string, boolean> = { ...args.prevDeferred };
  const newSeparate: Record<string, string> = { ...args.prevSeparate };

  for (const id of args.scopeIds) {
    delete newDeferred[id];
    delete newSeparate[id];
  }
  for (const [id, key] of Object.entries(args.separate)) {
    newSeparate[id] = key;
  }
  for (const [id, v] of Object.entries(args.deferred)) {
    if (v) newDeferred[id] = true;
  }

  const patch: Record<string, unknown> = {
    monthId: args.monthId,
    separateInvoiceGroups: newSeparate,
    deferredInvoices: newDeferred,
    updatedAt: serverTimestamp(),
    updatedByUid: args.profile.uid,
    updatedByName: args.profile.displayName,
  };

  if (args.billingMergedBuckets !== undefined) {
    patch.billingMergedBuckets = args.billingMergedBuckets;
  }

  await updateDoc(billingRunRef, patch);

  return { deferred: newDeferred, separate: newSeparate };
}

export type BillingRunWithId = BillingRun & { id: string };

export async function billingFetchRunFromServer(
  db: Firestore,
  monthId: string
): Promise<BillingRunWithId | null> {
  const ref = doc(db, 'billingRuns', monthId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as BillingRunWithId;
}
