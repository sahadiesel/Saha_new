import type { Document, Job } from "@/lib/types";
import { jobHasLinkedQuotation, jobQuotationIssued } from "@/lib/job-parts-withdrawal";

/** งานมีใบเสนอราคาฉบับจริงแล้ว — พร้อมขั้นตอนแจ้งลูกค้า */
export function jobCanInformCustomerOfQuotation(
  job: Pick<Job, "status" | "salesDocId" | "salesDocType" | "salesDocStatus">,
  options?: {
    draftQuotationByJobId?: Record<string, string>;
    relatedQuotations?: Document[];
  }
): boolean {
  const docId = resolveJobQuotationEditId(job, options);
  if (!docId) return false;

  const issuedOnJob = jobQuotationIssued(job);
  const issuedInRelated = !!options?.relatedQuotations?.some(
    (q) => q.id === docId && q.status === "FINAL"
  );
  const issued = issuedOnJob || issuedInRelated;
  if (!issued) return false;

  return job.status === "PENDING_CUSTOMER_INFORM" || job.status === "WAITING_QUOTATION";
}

/** id เอกสารใบเสนอราคาที่ใช้เปิดหน้าแจ้งลูกค้า */
export function jobQuotationInformDocId(
  job: Pick<Job, "id" | "salesDocId" | "salesDocType" | "salesDocStatus">,
  options?: {
    draftQuotationByJobId?: Record<string, string>;
    relatedQuotations?: Document[];
  }
): string | null {
  if (!jobCanInformCustomerOfQuotation(job, options)) return null;
  return resolveJobQuotationEditId(job, options);
}

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
