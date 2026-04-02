import type { Customer, Document } from '@/lib/types';

/** กลุ่มเริ่มต้นสำหรับใบวางบิล — รวมด้วยมือผ่าน billingMergedBuckets ได้ */
export function billingBucketId(inv: Document): string {
  return (
    inv.customerId ||
    inv.customerSnapshot?.id ||
    inv.customerSnapshot?.phone ||
    `doc:${inv.id}`
  );
}

/** รวมแถวย่อย (follower) เข้าหัวกลุ่ม (leader) ตาม billingMergedBuckets */
export function collapseBillingBucketMerges(
  grouped: Record<string, { customer: Customer; invoices: Document[] }>,
  merged: Record<string, string> | undefined
) {
  const m = { ...(merged || {}) };
  let guard = 0;
  let changed = true;
  while (changed && guard++ < 20) {
    changed = false;
    for (const [follower, leader] of Object.entries(m)) {
      if (!follower || !leader || follower === leader) continue;
      const f = grouped[follower];
      const L = grouped[leader];
      if (!f || !L) continue;
      L.invoices.push(...f.invoices);
      delete grouped[follower];
      changed = true;
    }
  }
}
