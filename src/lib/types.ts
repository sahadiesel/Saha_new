
import type { Timestamp } from 'firebase/firestore';
import type { JobStatus, JobDepartment, Role, UserStatus, Department, LeaveType, LeaveStatus, PayrollBatchStatus, PayslipStatus, AccountingCategory, PayType, PayslipStatusNew, VENDOR_TYPES, AcquisitionSource } from './constants';

/** Re-export ชนิดจาก constants ให้ import จาก `@/lib/types` ได้ (ลด error TS2459) */
export type {
  JobStatus,
  JobDepartment,
  Role,
  UserStatus,
  Department,
  LeaveType,
  LeaveStatus,
  PayrollBatchStatus,
  PayslipStatus,
  AccountingCategory,
  PayType,
  PayslipStatusNew,
  AcquisitionSource,
} from './constants';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  phone: string;
  role: Role;
  department?: Department;
  status: UserStatus;
  linkedVendorId?: string | null; // For OUTSOURCE department users to link to a shop
  linkedVendorName?: string | null;
  personal?: {
    idCardNo?: string;
    address?: string;
    bank?: {
      bankName?: string;
      accountName?: string;
      accountNo?: string;
    };
    emergencyContact?: {
      name?: string;
      relationship?: string;
      phone?: string;
    };
  };
  hr?: {
    salaryMonthly?: number;
    salaryDaily?: number;
    payType?: PayType;
    ssoHospital?: string;
    note?: string;
    startDate?: string; // YYYY-MM-DD
    endDate?: string | null; // YYYY-MM-DD
    ssoRegistered?: boolean; // New field to check if SSO should be deducted
  };
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  lastAttendance?: {
    type: 'IN' | 'OUT';
    timestamp: Timestamp;
  };
  lastAttendanceDateKey?: string; // YYYY-MM-DD
}

/** นาม/ที่อยู่/เลขผู้เสียภาษีหนึ่งชุด — ลูกค้าคนเดียวอาจมีหลายโปรไฟล์ (หลายบริษัท/สาขา) */
export interface CustomerTaxProfile {
  id: string;
  /** ป้ายสั้นๆ เช่น สำนักงานใหญ่, สาขาชลบุรี */
  label?: string;
  taxName: string;
  taxAddress: string;
  taxId: string;
  taxPhone?: string;
  taxBranchType?: "HEAD_OFFICE" | "BRANCH";
  taxBranchNo?: string;
}

