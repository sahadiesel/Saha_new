import type { PurchaseDoc, DocumentSettings, StoreSettings } from "@/lib/types";

export function roundPurchaseMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** คำนวณยอดซื้องานจ้าง: หัก WHT จากยอดก่อนภาษี แล้วบวก VAT กลับเป็นยอดจ่ายสุทธิ */
export function computeServicePurchaseAmounts(input: {
  subtotal: number;
  discountAmount?: number;
  withTax: boolean;
  withholdingEnabled: boolean;
  withholdingPercent: number;
}) {
  const subtotal = input.subtotal || 0;
  const discount = input.discountAmount || 0;
  const net = roundPurchaseMoney(Math.max(0, subtotal - discount));
  const vatAmount = input.withTax ? roundPurchaseMoney(net * 0.07) : 0;
  const grandTotal = roundPurchaseMoney(net + vatAmount);
  const whtBase = net;
  const withholdingAmount =
    input.withholdingEnabled && input.withholdingPercent > 0
      ? roundPurchaseMoney(whtBase * (input.withholdingPercent / 100))
      : 0;
  const amountPayable = roundPurchaseMoney(net - withholdingAmount + vatAmount);

  return {
    subtotal,
    net,
    vatAmount,
    grandTotal,
    whtBase,
    withholdingAmount,
    amountPayable,
  };
}

/** ฐานหัก ณ ที่จ่ายจากเอกสารซื้อ — ใช้ยอดก่อนภาษี (หลังส่วนลด) เมื่อมี VAT */
export function purchaseWithholdingBase(
  purchase: Pick<PurchaseDoc, "withTax" | "vatAmount" | "net" | "subtotal" | "discountAmount" | "grandTotal">
): number {
  if (purchase.withTax && (purchase.vatAmount || 0) > 0) {
    return purchase.net ?? roundPurchaseMoney(purchase.subtotal - (purchase.discountAmount || 0));
  }
  return purchase.grandTotal;
}

export function purchaseWithholdingAmount(
  purchase: Pick<
    PurchaseDoc,
    "withholdingEnabled" | "withholdingPercent" | "withholdingAmount" | "withTax" | "vatAmount" | "net" | "subtotal" | "discountAmount" | "grandTotal"
  >
): number {
  if (!purchase.withholdingEnabled) return 0;
  if (purchase.withholdingAmount != null && purchase.withholdingAmount > 0) {
    return purchase.withholdingAmount;
  }
  const base = purchaseWithholdingBase(purchase);
  const rate = purchase.withholdingPercent || 0;
  return rate > 0 ? roundPurchaseMoney(base * (rate / 100)) : 0;
}

export function purchaseAmountPayable(
  purchase: Pick<
    PurchaseDoc,
    "amountPayable" | "grandTotal" | "withholdingEnabled" | "withholdingPercent" | "withholdingAmount" | "withTax" | "vatAmount" | "net" | "subtotal" | "discountAmount"
  >
): number {
  if (purchase.amountPayable != null && purchase.amountPayable >= 0) {
    return purchase.amountPayable;
  }
  const wht = purchaseWithholdingAmount(purchase);
  return roundPurchaseMoney(purchase.grandTotal - wht);
}

export type WithholdingTaxDocPayload = {
  docType: "WITHHOLDING_TAX";
  docNo: string;
  docDate: string;
  payerSnapshot: StoreSettings;
  payeeSnapshot: { name?: string; taxId?: string; address?: string };
  vendorId: string;
  paidMonth: number;
  paidYear: number;
  incomeTypeCode: string;
  paidAmountGross: number;
  withholdingPercent: number;
  withholdingAmount: number;
  paidAmountNet: number;
  status: "ISSUED";
  senderName?: string;
  receiverName?: string;
  sourcePurchaseDocId?: string;
  sourcePurchaseDocNo?: string;
};

export function buildWithholdingTaxDocPayload(params: {
  docNo: string;
  docDate: string;
  storeSettings: StoreSettings;
  purchase: PurchaseDoc;
  senderName?: string;
}): WithholdingTaxDocPayload {
  const whtBase = purchaseWithholdingBase(params.purchase);
  const whtAmount = purchaseWithholdingAmount(params.purchase);
  const year = Number(params.docDate.slice(0, 4));

  return {
    docType: "WITHHOLDING_TAX",
    docNo: params.docNo,
    docDate: params.docDate,
    payerSnapshot: params.storeSettings,
    payeeSnapshot: {
      name: params.purchase.vendorSnapshot.companyName,
      taxId: params.purchase.vendorSnapshot.taxId,
      address: params.purchase.vendorSnapshot.address,
    },
    vendorId: params.purchase.vendorId,
    paidMonth: Number(params.docDate.slice(5, 7)),
    paidYear: year,
    incomeTypeCode: "ITEM5",
    paidAmountGross: whtBase,
    withholdingPercent: params.purchase.withholdingPercent || 0,
    withholdingAmount: whtAmount,
    paidAmountNet: roundPurchaseMoney(whtBase - whtAmount),
    status: "ISSUED",
    senderName: params.senderName,
    receiverName: params.purchase.vendorSnapshot.companyName,
    sourcePurchaseDocId: params.purchase.id,
    sourcePurchaseDocNo: params.purchase.docNo,
  };
}

export function nextWithholdingTaxDocNo(
  settings: DocumentSettings,
  counters: Record<string, unknown>,
  year: number
): { docNo: string; nextCount: number; prefix: string } {
  const prefix = settings.withholdingTaxPrefix || "WHT";
  const lastPrefix = counters.withholdingTaxPrefix as string | undefined;
  const lastCount = (counters.withholdingTax as number | undefined) || 0;
  const nextCount = lastPrefix !== prefix ? 1 : lastCount + 1;
  const docNo = `${prefix}${year}-${String(nextCount).padStart(4, "0")}`;
  return { docNo, nextCount, prefix };
}
