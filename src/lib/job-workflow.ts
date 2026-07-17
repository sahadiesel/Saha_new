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
  >,
  withdrawals: WithdrawalLike[]
): JobStatus {
  const snapshot = job.subHandoffStatusSnapshot;
  const hasWd = jobHasActiveWithdrawals(withdrawals, job);

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
  if (!hasWd) return "PENDING_PARTS";
  return "IN_REPAIR_PROCESS";
}

/** หลังส่งงานข้ามแผนก — คงขั้นตอนเดิม ไม่กระโดดไปซ่อม */
export function statusAfterSubDepartmentHandoff(current: JobStatus): JobStatus {
  if (current !== "RECEIVED") return current;
  return "IN_PROGRESS";
}

export function jobFinishForBillingBlockedReason(
  job: Pick<
    Job,
    "status" | "salesDocId" | "salesDocType" | "salesDocStatus" | "hasPartsWithdrawal"
  >,
  withdrawals: WithdrawalLike[]
): string | null {
  if (job.status !== "IN_REPAIR_PROCESS") return null;
  if (!jobCustomerApprovedForParts(job)) {
    return "ยังไม่ผ่านขั้นตอนลูกค้าอนุมัติ — ต้องเสนอราคาและรออนุมัติก่อนจบงาน";
  }
  if (!jobHasActiveWithdrawals(withdrawals, job)) {
    return "ยังไม่มีการเบิกอะไหล่ — ต้องเบิกอะไหล่และดำเนินการซ่อมก่อนแจ้งทำบิล";
  }
  return null;
}

export function canJobFinishForBilling(
  job: Pick<
    Job,
    "status" | "salesDocId" | "salesDocType" | "salesDocStatus" | "hasPartsWithdrawal"
  >,
  withdrawals: WithdrawalLike[]
): boolean {
  return jobFinishForBillingBlockedReason(job, withdrawals) === null;
}

export function jobRequestMorePartsBlockedReason(
  job: Pick<
    Job,
    "status" | "salesDocId" | "salesDocType" | "salesDocStatus" | "hasPartsWithdrawal"
  >,
  withdrawals: WithdrawalLike[]
): string | null {
  if (job.status !== "IN_REPAIR_PROCESS") return null;
  if (!jobCustomerApprovedForParts(job)) {
    return "ต้องมีใบเสนอราคาที่ลูกค้าอนุมัติแล้วก่อนแจ้งเบิกอะไหล่เพิ่ม";
  }
  if (!jobHasActiveWithdrawals(withdrawals, job)) {
    return "ต้องเบิกอะไหล่ครั้งแรกก่อนแจ้งเบิกเพิ่ม";
  }
  return null;
}

export function jobPartsReadyBlockedReason(
  job: Pick<
    Job,
    "status" | "salesDocId" | "salesDocType" | "salesDocStatus" | "hasPartsWithdrawal"
  >,
  withdrawals: WithdrawalLike[]
): string | null {
  if (job.status !== "PENDING_PARTS") return null;
  if (!jobCustomerApprovedForParts(job)) {
    return "ต้องรอลูกค้าอนุมัติก่อนเริ่มขั้นตอนอะไหล่";
  }
  if (!jobHasActiveWithdrawals(withdrawals, job)) {
    return "ต้องมีใบเบิกอะไหล่ก่อนแจ้งว่าอะไหล่มาครบ";
  }
  return null;
}