export interface Customer {
  id: string;
  name: string;
  /** เบอร์หลัก (ควรตรงกับ phones[0] เมื่อมี phones) — ใช้ query/แสดงผลแบบเดิม */
  phone: string;
  /** เบอร์ทั้งหมดของผู้ติดต่อ — ถ้าไม่มีให้ถือว่ามีแค่ phone */
  phones?: string[];
  detail: string;
  useTax: boolean;
  /** หลายชุดสำหรับออกใบกำกับ — ถ้าไม่มีให้อ่านจาก taxName/taxAddress/... แบบเดิม */
  taxProfiles?: CustomerTaxProfile[];
  taxName?: string;
  taxAddress?: string;
  taxId?: string;
  taxPhone?: string;
  taxBranchType?: "HEAD_OFFICE" | "BRANCH";
  taxBranchNo?: string;
  /** ระบุเมื่อ snapshot บนเอกสารว่าใช้โปรไฟล์ไหน */
  taxProfileId?: string;
  acquisitionSource?: AcquisitionSource;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type VendorType = (typeof VENDOR_TYPES)[number];

export interface Vendor {
    id: string;
    shortName: string;
    companyName: string;
    vendorType: VendorType;
    address?: string;
    phone?: string;
    contactName?: string;
    contactPhone?: string;
    email?: string;
    taxId?: string;
    notes?: string;
    isActive: boolean;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

export interface OutsourceVendor {
  id: string;
  shopName: string;
  contactName?: string;
  phone?: string;
  location?: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Job {
  id: string;
  /** เลขที่ใบงานอ่านง่าย (เช่น SJ2026-0001) — คนละค่ากับรหัสเอกสาร Firestore */
  jobNo?: string;
  customerId: string;
  customerSnapshot: {
    name: string;
    phone: string;
    useTax?: boolean;
    taxName?: string;
    taxAddress?: string;
    taxId?: string;
    taxPhone?: string;
    taxBranchType?: 'HEAD_OFFICE' | 'BRANCH';
    taxBranchNo?: string;
  };
  department: JobDepartment;
  mainDepartment?: JobDepartment; // Added to track owner department
  status: JobStatus;
  description: string;
  officeNote?: string;
  photos: string[];
  technicalReport?: string;
  assigneeUid?: string;
  assigneeName?: string;
  pickupDate?: string; // YYYY-MM-DD
  closedDate?: string; // YYYY-MM-DD
  salesDocType?: 'DELIVERY_NOTE' | 'TAX_INVOICE';
  salesDocId?: string;
  salesDocNo?: string;
  salesDocStatus?: string; // TRACKS: DRAFT, PENDING_REVIEW, APPROVED, PAID
  paymentStatusAtClose?: 'PAID' | 'UNPAID';
  carServiceDetails?: {
    brand?: string;
    model?: string;
    licensePlate?: string;
  };
  commonrailDetails?: {
    brand?: string;
    partNumber?: string;
    registrationNumber?: string;
  };
  mechanicDetails?: {
    brand?: string;
    partNumber?: string;
    registrationNumber?: string;
  };
  customerType: 'NEW' | 'EXISTING';
  customerAcquisitionSource: AcquisitionSource | 'EXISTING';
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastActivityAt: Timestamp;
  // Archive fields
  isArchived?: boolean;
  archivedAt?: Timestamp;
  archivedAtDate?: string; // YYYY-MM-DD
  closedByName?: string;
  closedByUid?: string;
  originalJobId?: string;
}

export interface JobActivity {
  id?: string;
  text: string;
  userName: string;
  userId: string;
  createdAt: Timestamp;
  photos?: string[];
}

export interface Attendance {
  id: string;
  userId: string;
  userName: string;
  type: 'IN' | 'OUT';
  timestamp: Timestamp;
}

export interface KioskToken {
  id: string;
  createdAtMs: number;
  expiresAtMs: number;
  isActive: boolean;
}

export interface LeaveTypePolicy {
  annualEntitlement?: number;
  overLimitHandling?: {
    mode?: 'DEDUCT_SALARY' | 'UNPAID' | 'DISALLOW';
    salaryDeductionBaseDays?: number;
  };
}

export interface HRSettings {
  id?: 'hr';
  workStart?: string;
  workEnd?: string;
  breakStart?: string;
  breakEnd?: string;
  graceMinutes?: number;
  absentCutoffTime?: string;
  afternoonCutoffTime?: string;
  minSecondsBetweenScans?: number;
  weekendPolicy?: {
    mode?: 'SAT_SUN' | 'SUN_ONLY';
  };
  payroll?: {
    payday1?: number;
    payday2?: string;
    period1Start?: number;
    period1End?: number;
    period2Start?: number;
    period2End?: string;
    salaryDeductionBaseDays?: number;
  };
  sso?: {
    employeePercent?: number;
    employerPercent?: number;
    monthlyMinBase?: number;
    monthlyCap?: number;
    effectiveFrom?: Timestamp;
  };
  withholding?: {
    enabled?: boolean;
    defaultPercent?: number;
    note?: string;
  };
  leavePolicy?: {
    calculationPeriod?: 'CALENDAR_YEAR';
    leaveTypes?: {
      SICK?: LeaveTypePolicy;
      BUSINESS?: LeaveTypePolicy;
      VACATION?: LeaveTypePolicy;
    };
  };
  backfillMode?: boolean;
}

export interface HRHoliday {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  createdAt: Timestamp;
}

export interface SSOHospital {
  id: string;
  name: string;
  address?: string;
  emergencyContact?: string;
  createdAt: Timestamp;
}

export interface LeaveRequest {
  id: string;
  userId: string;
  userName: string;
  leaveType: LeaveType;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  days: number;
  reason: string;
  status: LeaveStatus;
  year: number;
  isHalfDay?: boolean;
  halfDaySession?: 'MORNING' | 'AFTERNOON';
  approvedByName?: string;
  approvedAt?: Timestamp;
  rejectedByName?: string;
  rejectedAt?: Timestamp;
  rejectReason?: string;
  overLimit?: boolean;
  /** URL รูปเอกสารแนบจาก Storage (พนักงานอัปโหลดได้สูงสุด 2 รูปต่อใบลา) */
  attachmentUrls?: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AttendanceAdjustment {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  type: 'ADD_RECORD' | 'FORGIVE_LATE';
  adjustedIn?: Timestamp;
  adjustedOut?: Timestamp;
  notes: string;
  updatedBy: string; // User's name
  updatedById: string; // User's UID
  updatedAt: Timestamp;
}

export interface PayrollBatch {
  id: string;
  year: number;
  month: number;
  periodNo: 1 | 2;
  createdAt: Timestamp;
  createdByUid: string;
  createdByName: string;
  statusSummary?: {
    draftCount: number;
    sentCount: number;
    requestedCount: number;
    readyCount: number;
    paidCount: number;
  };
  ssoDecision?: {
    employeePercent: number;
    monthlyMinBase: number;
    monthlyCap: number;
    decidedAt: Timestamp;
    decidedByUid: string;
    decidedByName: string;
    source: 'AUTO_LOCK' | 'HR_OVERRIDE';
    note?: string;
  };
  ssoDecisionHash?: string;
}

export interface PayslipDeduction {
    name: string;
    amount: number;
    notes?: string;
}

export interface PayslipAddition {
    name: string;
    amount: number;
    notes?: string;
}

export interface AttendanceDayLog {
    date: string;
    type: 'LATE' | 'ABSENT' | 'LEAVE';
    detail: string;
}

export interface PayslipSnapshot {
    basePay: number;
    netPay: number;
    additions: { name: string; amount: number; notes?: string; }[];
    deductions: { name: string; amount: number; notes?: string; }[];
    attendanceSummary: {
        presentDays?: number;
        lateDays?: number;
        absentUnits?: number;
        leaveDays?: number;
        lateMinutes?: number;
        scheduledWorkDays?: number;
        payableUnits?: number;
        warnings?: string[];
        dayLogs?: AttendanceDayLog[];
    };
    leaveSummary: {
        sickDays?: number;
        businessDays?: number;
        vacationDays?: number;
        overLimitDays?: number;
    };
    attendanceSummaryYtd?: {
      presentDays?: number;
      lateDays?: number;
      absentUnits?: number;
      leaveDays?: number;
      lateMinutes?: number;
      payableUnits?: number;
      scheduledWorkDays?: number;
      warnings?: string[];
    };
    leaveSummaryYtd?: {
      sickDays?: number;
      businessDays?: number;
      vacationDays?: number;
      overLimitDays?: number;
    };
    calcNotes?: string;
}

export interface PayslipNew {
    id: string; // Should be userId
    batchId: string;
    userId: string;
    userName: string;
    status: PayslipStatusNew;
    revisionNo: number;
    snapshot: PayslipSnapshot;
    hrNote?: string | null;
    employeeNote?: string | null;
    sentAt?: Timestamp;
    lockedAt?: Timestamp;
    employeeAcceptedAt?: Timestamp;
    paidAt?: Timestamp;
    paidByUid?: string;
    paidByName?: string;
    accountId?: string;
    paymentMethod?: 'CASH' | 'TRANSFER';
    accountingEntryId?: string;
}

export interface Payslip {
  id: string; // This will be userId
  payrollBatchId: string;
  userId: string;
  userName: string;
  status: PayslipStatus;
  revisionNo: number;
  snapshot: PayslipSnapshot;

