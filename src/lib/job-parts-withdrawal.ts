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
  return s !== "DRAFT";
}

/**
 * ลูกค้าอนุมัติแล้ว — งานอยู่ PENDING_PARTS / IN_REPAIR_PROCESS ถือว่าผ่านขั้นอนุมัติแล้ว
 * (รองรับข้อมูลเก่าที่ salesDocStatus ยังเป็น FINAL ไม่ใช่ APPROVED)
 */
export function jobQuotationCustomerApproved(
  job: Pick<Job, "status" | "salesDocId" | "salesDocType" | "salesDocStatus">
): boolean {
  if (!jobQuotationIssued(job)) return false;
  return job.status === "IN_REPAIR_PROCESS" || job.status === "PENDING_PARTS";
}

export function canJobWithdrawParts(job: Job): boolean {
  return jobQuotationCustomerApproved(job);
}

export function jobWithdrawPartsBlockedReason(job: Job): string | null {
  if (!jobHasLinkedQuotation(job)) {
    return "ยังไม่มีใบเสนอราคา — ต้องออกใบเสนอราคา เสนอลูกค้า และรอลูกค้าอนุมัติก่อนเบิกอะไหล่";
  }
  const docSt = String(job.salesDocStatus ?? "").toUpperCase();
  if (docSt === "DRAFT") {
    return "ใบเสนอราคายังเป็นฉบับร่าง — บันทึกฉบับจริง เสนอลูกค้า และรออนุมัติก่อนเบิกอะไหล่";
  }
  if (job.status !== "PENDING_PARTS" && job.status !== "IN_REPAIR_PROCESS") {
    return "งานยังไม่อยู่ในขั้นตอนรอจัดอะไหล่ — ต้องรอลูกค้าอนุมัติก่อนเบิกอะไหล่";
  }
  return null;
}
