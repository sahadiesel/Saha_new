import type { Document } from "@/lib/types";

/**
 * ยอดก่อนภาษีจากเอกสาร
 * ใบเสร็จมักเก็บ net = grandTotal (รวม VAT) จึงใช้ grand − vat เมื่อมีภาษี
 */
export function documentAmountBeforeTax(
  d: Pick<Document, "net" | "grandTotal" | "vatAmount">
): number {
  const grand = Number(d.grandTotal) || 0;
  const vat = Number(d.vatAmount) || 0;
  if (vat > 0.009) {
    return Math.round((grand - vat) * 100) / 100;
  }
  if (typeof d.net === "number" && Number.isFinite(d.net)) {
    return d.net;
  }
  return grand;
}

/**
 * ยอดสำหรับพิมพ์/แสดง — แก้กรณีใบเสร็จเก่าเก็บ subtotal/net เท่ากับยอดรวม
 */
export function documentPrintMoneyLines(
  d: Pick<Document, "subtotal" | "discountAmount" | "net" | "grandTotal" | "vatAmount" | "withTax">
): {
  subtotal: number;
  discount: number;
  beforeTax: number;
  vat: number;
  grand: number;
} {
  const grand = Number(d.grandTotal) || 0;
  const vat = Number(d.vatAmount) || 0;
  const discount = Number(d.discountAmount) || 0;
  const beforeTax = documentAmountBeforeTax(d);
  let subtotal = Number(d.subtotal) || 0;
  if (vat > 0.009 && Math.abs(subtotal - grand) < 0.02) {
    subtotal = Math.round((beforeTax + discount) * 100) / 100;
  }
  return { subtotal, discount, beforeTax, vat, grand };
}