  hrNote?: string;
  employeeNote?: string;
  sentAt?: Timestamp;
  employeeAcceptedAt?: Timestamp | null;
  lockedAt?: Timestamp | null;

  // Payment details
  paidAt?: Timestamp;
  paidBy?: string; // UID
  accountId?: string;
  method?: 'CASH' | 'TRANSFER';
  accountingEntryId?: string;
}

export interface StoreSettings {
  id?: 'store';
  taxName?: string;
  taxAddress?: string;
  branch?: string;
  phone?: string;
  taxId?: string;
  informalName?: string;
  openingHours?: string;
}

export interface DocumentSettings {
  id?: 'documents';
  /** Prefix for auto job numbers (e.g. SJ → SJ2026-0001) */
  jobPrefix?: string;
  quotationPrefix?: string;
  deliveryNotePrefix?: string;
  taxInvoicePrefix?: string;
  receiptPrefix?: string;
  billingNotePrefix?: string;
  creditNotePrefix?: string;
  debitNotePrefix?: string;
  withholdingTaxPrefix?: string;
  purchasePrefix?: string;
  withdrawalPrefix?: string; // Prefix for part withdrawals
}

export interface DocumentItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  partId?: string;
  code?: string;
  stockSnapshot?: number;
  /** จำนวนที่คืนเข้าสต็อกแล้วจากบรรทัดนี้ (ใบเบิก — ยกเลิกบางส่วน) */
  returnedToStockQty?: number;
}

export type DocType = 'QUOTATION' | 'DELIVERY_NOTE' | 'TAX_INVOICE' | 'RECEIPT' | 'BILLING_NOTE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'WITHHOLDING_TAX' | 'WITHDRAWAL';

export interface Document {
  id: string;
  docType: DocType;
  docNo: string;
  docDate: string; // YYYY-MM-DD
  customerId?: string;
  jobId?: string;
  /** ใบเบิกจากงานซ่อม: เลขที่ใบเสนอราคาอ้างอิง (แสดงในรายการแทนรหัสงานดิบ) */
  quotationDocNo?: string;
  customerSnapshot: Partial<Customer>;
  carSnapshot?: {
    licensePlate?: string;
    brand?: string;
    model?: string;
    partNumber?: string;
    registrationNumber?: string;
    details?: string;
  };
  storeSnapshot: Partial<StoreSettings>;
  items: DocumentItem[];
  subtotal: number;
  discountAmount: number;
  net: number; // subtotal - discount
  withTax: boolean;
  vatAmount: number;
  grandTotal: number;
  notes?: string;
  status: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  
  // Rejection fields
  reviewRejectReason?: string;
  reviewRejectedAt?: Timestamp;
  reviewRejectedByName?: string;

