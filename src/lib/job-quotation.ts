import type { Document, Job } from "@/lib/types";

/** หา id ใบเสนอราคาที่ควรเปิดแก้ไข (ฉบับร่างหรือที่ผูกกับงานแล้ว) */
export function resolveJobQuotationEditId(
  job: Pick<Job, "id" | "salesDocId" | "salesDocType" | "salesDocStatus">,
  options?: {
    draftQuotationByJobId?: Record<string, string>;
    relatedQuotations?: Document[];
  }
): string | null {
  if (job.salesDocId && job.salesDocType === "QUOTATION" && job.salesDocStatus !== "CANCELLED") {
    return job.salesDocId;
  }

  const fromMap = options?.draftQuotationByJobId?.[job.id];
  if (fromMap) return fromMap;

  const quotations = options?.relatedQuotations;
  if (quotations?.length) {
    const draft = quotations.find((q) => q.status === "DRAFT");
    if (draft) return draft.id;
    const active = quotations.find((q) => q.status !== "CANCELLED" && q.status !== "REJECTED");
    if (active) return active.id;
  }

  return null;
}

export function jobHasEditableQuotation(
  job: Pick<Job, "id" | "salesDocId" | "salesDocType" | "salesDocStatus">,
  options?: {
    draftQuotationByJobId?: Record<string, string>;
    relatedQuotations?: Document[];
  }
): boolean {
  return !!resolveJobQuotationEditId(job, options);
}
