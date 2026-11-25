import type { Document, Job } from "@/lib/types";

export function isSalesBillDocType(docType: string | undefined): boolean {
  return docType === "DELIVERY_NOTE" || docType === "TAX_INVOICE";
}

export function jobHasSalesBillFields(
  job: Pick<Job, "salesDocId" | "salesDocType"> | null | undefined
): boolean {
  return !!job?.salesDocId && isSalesBillDocType(job.salesDocType);
}

function addIdentityKey(keys: Set<string>, value: unknown) {
  const s = String(value ?? "").trim();
  if (s) keys.add(s);
}

export function jobCustomerIdentityKeys(
  job: Pick<Job, "customerId" | "customerSnapshot"> | null | undefined
): Set<string> {
  const keys = new Set<string>();
  if (!job) return keys;
  addIdentityKey(keys, job.customerId);
  addIdentityKey(keys, job.customerSnapshot?.id);
  addIdentityKey(keys, job.customerSnapshot?.phone);
  return keys;
}

export function documentCustomerIdentityKeys(
  doc: Pick<Document, "customerId" | "customerSnapshot"> | null | undefined
): Set<string> {
  const keys = new Set<string>();
  if (!doc) return keys;
  addIdentityKey(keys, doc.customerId);
  addIdentityKey(keys, doc.customerSnapshot?.id);
  addIdentityKey(keys, doc.customerSnapshot?.phone);
  addIdentityKey(keys, doc.customerSnapshot?.taxPhone);
  return keys;
}

export function documentMatchesJobCustomer(
  doc: Pick<Document, "customerId" | "customerSnapshot"> | null | undefined,
  job: Pick<Job, "customerId" | "customerSnapshot"> | null | undefined
): boolean {
  const jobKeys = jobCustomerIdentityKeys(job);
  const docKeys = documentCustomerIdentityKeys(doc);
  if (jobKeys.size === 0 || docKeys.size === 0) return true;
  for (const k of docKeys) {
    if (jobKeys.has(k)) return true;
  }
  return false;
}

export function isLiveSalesBillOnJob(
  doc: Pick<Document, "docType" | "status" | "jobId" | "customerId" | "customerSnapshot"> | null | undefined,
  job: Pick<Job, "id" | "customerId" | "customerSnapshot"> | null | undefined
): boolean {
  if (!doc || !job) return false;
  if (!isSalesBillDocType(doc.docType)) return false;
  if (String(doc.status ?? "").toUpperCase() === "CANCELLED") return false;
  if (doc.jobId && job.id && doc.jobId !== job.id) return false;
  return documentMatchesJobCustomer(doc, job);
}

export function jobHasLiveSalesBill(
  job: Pick<Job, "id" | "customerId" | "customerSnapshot"> | null | undefined,
  related: Partial<Record<"DELIVERY_NOTE" | "TAX_INVOICE", Array<Pick<Document, "docType" | "status" | "jobId" | "customerId" | "customerSnapshot">>>>
): boolean {
  if (!job) return false;
  const dns = related.DELIVERY_NOTE || [];
  const tis = related.TAX_INVOICE || [];
  return dns.some((d) => isLiveSalesBillOnJob(d, job)) || tis.some((d) => isLiveSalesBillOnJob(d, job));
}

/** DONE ไม่ควรยังชี้บิลขาย — ถ้ามี มักเป็นลิงก์ค้างจากบิลที่ย้ายไปลูกค้าอื่น */
export function jobDoneWithStaleSalesBillFields(
  job: Pick<Job, "status" | "salesDocId" | "salesDocType"> | null | undefined
): boolean {
  return String(job?.status ?? "").toUpperCase() === "DONE" && jobHasSalesBillFields(job);
}
