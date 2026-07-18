import type { Job, JobStatus } from "@/lib/types";
import {
  jobHasLinkedQuotation,
  jobQuotationCustomerApproved,
  jobQuotationIssued,
} from "@/lib/job-parts-withdrawal";

export type WithdrawalLike = { status?: string };

export function jobHasActiveWithdrawals(
  withdrawals: WithdrawalLike[],
  job?: Pick<Job, "hasPartsWithdrawal">
): boolean {
  const fromDocs = withdrawals.some(
    (w) => String(w.status ?? "").toUpperCase() !== "CANCELLED"
  );
  if (fromDocs) return true;
  return job?.hasPartsWithdrawal === true;
}

/** ลูกค้าอนุมัติแล้ว — พร้อมขั้นตอนเบิกอะไหล่ */
export function jobCustomerApprovedForParts(
  job: Pick<Job, "status" | "salesDocId" | "salesDocType" | "salesDocStatus">
): boolean {
  if (!jobQuotationIssued(job)) return false;
  if (String(job.salesDocStatus ?? "").toUpperCase() === "APPROVED") return true;
  return jobQuotationCustomerApproved(job);
}

/**
 * สถานะที่เหมาะสมหลังแผนกย่อยส่งกลับแผนกหลัก — ไม่ข้ามขั้น (เสนอราคา → อนุมัติ → เบิกอะไหล่ → ซ่อม)
 */
export function resolveJobStatusAfterSubReturn(
  job: Pick<
    Job,
    | "status"
    | "salesDocId"
    | "salesDocType"
    | "salesDocStatus"
    | "subHandoffStatusSnapshot"
    | "hasPartsWithdrawal"
    | "partsWithdrawalWaived"
  >,
  withdrawals: WithdrawalLike[]
): JobStatus {
  const snapshot = job.subHandoffStatusSnapshot;
  const partsOk = jobPartsStepSatisfied(job, withdrawals);

  if (!jobHasLinkedQuotation(job)) {
    if (snapshot === "WAITING_QUOTATION") return "WAITING_QUOTATION";
    return "IN_PROGRESS";
  }
  if (!jobQuotationIssued(job)) return "WAITING_QUOTATION";
  if (!jobCustomerApprovedForParts(job)) {
    if (
      job.status === "WAITING_APPROVE" ||
      job.status === "PENDING_CUSTOMER_INFORM"
    ) {
      return job.status;
    }
    if (snapshot === "WAITING_APPROVE" || snapshot === "PENDING_CUSTOMER_INFORM") {
      return snapshot;
    }
    return "WAITING_APPROVE";
  }
  if (!partsOk) return "PENDING_PARTS";
  return "IN_REPAIR_PROCESS";
}

/** หลังส่งงานข้ามแผนก — คงขั้นตอนเดิม ไม่กระโดดไปซ่อม */
export function statusAfterSubDepartmentHandoff(current: JobStatus): JobStatus {
  if (current !== "RECEIVED") return current;
  return "IN_PROGRESS";
}

export function jobPartsStepSatisfied(
  job: Pick<Job, "hasPartsWithdrawal" | "partsWithdrawalWaived">,
  withdrawals: WithdrawalLike[]
): boolean {
  if (job.partsWithdrawalWaived) return true;
  return jobHasActiveWithdrawals(withdrawals, job);
}

export function jobFinishForBillingBlockedReason(
  job: Pick<
    Job,
    | "status"
    | "salesDocId"
    | "salesDocType"
    | "salesDocStatus"
    | "hasPartsWithdrawal"
    | "partsWithdrawalWaived"
  >,
  withdrawals: WithdrawalLike[]
): string | null {
  if (job.status !== "IN_REPAIR_PROCESS") return null;
  if (!jobCustomerApprovedForParts(job)) {
    return "ยังไม่ผ่านขั้นตอนลูกค้าอนุมัติ — ต้องเสนอราคาและรออนุมัติก่อนจบงาน";
  }
  if (!jobPartsStepSatisfied(job, withdrawals)) {
    return "ยังไม่มีการเบิกอะไหล่ — ต้องเบิกอะไหล่และดำเนินการซ่อมก่อนแจ้งทำบิล (หรือเลือกไม่ต้องเบิกอะไหล่)";
  }
  return null;
}

