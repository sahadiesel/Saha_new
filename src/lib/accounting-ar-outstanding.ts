import type { AccountingObligation } from "@/lib/types";
import { roundMoney } from "@/lib/accounting-balance";

export type ArDocPaymentSnapshot = {
  grandTotal?: number;
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