  // AR Fields
  paymentTerms?: 'CASH' | 'CREDIT';
  billingRequired?: boolean;
  /** ใบส่งของ: ฝ่ายบัญชียืนยันรับเงินสด/โอน (แท็บรอตรวจสอบ) ก่อน — แยก flow กับตั้งลูกหนี้ (แท็บเครดิต) */
  deliveryInboxCashConfirmed?: boolean;
  deliveryInboxCashConfirmedAt?: Timestamp;
  arObligationId?: string;
  arStatus?: 'PENDING' | 'UNPAID' | 'PARTIAL' | 'PAID' | 'DISPUTED';
  receiptStatus?: 'ISSUED_NOT_CONFIRMED' | 'CONFIRMED';
  receiptDocId?: string;
  receiptDocNo?: string;
  accountingEntryId?: string;
  billingRunId?: string; // Links a BILLING_NOTE to its generation batch
  /** ใบวางบิล: เลื่อนไปแสดงในเดือนรันนี้ (YYYY-MM) — ไม่แสดงในเดือนที่ docDate จนกว่าจะถึงเดือนนี้ */
  billingDeferUntilMonth?: string;
  dispute?: {
    isDisputed: boolean;
    reason?: string;
    createdAt?: Timestamp;
  };
  
  // Doc-specific fields
  expiryDate?: string; // For Quotation
  dueDate?: string; // For TaxInvoice
  paymentMethod?: string; // For Receipt (legacy / display)
  /** วิธีรับชำระตอนออกใบเสร็จ — ถ้า CHECK ให้ใช้ร่วมกับ accountingCheckItems */
  paymentInstrument?: 'CASH' | 'TRANSFER' | 'CHECK';
  /** วันที่เช็คครบกำหนด (เงินเข้าตามดิว) เมื่อ paymentInstrument === 'CHECK' */
  checkDueDate?: string;
  paymentDate?: string; // For Receipt
  receivedAccountId?: string;
  cashReceived?: number;
  withholdingEnabled?: boolean;
  withholdingAmount?: number;
  referencesDocIds?: string[]; // For CreditNote and Receipt
  reason?: string; // For CreditNote
  invoiceIds?: string[]; // For BillingNote
  totalAmount?: number; // For BillingNote