export function canJobFinishForBilling(
  job: Pick<
    Job,
    | "status"
    | "salesDocId"
    | "salesDocType"
    | "salesDocStatus"
    | "hasPartsWithdrawal"
    | "partsWithdrawalWaived"
  >,
  withdrawals: WithdrawalLike[]
): boolean {
  return jobFinishForBillingBlockedReason(job, withdrawals) === null;
}

export function jobRequestMorePartsBlockedReason(
  job: Pick<
    Job,
    | "status"
    | "salesDocId"
    | "salesDocType"
    | "salesDocStatus"
    | "hasPartsWithdrawal"
    | "partsWithdrawalWaived"
  >,
  withdrawals: WithdrawalLike[]
): string | null {
  if (job.status !== "IN_REPAIR_PROCESS") return null;
  if (!jobCustomerApprovedForParts(job)) {
    return "ต้องมีใบเสนอราคาที่ลูกค้าอนุมัติแล้วก่อนแจ้งเบิกอะไหล่เพิ่ม";
  }
  if (!jobPartsStepSatisfied(job, withdrawals)) {
    return "ต้องเบิกอะไหล่ครั้งแรกก่อนแจ้งเบิกเพิ่ม (หรือเลือกไม่ต้องเบิกอะไหล่)";
  }
  return null;
}

export function jobPartsReadyBlockedReason(
  job: Pick<
    Job,
    | "status"
    | "salesDocId"
    | "salesDocType"
    | "salesDocStatus"
    | "hasPartsWithdrawal"
    | "partsWithdrawalWaived"
  >,
  withdrawals: WithdrawalLike[]
): string | null {
  if (job.status !== "PENDING_PARTS") return null;
  if (!jobCustomerApprovedForParts(job)) {
    return "ต้องรอลูกค้าอนุมัติก่อนเริ่มขั้นตอนอะไหล่";
  }
  if (!jobHasActiveWithdrawals(withdrawals, job)) {
    return "ต้องมีใบเบิกอะไหล่ก่อนแจ้งว่าอะไหล่มาครบ (หรือเลือกไม่ต้องเบิกอะไหล่)";
  }
  return null;
}

export function canJobSkipPartsWithdrawal(
  job: Pick<
    Job,
    | "status"
    | "salesDocId"
    | "salesDocType"
    | "salesDocStatus"
    | "hasPartsWithdrawal"
    | "partsWithdrawalWaived"
  >,
  withdrawals: WithdrawalLike[] = []
): boolean {
  return jobNeedsInitialPartsAction(job, withdrawals);
}

/** งานอนุมัติแล้วแต่ยังไม่เบิก/ไม่ได้ข้ามขั้นตอนเบิก — ต้องมีปุ่มเบิกหรือไม่เบิก */
export function jobNeedsInitialPartsAction(
  job: Pick<
    Job,
    | "status"
    | "salesDocId"
    | "salesDocType"
    | "salesDocStatus"
    | "hasPartsWithdrawal"
    | "partsWithdrawalWaived"
  >,
  withdrawals: WithdrawalLike[] = []
): boolean {
  if (job.status !== "PENDING_PARTS" && job.status !== "IN_REPAIR_PROCESS") {
    return false;
  }
  if (!jobCustomerApprovedForParts(job)) return false;
  return !jobPartsStepSatisfied(job, withdrawals);
}

/** มีใบเบิกแล้วแต่ยังรอจัดอะไหล่เพิ่ม — ต้องไปหน้าเบิก/แก้ไขใบเบิก */
export function jobNeedsAdditionalPartsWithdrawal(
  job: Pick<
    Job,
    | "status"
    | "salesDocId"
    | "salesDocType"
    | "salesDocStatus"
    | "hasPartsWithdrawal"
    | "partsWithdrawalWaived"
  >,
  withdrawals: WithdrawalLike[] = []
): boolean {
  if (job.status !== "PENDING_PARTS") return false;
  if (!jobCustomerApprovedForParts(job)) return false;
  return jobPartsStepSatisfied(job, withdrawals);
}
