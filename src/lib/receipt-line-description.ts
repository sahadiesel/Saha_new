import { APP_DATE_FORMAT, safeFormat } from "@/lib/date-utils";
import { taxDocumentCustomerDisplayName } from "@/lib/customer-utils";
import type { Document, DocumentItem } from "@/lib/types";

type ReceiptSourceDoc = Pick<
  Document,
  "id" | "docType" | "docNo" | "docDate" | "customerId" | "customerSnapshot"
>;

function formatSourceDocDate(docDate: string | undefined): string {
  if (!docDate) return "";
  try {
    return safeFormat(new Date(docDate), APP_DATE_FORMAT);
  } catch {
    return docDate;
  }
}

function docTypeLabel(docType: Document["docType"]): string {
  return docType === "TAX_INVOICE" ? "ใบกำกับภาษี" : "ใบวางบิล";
}

function resolveDocCustomerId(doc: ReceiptSourceDoc): string {
  return doc.customerId || doc.customerSnapshot?.id || "";
}

/** คำอธิบายรายการใบเสร็จ — บรรทัด 2 ใส่เลขที่และวันที่ใบกำกับ/ใบวางบิล */
export function buildReceiptLineDescription(
  sourceDoc: ReceiptSourceDoc,
  options?: { customerLabel?: string; includeDate?: boolean }
): string {
  const customerLabel = options?.customerLabel ?? "";
  const includeDate = options?.includeDate !== false;
  const dateStr = includeDate ? formatSourceDocDate(sourceDoc.docDate) : "";
  const datePart = dateStr ? ` วันที่ ${dateStr}` : "";
  return `ชำระค่าสินค้า/บริการ${customerLabel} ตาม${docTypeLabel(sourceDoc.docType)}\nเลขที่ ${sourceDoc.docNo}${datePart}`;
}

/** คำอธิบายสั้นสำหรับฟอร์ม — ไม่ซ้ำวันที่ (มีคอลัมน์วันที่แยก) */
export function buildReceiptLineDescriptionForEdit(
  sourceDoc: ReceiptSourceDoc,
  options?: { customerLabel?: string }
): string {
  return buildReceiptLineDescription(sourceDoc, {
    ...options,
    includeDate: false,
  });
}

/** ตัดส่วน "วันที่ dd/mm/yyyy" ออกจากคำอธิบายที่ซ้ำกับคอลัมน์วันที่ */
export function stripReceiptDescriptionDate(description: string): string {
  return description
    .replace(/\s*วันที่\s+\d{1,2}\/\d{1,2}\/\d{2,4}/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** ดึงเลขที่เอกสารจากข้อความรายการใบเสร็จ */
export function extractDocNoFromReceiptDescription(description: string): string | null {
  const m = description.match(/เลขที่\s+([A-Za-z0-9][A-Za-z0-9\-\/]*)/);
  const no = m?.[1]?.trim();
  return no || null;
}

/** ดึงวันที่จากข้อความรายการใบเสร็จ → YYYY-MM-DD */
export function extractDateFromReceiptDescription(description: string): string | null {
  const m = description.match(/วันที่\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  let year = Number(m[3]);
  if (!Number.isFinite(year)) return null;
  if (year < 100) year += 2000;
  const month = String(Number(m[2])).padStart(2, "0");
  const day = String(Number(m[1])).padStart(2, "0");
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

function extractReceiptCustomerLabel(description: string): string {
  const match = description.match(/^ชำระค่าสินค้า\/บริการ( \([^)]+\))?/);
  return match?.[1] ?? "";
}

function receiptDescriptionHasSourceDate(description: string): boolean {
  return /วันที่\s+\d{1,2}\/\d{1,2}\/\d{2,4}/.test(description);
}

/** เติมวันที่ใบกำกับในรายการใบเสร็จเก่าที่ยังไม่มี (สำหรับหน้าแสดง/พิมพ์) */
export function enrichReceiptItemsWithSourceDocs(
  items: DocumentItem[],
  sourceDocs: ReceiptSourceDoc[],
  referencesDocIds?: string[]
): DocumentItem[] {
  if (!sourceDocs.length || !items.length) return items;

  const customerIds = new Set(
    sourceDocs.map((d) => resolveDocCustomerId(d)).filter(Boolean)
  );
  const multiCustomer = customerIds.size > 1;

  return items.map((item, index) => {
    if (receiptDescriptionHasSourceDate(item.description)) {
      return item;
    }

    const sourceDocId = referencesDocIds?.[index];
    const sourceDoc = sourceDocId
      ? sourceDocs.find((d) => d.id === sourceDocId)
      : sourceDocs[index];

    if (!sourceDoc) return item;

    const existingLabel = extractReceiptCustomerLabel(item.description);
    let customerLabel = existingLabel;
    if (!customerLabel && multiCustomer) {
      const name = taxDocumentCustomerDisplayName(sourceDoc.customerSnapshot);
      customerLabel = name ? ` (${name})` : "";
    }

    return {
      ...item,
      description: buildReceiptLineDescription(sourceDoc, { customerLabel }),
    };
  });
}
