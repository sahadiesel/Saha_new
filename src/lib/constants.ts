export const DEPARTMENTS = ["MANAGEMENT", "OFFICE", "PURCHASING", "ACCOUNTING_HR", "CAR_SERVICE", "COMMONRAIL", "MECHANIC", "OUTSOURCE", "WEB_MANAGEMENT"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const USER_ROLES = ["ADMIN", "MANAGER", "OFFICER", "PURCHASE", "WORKER", "VIEWER"] as const;
export type Role = (typeof USER_ROLES)[number];

export const USER_STATUSES = ["ACTIVE", "PENDING", "SUSPENDED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PAY_TYPES = ["MONTHLY", "DAILY", "MONTHLY_NOSCAN", "NOPAY"] as const;
export type PayType = (typeof PAY_TYPES)[number];

export const JOB_STATUSES = ["RECEIVED", "IN_PROGRESS", "WAITING_QUOTATION", "WAITING_APPROVE", "PENDING_PARTS", "IN_REPAIR_PROCESS", "DONE", "WAITING_CUSTOMER_PICKUP", "PICKED_UP", "CLOSED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_DEPARTMENTS = ["OFFICE", "CAR_SERVICE", "COMMONRAIL", "MECHANIC", "OUTSOURCE"] as const;
export type JobDepartment = (typeof JOB_DEPARTMENTS)[number];

export const LEAVE_TYPES = ["SICK", "BUSINESS", "VACATION"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_STATUSES = ["SUBMITTED", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const VENDOR_TYPES = ["SUPPLIER", "GENERAL", "CONTRACTOR"] as const;

export const PAYROLL_BATCH_STATUSES = ["DRAFT_HR", "SENT_TO_EMPLOYEE", "FINAL"] as const;
export type PayrollBatchStatus = (typeof PAYROLL_BATCH_STATUSES)[number];

export const PAYSLIP_STATUSES = ["DRAFT", "SENT_TO_EMPLOYEE", "REVISION_REQUESTED", "READY_TO_PAY", "PAID"] as const;
export type PayslipStatus = (typeof PAYSLIP_STATUSES)[number];

export const PAYSLIP_STATUS_NEW = ['DRAFT', 'SENT_TO_EMPLOYEE', 'REVISION_REQUESTED', 'READY_TO_PAY', 'PAID'] as const;
export type PayslipStatusNew = (typeof PAYSLIP_STATUS_NEW)[number];

export const TOKEN_TTL_MS = 30000; // 30 seconds
export const TOKEN_BUFFER_MS = 5000; // 5 seconds buffer

export const CASH_DRAWER_STATUSES = ["OPEN", "CLOSED", "LOCKED"] as const;
export type CashDrawerStatus = (typeof CASH_DRAWER_STATUSES)[number];

export const ACQUISITION_SOURCES = ["REFERRAL", "GOOGLE", "FACEBOOK", "TIKTOK", "YOUTUBE", "OTHER"] as const;
export type AcquisitionSource = (typeof ACQUISITION_SOURCES)[number];

export const ACCOUNTING_CATEGORIES = {
    INCOME: {
      "งานซ่อม": ["หน้าร้าน (CAR_SERVICE)", "คอมมอนเรล (COMMONRAIL)", "แมคคานิค (MECHANIC)"],
      "ขายสินค้า": ["ขายอะไหล่/สินค้า"],
      "งานแลกเปลี่ยน": ["DENSO Exchange"],
      "รายรับอื่นๆ": ["รายรับเบ็ดเตล็ด"],
      "เก็บเงินลูกหนี้": ["รับชำระยอดค้างเก่า (ยกมา)", "รับชำระตามบิลในระบบ"],
    },
    EXPENSE: {
      "ต้นทุนงาน": ["อะไหล่/วัสดุสิ้นเปลือง", "งานนอก/ซับคอนแทรก", "ค่าขนส่ง/ค่าส่งของ", "เคลม/ของเสีย/รับประกัน"],
      "ค่าแรง/เงินเดือน": ["เงินเดือน", "OT/ล่วงเวลา", "โบนัส/สวัสดิการ", "ประกันสังคม/กองทุน"],
      "ค่าสาธารณูปโภค/น้ำมันรถ": ["ค่าไฟฟ้า", "ค่าน้ำ/โทรศัพท์/อินเทอร์เน็ต", "น้ำมันรถ/เดินทาง", "ซ่อมบำรุงรถใช้งาน"],
      "เครื่องมือ/เครื่องใช้สำนักงาน": ["เครื่องมือช่าง", "ซ่อมบำรุง/คาลิเบรทเครื่องมือ", "วัสดุสำนักงาน/ปริ้น/กระดาษ/หมึก", "ซอฟต์แวร์/บริการออนไลน์"],
      "อื่นๆ/บริหาร": ["ค่าเช่า/สถานที่", "ค่าธรรมเนียมธนาคาร", "การตลาด/โฆษณา", "ภาษี/ค่าปรับ/ค่าธรรมเนียมราชการ", "เบ็ดเตล็ด"],
      "จ่ายเจ้าหนี้": ["จ่ายเจ้าหนี้ค้างเก่า (ยกมา)", "จ่ายเจ้าหนี้ตามบิลในระบบ"],
    },
} as const;

export type AccountingCategory = keyof typeof ACCOUNTING_CATEGORIES.INCOME | keyof typeof ACCOUNTING_CATEGORIES.EXPENSE;

// Data Integrity Limits
export const DATA_LIMITS = {
  MAX_INTAKE_PHOTOS: 4,
  MAX_ACTIVITY_PHOTOS: 10,
  MAX_ACTIVITY_LOGS: 50,
  MAX_DOC_ITEMS: 50,
  MAX_CUSTOMERS: 5000,
  MAX_VENDORS: 1000,
  MAX_DOCUMENTS: 10000,
  MAX_STRING_SHORT: 100,
  MAX_STRING_LONG: 1000,
  MAX_STRING_XLONG: 5000,
};