  // Suggested values for Accounting Inbox
  suggestedPaymentMethod?: 'CASH' | 'TRANSFER';
  suggestedAccountId?: string;
  suggestedPayments?: {
    method: 'CASH' | 'TRANSFER';
    accountId: string;
    amount: number;
  }[];

  /** ใบเบิกอะไหล่จากงานซ่อม: บันทึกว่าเบิกบางส่วนหรือครบ (กำหนดการเปลี่ยนสถานะงาน) */
  jobWithdrawalCompletion?: 'PARTIAL' | 'COMPLETE';

  delivery?: {
    deliveredDate?: string; // YYYY-MM-DD
    deliveredByName?: string;
    receivedByName?: string;
    note?: string;
  };
  paymentSummary?: {
    paidTotal: number;
    balance: number;
    paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID';
  };
  confirmedPayment?: {
    accountId: string;
    method: string;
    receivedDate: string;
    netReceivedTotal: number;
    withholdingTotal: number;
    arPaymentId: string;
  };

  /** ลายเซ็น / ผู้ออกเอกสาร (ใบวางบิล ฯลฯ) */
  senderName?: string;
  receiverName?: string;

  /** หนังสือรับรองหัก ณ ที่จ่าย (WITHHOLDING_TAX) */
  payerSnapshot?: Partial<StoreSettings> & { companyName?: string; name?: string; address?: string };
  payeeSnapshot?: { name?: string; companyName?: string; taxId?: string; address?: string };
  incomeTypeCode?: string;
  pndSequenceNo?: string;
  paidMonth?: number;
  paidYear?: number;
  paidAmountGross?: number;
  paidAmountNet?: number;
  withholdingPercent?: number;
}

export interface QuotationTemplate {
  id: string;
  name: string;
  items: DocumentItem[];
  notes?: string;
  discountAmount: number;
  withTax: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdByUid: string;
  createdByName: string;
}

export interface DocumentCounters {
  year: number;
  quotation?: number;
  quotationPrefix?: string;
  deliveryNote?: number;
  deliveryNotePrefix?: string;
  taxInvoice?: number;
  taxInvoicePrefix?: string;
  receipt?: number;
  receiptPrefix?: string;
  billingNote?: number;
  billingNotePrefix?: string;
  creditNote?: number;
  creditNotePrefix?: string;
  debitNote?: number;
  debitNotePrefix?: string;
  withholdingTax?: number;
  withholdingTaxPrefix?: string;
  purchase?: number;
  purchasePrefix?: string;
  withdrawal?: number;
  withdrawalPrefix?: string;
  [key: string]: any;
}

export interface AccountingAccount {
  id: string;
  name: string;
  type: 'CASH' | 'BANK';
  bankName?: string;
  accountNo?: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  openingBalance?: number;
  openingBalanceDate?: string; // YYYY-MM-DD
  openingBalanceSetByUid?: string;
  openingBalanceSetAt?: Timestamp;
}

export interface AccountingEntry {
  id: string;
  entryType: 'RECEIPT' | 'CASH_IN' | 'CASH_OUT';
  entryDate: string; // YYYY-MM-DD
  amount: number;
  accountId: string;
  createdAt: Timestamp;
  // --- Fields for RECEIPT ---
  sourceDocType?: DocType;
  sourceDocId?: string;
  sourceDocNo?: string;
  referenceInvoiceId?: string;
  customerNameSnapshot?: string;
  jobId?: string;
  // --- Fields for CASH_IN/CASH_OUT ---
  /** คู่รายการโอนระหว่างบัญชี (กราฟ/รายรับ-จ่ายเชิงดำเนินงานจะไม่นับ) */
  transferRefId?: string;
  description?: string;
  category?: AccountingCategory; // Legacy field
  categoryMain?: string; // New field
  categorySub?: string; // New field
  paymentMethod?: 'CASH' | 'TRANSFER' | 'CREDIT';
  vendorId?: string;
  vendorShortNameSnapshot?: string;
  vendorNameSnapshot?: string;
  counterpartyNameSnapshot?: string; // For one-off individuals not in vendors

