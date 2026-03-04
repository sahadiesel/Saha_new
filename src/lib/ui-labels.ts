export const DEPARTMENT_LABELS: Record<string, string> = {
    MANAGEMENT: "ฝ่ายบริหาร",
    OFFICE: "แผนกออฟฟิศ",
    CAR_SERVICE: "งานซ่อมหน้าร้าน",
    COMMONRAIL: "แผนกคอมมอนเรล",
    MECHANIC: "แผนกแมคคานิค",
    OUTSOURCE: "งานนอก",
    WEB_MANAGEMENT: "จัดการเว็บไซต์",
};

export const JOB_STATUS_LABELS: Record<string, string> = {
    RECEIVED: "รอช่างรับงาน",
    IN_PROGRESS: "กำลังตรวจสอบ",
    WAITING_QUOTATION: "รอเสนอราคา",
    WAITING_APPROVE: "รออนุมัติ",
    PENDING_PARTS: "กำลังจัดเตรียมอะไหล่",
    IN_REPAIR_PROCESS: "กำลังดำเนินการซ่อม",
    DONE: "ทำเสร็จรอทำบิล",
    WAITING_CUSTOMER_PICKUP: "รอลูกค้ารับสินค้า",
    CLOSED: "ปิดงาน",
};

export const DOC_TYPE_LABELS: Record<string, string> = {
    QUOTATION: "ใบเสนอราคา",
    DELIVERY_NOTE: "ใบส่งของชั่วคราว",
    TAX_INVOICE: "ใบกำกับภาษี",
    RECEIPT: "ใบเสร็จรับเงิน",
    BILLING_NOTE: "ใบวางบิล",
    CREDIT_NOTE: "ใบลดหนี้",
    WITHHOLDING_TAX: "หนังสือรับรองหัก ณ ที่จ่าย",
};

export const DOC_STATUS_LABELS: Record<string, string> = {
    DRAFT: 'ฉบับร่าง',
    PAID: 'รับเงินแล้ว',
    CANCELLED: 'ยกเลิก',
    WAITING_CUSTOMER_PICKUP: 'รอลูกค้ารับ',
    SUBMITTED: 'ส่งแล้ว',
    APPROVED: 'ตรวจสอบแล้ว (รอใบเสร็จ)',
    UNPAID: 'ยังไม่จ่าย (เครดิต)',
    PENDING_REVIEW: "รอบัญชีตรวจสอบ",
    REJECTED: "ตีกลับเพื่อแก้ไข",
    PARTIAL: "รับเงินบางส่วน",
};

export const PAY_TYPE_LABELS: Record<string, string> = {
    MONTHLY: "รายเดือน",
    DAILY: "รายวัน",
    MONTHLY_NOSCAN: "รายเดือน (ไม่ใช้สแกน)",
    NOPAY: "ไม่คิดเงินเดือน",
};

export const LEAVE_TYPE_LABELS: Record<string, string> = {
    SICK: "ลาป่วย",
    BUSINESS: "ลากิจ",
    VACATION: "ลาพักร้อน",
};

export const LEAVE_STATUS_LABELS: Record<string, string> = {
    SUBMITTED: "รออนุมัติ",
    APPROVED: "อนุมัติแล้ว",
    REJECTED: "ไม่อนุมัติ",
    CANCELLED: "ยกเลิก",
};

export const NEW_PAYSLIP_STATUS_LABELS: Record<string, string> = {
    DRAFT: "ฉบับร่าง",
    SENT_TO_EMPLOYEE: "ส่งให้พนักงานตรวจสอบ",
    REVISION_REQUESTED: "ร้องขอแก้ไข",
    READY_TO_PAY: "รอจ่ายเงิน",
    PAID: "จ่ายแล้ว"
};

export const VENDOR_TYPE_LABELS: Record<string, string> = {
    SUPPLIER: "ผู้จำหน่ายอะไหล่",
    GENERAL: "ร้านค้าทั่วไป",
    CONTRACTOR: "ผู้รับเหมา/งานนอก",
};

export const CASH_DRAWER_STATUS_LABELS: Record<string, string> = {
    OPEN: "กำลังใช้งานเงินสดหน้าร้าน",
    CLOSED: "ปิดรอบแล้ว (รอนำส่งเงินคืน)",
    LOCKED: "ตรวจสอบแล้ว (คืนเงินเรียบร้อย)",
};

export function cashDrawerStatusLabel(status: string | undefined): string {
    if (!status) return '';
    return CASH_DRAWER_STATUS_LABELS[status] || status;
}

export function vendorTypeLabel(type: string | undefined): string {
    if (!type) return '';
    return VENDOR_TYPE_LABELS[type] || type;
}

export function newPayslipStatusLabel(status: string | undefined): string {
    if (!status) return '';
    return NEW_PAYSLIP_STATUS_LABELS[status] || status;
}

export function deptLabel(dept: string | undefined): string {
    if (!dept) return '';
    return DEPARTMENT_LABELS[dept] || dept;
}

export function jobStatusLabel(status: string | undefined): string {
    if (!status) return '';
    return JOB_STATUS_LABELS[status] || status;
}

export function docTypeLabel(docType: string | undefined): string {
    if (!docType) return '';
    return DOC_TYPE_LABELS[docType] || docType;
}

export function docStatusLabel(status: string | undefined, docType?: string): string {
    if (!status) return '';
    const s = status.toUpperCase();
    return DOC_STATUS_LABELS[s] || status;
}

export function payTypeLabel(payType: string | undefined): string {
    if (!payType) return '';
    return PAY_TYPE_LABELS[payType] || payType;
}

export function leaveTypeLabel(type: string | undefined): string {
    if (!type) return '';
    return LEAVE_TYPE_LABELS[type] || type;
}

export function leaveStatusLabel(status: string | undefined): string {
    if (!status) return '';
    return LEAVE_STATUS_LABELS[status] || status;
}
