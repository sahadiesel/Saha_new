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

/** แปลง id แถว UI (เช่น bucket::split::key) เป็น bucket จริงสำหรับรวมกลุ่ม */
export function normalizeBillingBucketKey(key: string): string {
  const idx = key.indexOf('::split::');
  return idx >= 0 ? key.slice(0, idx) : key;
}

/** ทำความสะอาด map รวมกลุ่ม — ตัด id แถวแยกและ chain ให้ชี้หัวกลุ่มสุดท้าย */
export function sanitizeBillingMergedBuckets(
  merged: Record<string, string> | undefined
): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const [rawFollower, rawLeader] of Object.entries(merged || {})) {
    const follower = normalizeBillingBucketKey(rawFollower);
    const leader = normalizeBillingBucketKey(rawLeader);
    if (!follower || !leader || follower === leader) continue;
    raw[follower] = leader;
  }

  const resolveLeader = (bucket: string): string => {
    let cur = bucket;
    const seen = new Set<string>();
    while (raw[cur] && raw[cur] !== cur) {
      if (seen.has(cur)) break;
      seen.add(cur);
      cur = raw[cur]!;
    }
    return cur;
  };

  const out: Record<string, string> = {};
  for (const follower of Object.keys(raw)) {
    const leader = resolveLeader(follower);
    if (follower !== leader) out[follower] = leader;
  }
  return out;
}

/** รวมแถวย่อย (follower) เข้าหัวกลุ่ม (leader) ตาม billingMergedBuckets */
export function collapseBillingBucketMerges(
  grouped: Record<string, { customer: Customer; invoices: Document[] }>,
  merged: Record<string, string> | undefined
) {
  const m = sanitizeBillingMergedBuckets(merged);
  let guard = 0;
  let changed = true;
  while (changed && guard++ < 20) {
    changed = false;
    for (const [follower, leader] of Object.entries(m)) {
      if (!follower || !leader || follower === leader) continue;
      const f = grouped[follower];
      if (!f) continue;
      let L = grouped[leader];
      if (!L) {
        grouped[leader] = {
          customer: { ...f.customer, id: leader } as Customer,
          invoices: [],
        };
        L = grouped[leader];
      }
      L.invoices.push(...f.invoices);
      delete grouped[follower];
      changed = true;
    }
  }
}
