import type { JobStatus } from "@/lib/constants";

/**
 * งานที่ยังแสดงในมุมมองแผนก — ตั้งแต่มอบหมาย/เปิดงานจนก่อนแจ้งทำบิล (DONE)
 * รวมรอเสนอราคา, รอแจ้งลูกค้า, รออนุมัติ ฯลฯ
 */
export const JOB_STATUSES_IN_DEPARTMENT_VIEW: JobStatus[] = [
  "RECEIVED",
  "IN_PROGRESS",
  "WAITING_QUOTATION",
  "PENDING_CUSTOMER_INFORM",
  "WAITING_APPROVE",
  "PENDING_PARTS",
  "IN_REPAIR_PROCESS",
];

/** ซ่อนจากหน้าแผนกหลังแจ้งทำบิล / รอรับของ / ปิดงาน */
export const JOB_STATUSES_EXCLUDED_FROM_DEPARTMENT_VIEW: JobStatus[] = [
  "DONE",
  "WAITING_CUSTOMER_PICKUP",
  "PICKED_UP",
  "CLOSED",
];

/** งานของช่าง (มอบหมายแล้ว) — ไม่รวมคิว RECEIVED ที่ยังไม่รับ */
export const JOB_STATUSES_IN_WORKER_MY_JOBS: JobStatus[] = JOB_STATUSES_IN_DEPARTMENT_VIEW.filter(
  (s) => s !== "RECEIVED"
);
