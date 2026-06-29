import type { AccountingObligation } from "@/lib/types";
import { roundMoney } from "@/lib/accounting-balance";

export type ArDocPaymentSnapshot = {
  grandTotal?: number;
  netAmount?: number;
  vatAmount?: number;
  paymentSummary?: {
    paidTotal?: number;
    balance?: number;
    paymentStatus?: string;
  };
};

/** ยอดชำระแล้ว — ใช้ paymentSummary จากเอกสารต้นทางเป็นหลัก (กัน amountPaid บน obligation ค้าง) */
export function resolveArPaidAmount(
  ob: Pick<AccountingObligation, "amountPaid" | "sourceDocType">,
  doc?: ArDocPaymentSnapshot | null
): number {
  if (ob.sourceDocType === "CREDIT_NOTE") {
    return roundMoney(Number(ob.amountPaid) || 0);
  }
  const fromDoc = doc?.paymentSummary?.paidTotal;
  if (fromDoc != null && !Number.isNaN(Number(fromDoc))) {
    return roundMoney(Number(fromDoc));
  }
  return roundMoney(Number(ob.amountPaid) || 0);
}

/** ยอดคงค้าง — คำนวณจากยอดรวมเอกสาร − ชำระแล้ว (ไม่ใช้ ob.balance ที่อาจค้าง) */
export function resolveArOutstandingBalance(
  ob: Pick<AccountingObligation, "status" | "amountPaid" | "balance" | "amountTotal" | "sourceDocType">,
  doc?: ArDocPaymentSnapshot | null
): number {
  if (ob.status === "PAID") return 0;
  if (ob.sourceDocType === "CREDIT_NOTE") {
    return roundMoney(Number(ob.balance) || 0);
  }
  const grand = Number(doc?.grandTotal ?? ob.amountTotal ?? 0);
  const paid = resolveArPaidAmount(ob, doc);
  if (grand > 0 || paid > 0) {
    return roundMoney(grand - paid);
  }
  return roundMoney(Number(ob.balance) || 0);
}

/** ยอดก่อนภาษี/ภาษี/รวม — กัน net ผิดปกติจากฟิลด์เอกสาร */
export function sanitizeArDocAmounts(
  ob: Pick<AccountingObligation, "amountTotal">,
  doc?: ArDocPaymentSnapshot | null
): { net: number; vat: number; grand: number } {
  const grand = roundMoney(Number(doc?.grandTotal ?? ob.amountTotal ?? 0));
  let vat = roundMoney(Number(doc?.vatAmount ?? 0));
  let net = roundMoney(Number(doc?.netAmount ?? 0));

  if (grand > 0.009) {
    if (!Number.isFinite(vat) || vat < 0 || vat > grand + 0.01) vat = 0;
    if (!Number.isFinite(net) || net <= 0.009 || net > grand + 0.01) {
      net = roundMoney(Math.max(0, grand - vat));
    }
    if (vat <= 0.009 && net > 0.009 && net < grand - 0.009) {
      vat = roundMoney(grand - net);
    }
    if (net + vat > grand + 0.02) {
      net = roundMoney(Math.max(0, grand - vat));
    }
  } else {
    if (!Number.isFinite(vat) || vat < 0) vat = 0;
    if (!Number.isFinite(net) || net < 0) net = 0;
  }

  return { net, vat, grand };
}

/** แยกยอดชำระแล้ว/ค้างชำระ เป็น net/vat สำหรับสรุปหน้าลูกหนี้ */
export function splitObligationPaidOutstanding(
  ob: Pick<AccountingObligation, "amountPaid" | "status" | "amountTotal" | "balance" | "sourceDocType">,
  doc?: ArDocPaymentSnapshot | null,
  type: "AR" | "AP" = "AR"
): {
  net: number;
  vat: number;
  grand: number;
  paid: number;
  balance: number;
  paidNet: number;
  paidVat: number;
  outNet: number;
  outVat: number;
} {
  const { net, vat, grand } = sanitizeArDocAmounts(ob, doc);
  const paidRaw =
    type === "AR" ? resolveArPaidAmount(ob, doc) : roundMoney(Number(ob.amountPaid) || 0);
  const paid =
    grand > 0.009 ? roundMoney(Math.min(Math.max(0, paidRaw), grand)) : roundMoney(Math.max(0, paidRaw));
  const balanceRaw =
    type === "AR" ? resolveArOutstandingBalance(ob, doc) : roundMoney(Number(ob.balance) || 0);
  const balance =
    grand > 0.009
      ? roundMoney(Math.min(Math.max(0, balanceRaw), grand))
      : roundMoney(Math.max(0, balanceRaw));

  const paidNet = grand > 0.009 ? roundMoney((net * paid) / grand) : 0;
  const paidVat = grand > 0.009 ? roundMoney((vat * paid) / grand) : 0;
  const outNet = grand > 0.009 ? roundMoney((net * balance) / grand) : 0;
  const outVat = grand > 0.009 ? roundMoney((vat * balance) / grand) : 0;

  return { net, vat, grand, paid, balance, paidNet, paidVat, outNet, outVat };
}
