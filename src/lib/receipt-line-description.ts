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

/** คำอธิบายรายการใบเสร็จ — บรรทัด 2 ระบุเลขที่และวันที่ใบกำกับ/ใบวางบิล */
export function buildReceiptLineDescription(
  sourceDoc: ReceiptSourceDoc,
  options?: { customerLabel?: string }
): string {
  const customerLabel = options?.customerLabel ?? "";
  const dateStr = formatSourceDocDate(sourceDoc.docDate);
  const datePart = dateStr ? ` วันที่ ${dateStr}` : "";
  return `ชำระค่าสินค้า/บริการ${customerLabel} ตาม${docTypeLabel(sourceDoc.docType)}\nเลขที่ ${sourceDoc.docNo}${datePart}`;
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
