import type { AccountingObligation } from "@/lib/types";
import type { WithId } from "@/firebase";

/** เลขที่เอกสาร + ลูกค้า — ใช้รวมรายการลูกหนี้ซ้ำ (หลาย documents id เลขที่เดียวกัน) */
export function arInvoiceDedupeKey(parts: {
  sourceDocNo?: string;
  customerId?: string | null;
  customerNameSnapshot?: string | null;
}): string {
  const no = (parts.sourceDocNo || "").trim().toUpperCase();
  const cust = String(parts.customerId || parts.customerNameSnapshot || "").trim();
  return `${no}::${cust}`;
}

const AR_DEDUPE_DOC_TYPES = ["TAX_INVOICE", "DELIVERY_NOTE", "BILLING_NOTE"] as const;

export function isArDedupeDocType(t: string | undefined): boolean {
  return !!t && (AR_DEDUPE_DOC_TYPES as readonly string[]).includes(t);
}

export function pickCanonicalArAmongDuplicates(group: WithId<AccountingObligation>[]): WithId<AccountingObligation> {
  return [...group].sort((a, b) => {
    const da = (a.docDate || "").trim();
    const db = (b.docDate || "").trim();
    if (da && db && da !== db) return da.localeCompare(db);
    if (da && !db) return -1;
    if (!da && db) return 1;
    const ac = (a as { createdAt?: { toDate?: () => Date } }).createdAt;
    const bc = (b as { createdAt?: { toDate?: () => Date } }).createdAt;
    const ta = ac?.toDate?.() ? ac.toDate().getTime() : 0;
    const tb = bc?.toDate?.() ? bc.toDate().getTime() : 0;
    if (ta !== tb) return ta - tb;
    return (a.sourceDocId || "").localeCompare(b.sourceDocId || "");
  })[0];
}

/** แสดงแถวเดียวต่อเลขที่ + ลูกค้า สำหรับใบกำกับ / ใบส่งของ / วางบิล */
export function dedupeUnpaidArBySalesDocNo(obligations: WithId<AccountingObligation>[]): WithId<AccountingObligation>[] {
  const passthrough: WithId<AccountingObligation>[] = [];
  const groups = new Map<string, WithId<AccountingObligation>[]>();
  for (const ob of obligations) {
    if (!isArDedupeDocType(ob.sourceDocType) || !(ob.sourceDocNo || "").trim()) {
      passthrough.push(ob);
      continue;
    }
    const k = arInvoiceDedupeKey({
      sourceDocNo: ob.sourceDocNo,
      customerId: ob.customerId,
      customerNameSnapshot: ob.customerNameSnapshot,
    });
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(ob);
  }
  const out = [...passthrough];
  for (const g of groups.values()) {
    out.push(g.length === 1 ? g[0] : pickCanonicalArAmongDuplicates(g));
  }
  return out;
}

type ArObligationLike = {
  id: string;
  sourceDocId?: string | null;
  sourceDocNo?: string;
  sourceDocType?: string;
  amountTotal?: number;
  customerId?: string | null;
  customerNameSnapshot?: string | null;
};

/**
 * รายการลูกหนี้อื่นที่น่าจะเป็นบิลเดียวกับที่เพิ่งรับชำระ (หลาย obligation id ชี้เอกสารเดียวกัน หรือเลขที่ซ้ำแต่คีย์ลูกค้าไม่ตรง)
 */
export function isArPaymentSiblingObligation(paid: ArObligationLike, ob: ArObligationLike): boolean {
  if (ob.id === paid.id) return false;
  if (!isArDedupeDocType(ob.sourceDocType) || !isArDedupeDocType(paid.sourceDocType)) return false;

  const pid = (paid.sourceDocId || "").trim();
  const oid = (ob.sourceDocId || "").trim();
  if (pid && oid && pid === oid) return true;

  if (paid.sourceDocType !== ob.sourceDocType) return false;

  const keyPaid = arInvoiceDedupeKey({
    sourceDocNo: paid.sourceDocNo,
    customerId: paid.customerId,
    customerNameSnapshot: paid.customerNameSnapshot,
  });
  const keyOb = arInvoiceDedupeKey({
    sourceDocNo: ob.sourceDocNo,
    customerId: ob.customerId,
    customerNameSnapshot: ob.customerNameSnapshot,
  });
  if (keyOb !== keyPaid) return false;

  const pt = Number(paid.amountTotal ?? 0);
  const ot = Number(ob.amountTotal ?? 0);
  return Math.abs(pt - ot) <= 0.05;
}
