/** แยกเลขที่ฐานกับหมายเลขฉบับแก้ไข เช่น QJ2026-0087 R2 → base + 2 */
export function parseQuotationBaseDocNo(docNo: string): { baseDocNo: string; revisionNo: number } {
  const trimmed = (docNo || "").trim();
  const match = trimmed.match(/^(.+?)\s+R(\d+)$/i);
  if (match) {
    return { baseDocNo: match[1].trim(), revisionNo: parseInt(match[2], 10) || 0 };
  }
  return { baseDocNo: trimmed, revisionNo: 0 };
}

export function formatQuotationRevisionDocNo(baseDocNo: string, revisionNo: number): string {
  if (revisionNo <= 0) return baseDocNo;
  return `${baseDocNo} R${revisionNo}`;
}

export function getQuotationRevisionNo(doc: {
  docNo: string;
  quotationRevisionNo?: number;
}): number {
  if (typeof doc.quotationRevisionNo === "number") return doc.quotationRevisionNo;
  return parseQuotationBaseDocNo(doc.docNo).revisionNo;
}

type QuotationRevisionIdentity = {
  id: string;
  docNo: string;
  quotationRevisionNo?: number;
  quotationRootDocNo?: string;
  supersededByDocId?: string;
};

function quotationBaseDocNo(doc: QuotationRevisionIdentity): string {
  return (doc.quotationRootDocNo || parseQuotationBaseDocNo(doc.docNo).baseDocNo).trim();
}

/** ฉบับที่ถูกแทนที่แล้วแก้ไม่ได้ — แก้ได้เฉพาะฉบับล่าสุดในชุดเดียวกัน */
export function isLatestQuotationRevision(
  doc: QuotationRevisionIdentity,
  siblings: QuotationRevisionIdentity[] = []
): boolean {
  if (doc.supersededByDocId) return false;
  const base = quotationBaseDocNo(doc);
  const rev = getQuotationRevisionNo(doc);
  for (const other of siblings) {
    if (other.id === doc.id) continue;
    if (quotationBaseDocNo(other) !== base) continue;
    if (getQuotationRevisionNo(other) > rev) return false;
  }
  return true;
}
