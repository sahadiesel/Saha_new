import type { DocumentItem } from "@/lib/types";

/** บรรทัดใบเบิกสำหรับคำนวณ delta สต็อก */
export type WithdrawalLineForDelta = {
  partId: string;
  quantity: number;
  code?: string;
  description: string;
};

/**
 * คำนวณการเปลี่ยนแปลงสต็อกรวมต่อ partId เมื่อแก้ไขใบเบิก
 * - delta > 0 : ต้องหักสต็อกเพิ่ม (เบิกเพิ่มหรือเพิ่มจำนวน)
 * - delta < 0 : คืนสต็อก (ลดจำนวนเบิก / ลบบรรทัด / เปลี่ยนเป็นสินค้าอื่น)
 *
 * เมื่อ prevIssued === false (ฉบับร่างเพิ่งออกใบ / สร้างใหม่): ใช้เฉพาะ nextItems เป็นยอดเบิกเต็ม
 * เมื่อ prevIssued === true: เทียบทีละบรรทัด (index) กับของเดิม
 */
export function mergeStockDeltasFromWithdrawalEdit(
  prevItems: WithdrawalLineForDelta[],
  nextItems: WithdrawalLineForDelta[],
  prevIssued: boolean
): Map<string, { delta: number; code?: string; description: string }> {
  const map = new Map<string, { delta: number; code?: string; description: string }>();

  const bump = (partId: string, d: number, code?: string, description?: string) => {
    if (!partId || Math.abs(d) < 1e-9) return;
    const cur = map.get(partId);
    if (cur) {
      cur.delta += d;
    } else {
      map.set(partId, { delta: d, code, description: description || "" });
    }
  };

  if (!prevIssued) {
    for (const n of nextItems) {
      if (!n.partId) continue;
      bump(n.partId, n.quantity, n.code, n.description);
    }
    return map;
  }

  const len = Math.max(prevItems.length, nextItems.length);
  for (let i = 0; i < len; i++) {
    const o = prevItems[i];
    const n = nextItems[i];

    if (!n && o?.partId) {
      bump(o.partId, -o.quantity, o.code, o.description);
    } else if (!o && n?.partId) {
      bump(n.partId, n.quantity, n.code, n.description);
    } else if (o && n) {
      if (!o.partId || !n.partId) continue;
      if (o.partId === n.partId) {
        bump(n.partId, n.quantity - o.quantity, n.code ?? o.code, n.description);
      } else {
        bump(o.partId, -o.quantity, o.code, o.description);
        bump(n.partId, n.quantity, n.code, n.description);
      }
    }
  }

  return map;
}

export function documentItemsToDeltaLines(items: DocumentItem[]): WithdrawalLineForDelta[] {
  return items
    .filter((i) => i.partId)
    .map((i) => ({
      partId: i.partId!,
      quantity: i.quantity,
      code: i.code,
      description: i.description,
    }));
}

/** สรุปรายการตัด / คืน สำหรับแสดงในกล่องยืนยัน */
export type StockMovementRow = {
  partId: string;
  code?: string;
  description: string;
  quantity: number;
};

export function summarizeWithdrawalDeltas(
  deltaMap: Map<string, { delta: number; code?: string; description: string }>
): { withdrawals: StockMovementRow[]; returnsToStock: StockMovementRow[] } {
  const withdrawals: StockMovementRow[] = [];
  const returnsToStock: StockMovementRow[] = [];

  for (const [partId, { delta, code, description }] of deltaMap) {
    if (Math.abs(delta) < 1e-9) continue;
    const label = description || code || partId;
    if (delta > 0) {
      withdrawals.push({ partId, code, description: label, quantity: delta });
    } else {
      returnsToStock.push({ partId, code, description: label, quantity: Math.abs(delta) });
    }
  }

  withdrawals.sort((a, b) => (a.code || a.description).localeCompare(b.code || b.description, "th"));
  returnsToStock.sort((a, b) => (a.code || a.description).localeCompare(b.code || b.description, "th"));

  return { withdrawals, returnsToStock };
}