  // Tax and Bill fields (Updated for detailed CASH_OUT support)
  billType?: 'NO_BILL' | 'NO_TAX_INVOICE' | 'TAX_INVOICE';
  vatRate?: 0 | 7 | number;
  vatAmount?: number;
  netAmount?: number; // amount - vatAmount
  grossAmount?: number; // amount including tax/wht
  withholdingEnabled?: boolean;
  withholdingPercent?: 1 | 3 | number;
  withholdingAmount?: number;
  withholdingTaxDocId?: string; // Link to WITHHOLDING_TAX Document
}

/** เช็ครับ / เช็คจ่าย — ยังไม่ตัดบัญชีจนกว่าจะยืนยันในแท็บเช็ค */
export type AccountingCheckDirection = 'RECEIVE' | 'PAY';
export type AccountingCheckStatus = 'PENDING' | 'CLEARED' | 'CANCELLED';

export interface AccountingCheckItem {
  id: string;
  direction: AccountingCheckDirection;
  status: AccountingCheckStatus;
  amount: number;
  /** วันครบกำหนดเช็ค (เงินเข้า/ออกตามดิว) */
  dueDate: string;
  /** บัญชีที่รับเช็คเข้า / บัญชีที่สั่งจ่ายเช็ค */
  accountId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdByUid?: string;
  createdByName?: string;
  /** เช็ครับ — ใบเสร็จรับเงิน (ซ้ำกับ receiveAnchor เมื่อ anchor = RECEIPT) */
  receiptId?: string;
  receiptDocNo?: string;
  /** อ้างอิงเอกสารขาย — ใช้ระบุเอกสารต้นทางของเช็ครับ */
  receiveAnchorDocType?: 'RECEIPT' | 'DELIVERY_NOTE' | 'BILLING_NOTE' | 'TAX_INVOICE';
  receiveAnchorDocId?: string;
  receiveAnchorDocNo?: string;
  customerNameSnapshot?: string;
  jobId?: string;
  referenceInvoiceId?: string;
  /** เช็คจ่าย — บิลซื้อ / เจ้าหนี้ */
  purchaseDocId?: string;
  obligationId?: string;
  sourceDocType?: AccountingObligation['sourceDocType'];
  sourceDocId?: string;
  sourceDocNo?: string;
  vendorId?: string;
  vendorNameSnapshot?: string;
  withholdingEnabled?: boolean;
  withholdingPercent?: number;
  withholdingAmount?: number;
  /** วันที่ยืนยันรับ/จ่ายจริง (ตัดบัญชี) */
  clearedAt?: Timestamp;
  clearedByUid?: string;
  clearedByName?: string;
  clearedEntryId?: string;
  /** วันที่รับ/จ่ายจริงที่ใช้ในรายการบัญชี */
  clearedDate?: string;
  notes?: string;
}

export interface ARPayment {
  id: string;
  receiptId: string;
  customerId: string;
  paymentDate: string;
  netReceivedTotal: number;
  withholdingTotal: number;
  allocations: {
    invoiceId: string;
    invoiceDocNo: string;
    netCashApplied: number;
    withholdingAmount: number;
    grossApplied: number;
    /** แถวนี้คิดหัก ณ ที่จ่ายตาม % ด้านบนหรือไม่ */
    withholdingApplied?: boolean;
  }[];
  createdAt: Timestamp;
}

export interface PaymentClaim {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: Timestamp;
  createdByUid: string;
  createdByName: string;
  jobId?: string;
  sourceDocType: 'DELIVERY_NOTE' | 'TAX_INVOICE' | 'RECEIPT';
  sourceDocId: string;
  sourceDocNo: string;
  customerNameSnapshot?: string;
  amountDue: number;
  suggestedPaymentMethod?: 'CASH' | 'TRANSFER' | 'CREDIT';
  suggestedAccountId?: string;
  note?: string;
  
