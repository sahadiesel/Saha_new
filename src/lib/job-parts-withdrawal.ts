import type { Job } from "@/lib/types";

export function jobHasLinkedQuotation(
  job: Pick<Job, "salesDocId" | "salesDocType">
): boolean {
  return job.salesDocType === "QUOTATION" && !!String(job.salesDocId || "").trim();
}

/** ใบเสนอราคาที่ผูกกับงานและไม่ใช่ฉบับร่าง */
export function jobQuotationIssued(
  job: Pick<Job, "salesDocId" | "salesDocType" | "salesDocStatus">
): boolean {
  if (!jobHasLinkedQuotation(job)) return false;
  const s = String(job.salesDocStatus ?? "").toUpperCase();
  return s !== "" && s !== "DRAFT";
}

/** ลูกค้าอนุมัติใบเสนอราคาแล้ว — หรืออยู่ระหว่างซ่อมหลังอนุมัติ (เบิกเพิ่ม) */
export function jobQuotationCustomerApproved(
  job: Pick<Job, "status" | "salesDocId" | "salesDocType" | "salesDocStatus">
): boolean {
  if (!jobQuotationIssued(job)) return false;
  const docSt = String(job.salesDocStatus ?? "").toUpperCase();
  if (job.status === "IN_REPAIR_PROCESS") return true;
  if (job.status === "PENDING_PARTS") {
    return docSt === "APPROVED" || docSt === "OFFERED";
  }
  return false;
}

export function canJobWithdrawParts(job: Job): boolean {
  return jobQuotationCustomerApproved(job);
}

export function jobWithdrawPartsBlockedReason(job: Job): string | null {
  if (!jobHasLinkedQuotation(job)) {
    return "ยังไม่มีใบเสนอราคา — ต้องออกใบเสนอราคา เสนอลูกค้า และรอลูกค้าอนุมัติก่อนเบิกอะไหล่";
  }
  const docSt = String(job.salesDocStatus ?? "").toUpperCase();
  if (!docSt || docSt === "DRAFT") {
    return "ใบเสนอราคายังเป็นฉบับร่าง — บันทึกฉบับจริง เสนอลูกค้า และรออนุมัติก่อนเบิกอะไหล่";
  }
  if (docSt === "FINAL") {
    return "ยังไม่ได้เสนอราคาให้ลูกค้า — กด «เสนอราคาลูกค้าแล้ว» และรอลูกค้าอนุมัติก่อนเบิกอะไหล่";
  }
  if (!jobQuotationCustomerApproved(job)) {
    return "ลูกค้ายังไม่อนุมัติใบเสนอราคา — ต้องรอลูกค้าอนุมัติก่อนเบิกอะไหล่";
  }
  return null;
}
