/** พารามิเตอร์สำหรับปุ่มกลับจากหน้าเอกสาร */
export const DOC_RETURN_FROM_JOB = "job" as const;
export const DOC_RETURN_FROM_INBOX = "inbox" as const;
export const DOC_RETURN_FROM_JOBS_BY_STATUS = "jobs-by-status" as const;

export function documentReturnQueryFromJob(jobId: string): string {
  const id = String(jobId || "").trim();
  if (!id) return "";
  return `?from=${DOC_RETURN_FROM_JOB}&jobId=${encodeURIComponent(id)}`;
}

export function appendDocumentReturnQuery(href: string, returnQuery: string): string {
  if (!returnQuery) return href;
  const q = returnQuery.startsWith("?") ? returnQuery.slice(1) : returnQuery;
  return href.includes("?") ? `${href}&${q}` : `${href}?${q}`;
}

type SearchParamsLike = { get(name: string): string | null };

export function documentListHrefForType(docType?: string): string {
  switch (docType) {
    case "QUOTATION":
      return "/app/office/documents/quotation";
    case "DELIVERY_NOTE":
      return "/app/office/documents/delivery-note";
    case "TAX_INVOICE":
      return "/app/office/documents/tax-invoice";
    case "BILLING_NOTE":
      return "/app/management/accounting/documents/billing-note";
    case "RECEIPT":
      return "/app/management/accounting/documents/receipt";
    case "CREDIT_NOTE":
      return "/app/management/accounting/documents/credit-note";
    case "DEBIT_NOTE":
      return "/app/management/accounting/documents/debit-note";
    case "WITHHOLDING_TAX":
      return "/app/management/accounting/documents/withholding-tax";
    case "WITHDRAWAL":
      return "/app/office/parts/withdraw";
    default:
      return "/app/jobs";
  }
}

/** หาเส้นทางปุ่มกลับจาก query string และประเภทเอกสาร */
export function resolveDocumentBackHref(
  searchParams: SearchParamsLike,
  docType?: string
): string {
  const from = searchParams.get("from");
  const jobId = searchParams.get("jobId");

  if (from === DOC_RETURN_FROM_JOB && jobId) {
    return `/app/jobs/${jobId}`;
  }

  if (from === DOC_RETURN_FROM_INBOX) {
    return `/app/management/accounting/inbox?tab=${searchParams.get("tab") || "receive"}`;
  }

  if (from === DOC_RETURN_FROM_JOBS_BY_STATUS) {
    const tab = searchParams.get("tab") || searchParams.get("status");
    return `/app/office/jobs/management/by-status?status=${tab || "waiting-approve"}`;
  }

  return documentListHrefForType(docType);
}
