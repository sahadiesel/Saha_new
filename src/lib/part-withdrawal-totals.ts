import type { DocumentItem, Part } from "@/lib/types";

/** จำนวนที่เบิกจริงหลังหักยอดที่คืนสต็อกแล้ว */
export function remainingWithdrawQty(
  item: Pick<DocumentItem, "quantity" | "returnedToStockQty">
): number {
  return Math.max(0, Number(item.quantity || 0) - Number(item.returnedToStockQty || 0));
}

/**
 * ราคาต่อหน่วยที่ใช้คำนวณมูลค่าเบิก
 * รองรับข้อมูลเก่าที่เก็บยอดรวมบรรทัดไว้ใน unitPrice แทนราคาต่อหน่วย
 */
export function effectiveWithdrawalUnitPrice(
  item: Pick<DocumentItem, "quantity" | "unitPrice" | "total">
): number {
  const qty = Number(item.quantity) || 0;
  const unitPrice = Number(item.unitPrice) || 0;
  const storedTotal = Number(item.total) || 0;

  if (qty <= 0) return unitPrice;

  if (storedTotal > 0) {
    const implied = storedTotal / qty;
    if (unitPrice <= 0) return implied;
    // ข้อมูลเก่า: unitPrice เป็นยอดรวมบรรทัด แต่ quantity > 1
    if (qty > 1 && storedTotal <= unitPrice + 0.01) return implied;
    // unitPrice × qty สูงกว่ายอดรวมที่บันทึกไว้ชัดเจน
    if (unitPrice * qty > storedTotal + 0.01) return implied;
  }

  return unitPrice;
}

/** มูลค่าบรรทัด = จำนวนคงเหลือ × ราคาต่อหน่วย (ปรับตามข้อมูลเก่าได้) */
export function withdrawalLineValue(
  item: Pick<DocumentItem, "quantity" | "returnedToStockQty" | "unitPrice" | "total">
): number {
  const rem = remainingWithdrawQty(item);
  if (rem <= 0) return 0;
  const unit = effectiveWithdrawalUnitPrice(item);
  return Math.round(rem * unit * 100) / 100;
}

export function recalcWithdrawalLineTotals(items: DocumentItem[]): DocumentItem[] {
  return items.map((i) => ({
    ...i,
    total: withdrawalLineValue(i),
  }));
}

/** มูลค่ารวมใบเบิก — นับเฉพาะบรรทัดที่มี partId */
export function sumWithdrawalGrand(items: DocumentItem[]): number {
  return (
    Math.round(
      items
        .filter((i) => i.partId)
        .reduce((s, i) => s + withdrawalLineValue(i), 0) * 100
    ) / 100
  );
}

/** ราคาต่อหน่วยจากใบเสนอราคา (ถ้ามีบรรทัดที่ตรงกับอะไหล่) */
export function quotationUnitPriceForPart(
  quotationItems: DocumentItem[] | undefined,
  part: Pick<Part, "id" | "code">
): number | null {
  if (!quotationItems?.length) return null;

  const line = quotationItems.find(
    (l) =>
      (l.partId && l.partId === part.id) ||
      (l.code && part.code && l.code.trim() === part.code.trim())
  );
  if (!line) return null;

  const unitPrice = Number(line.unitPrice);
  if (unitPrice > 0) return unitPrice;

  const qty = Number(line.quantity);
  const total = Number(line.total);
  if (qty > 0 && total > 0) {
    return Math.round((total / qty) * 100) / 100;
  }

  return null;
}