  // Fields for approval
  approvedAt?: Timestamp;
  approvedByUid?: string;
  approvedByName?: string;
  amountReceived?: number;
  receivedDate?: string; // YYYY-MM-DD
  paymentMethod?: 'CASH' | 'TRANSFER';
  accountId?: string;
  withholdingEnabled?: boolean;
  withholdingAmount?: number;
  cashReceived?: number;
  docSyncedAt?: Timestamp;

  // Fields for rejection
  rejectedAt?: Timestamp;
  rejectedByUid?: string;
  rejectedByName?: string;
  rejectReason?: string;
}

export interface AccountingObligation {
  id: string;
  type: 'AR' | 'AP';
  status: 'UNPAID' | 'PARTIAL' | 'PAID';
  sourceDocType:
    | 'DELIVERY_NOTE'
    | 'TAX_INVOICE'
    | 'DEBIT_NOTE'
    | 'CREDIT_NOTE'
    | 'BILLING_NOTE'
    | 'PURCHASE_ORDER'
    | 'BILL'
    | 'PURCHASE'
    | 'WITHDRAWAL';
  sourceDocId: string;
  sourceDocNo: string;
  amountTotal: number;
  amountPaid: number;
  balance: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  dueDate?: string; // YYYY-MM-DD
  lastPaymentDate?: string; // YYYY-MM-DD
  paidOffDate?: string; // YYYY-MM-DD
  /** วันที่เอกสารต้นทาง (ใบกำกับ ฯลฯ) YYYY-MM-DD */
  docDate?: string;
  note?: string;
  jobId?: string;
  /** สำหรับลิงก์ออกใบเสร็จจากหน้าลูกหนี้ */
  customerId?: string;
  customerNameSnapshot?: string;
  customerPhoneSnapshot?: string;
  vendorId?: string;
  vendorShortNameSnapshot?: string;
  vendorNameSnapshot?: string;
  invoiceNo?: string;
}

export interface PurchaseDocItem {
  partId?: string;
  code?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface PurchaseDoc {
  id: string;
  docNo: string;
  docDate: string; // YYYY-MM-DD
  vendorId: string;
  vendorSnapshot: {
    shortName: string;
    companyName: string;
    taxId?: string;
    address?: string;
  };
  invoiceNo: string;
  items: PurchaseDocItem[];
  subtotal: number;
  discountAmount: number;
  net: number;
  withTax: boolean;
  vatAmount: number;
  grandTotal: number;
  paymentMode: 'CASH' | 'CREDIT';
  dueDate?: string | null;
  status: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'UNPAID' | 'PAID' | 'CANCELLED';
  createdAt: Timestamp;
  updatedAt: Timestamp;
  submittedAt?: Timestamp;
  approvedAt?: Timestamp;
  approvedByUid?: string;
  approvedByName?: string;
  accountingEntryId?: string;
  apObligationId?: string;
  note?: string;
  billPhotos?: string[];
  /** แยกรายการซื้องานบริการ (ไม่ตัดสต็อก) กับซื้ออะไหล่ */
  purchaseType?: 'SERVICE' | 'PARTS';
  isReceived?: boolean;
  suggestedAccountId?: string;
  suggestedPaymentMethod?: 'CASH' | 'TRANSFER';
}

export interface PurchaseClaim {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: Timestamp;
  createdByUid: string;
  createdByName: string;
  purchaseDocId: string;
  purchaseDocNo: string;
  vendorNameSnapshot: string;
  invoiceNo: string;
  paymentMode: 'CASH' | 'CREDIT';
  amountTotal: number;
  suggestedAccountId?: string;
  suggestedPaymentMethod?: 'CASH' | 'TRANSFER';
  note?: string;
  approvedAt?: Timestamp;
  approvedByUid?: string;
  approvedByName?: string;
  rejectReason?: string;
  updatedAt?: Timestamp;
}

export interface BillingRun {
  id?: string; // YYYY-MM
  monthId: string; // YYYY-MM
  /** bucketId ของแถวที่ถูกรวม -> bucketId หัวกลุ่ม (รวมด้วยมือในหน้าวางบิล) */
  billingMergedBuckets?: Record<string, string>;
  deferredInvoices?: Record<string, boolean>;
  separateInvoiceGroups?: Record<string, string>;
  createdBillingNotes?: Record<string, { main?: string; separate?: Record<string, string> }>;
  updatedAt?: Timestamp;
  updatedByUid?: string;
  updatedByName?: string;
}

export interface CashDrawerSession {
  id: string;
  status: 'OPEN' | 'CLOSED' | 'LOCKED';
  openedAt: Timestamp;
  openedByUid: string;
  openedByName: string;
  openingAmount: number;
  expectedAmount: number;
  countedAmount?: number;
  difference?: number;
  closedAt?: Timestamp;
  closedByUid?: string;
  closedByName?: string;
  lockedAt?: Timestamp;
  lockedByUid?: string;
  lockedByName?: string;
  notes?: string;
}

export interface CashDrawerTransaction {
  id: string;
  sessionId: string;
  type: 'IN' | 'OUT';
  amount: number;
  category: string;
  description: string;
  photos?: string[];
  createdAt: Timestamp;
  createdByUid: string;
  createdByName: string;
}

export interface GenAISettings {
  id?: 'ai';
  geminiApiKey?: string;
  updatedAt?: Timestamp;
  updatedByUid?: string;
  updatedByName?: string;
}

export interface CarRepairExperience {
  id: string;
  brand: string;
  model: string;
  symptoms: string;
  solution: string;
  createdAt: Timestamp;
  createdByUid: string;
  createdByName: string;
}

export interface CarRepairManual {
  id: string;
  name: string;
  url: string;
  sourceType: 'UPLOAD' | 'GDRIVE';
  brand?: string;
  fileSize?: number;
  createdAt: Timestamp;
  createdByUid: string;
  createdByName: string;
}

export interface PartCategory {
  id: string;
  name: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PartLocation {
  id: string;
  name: string;
  zone: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Part {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  categoryNameSnapshot: string;
  vendorId: string;
  vendorNameSnapshot: string;
  costPrice: number;
  sellingPrice: number;
  stockQty: number;
  minStock?: number; // New: Minimum stock threshold
  isOrderRequired?: boolean; // NEW: Flag to track if ordering is necessary when stock is low
  details?: string; // New: Additional details
  location?: string;
  imageUrl?: string;
  showOnWeb?: boolean; // NEW: Flag to show on public site
  
  // WEB SPECIFIC FIELDS
  webPrice?: number; // Special web price
  webPriceOld?: number; // Previous price for crossed-out display
  isSpecialPrice?: boolean; // Flag for special pricing
  webPromoNote?: string; // Promotions like "Free item"
  webDetails?: string; // Detailed product description for web
  bulkPriceQty?: number; // Bulk threshold
  bulkPrice?: number; // Price per unit when bulk condition met
  
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdByUid: string;
  createdByName: string;
}

export interface StockActivity {
  id: string;
  partId: string;
  partCode: string;
  partName: string;
  type: 'ADJUST_ADD' | 'ADJUST_REMOVE' | 'PURCHASE' | 'WITHDRAW';
  diffQty: number;
  beforeQty: number;
  afterQty: number;
  notes: string;
  createdByUid: string;
  createdByName: string;
  createdAt: Timestamp;
}
