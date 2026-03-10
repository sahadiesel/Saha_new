"use client";

import { PageHeader } from "@/components/page-header";
import { JobList } from "@/components/job-list";

export default function OfficeJobManagementWaitingPaymentPage() {
  return (
    <>
      <PageHeader title="จัดการงานซ่อม - รอรับเงิน" description="งานที่ส่งมอบให้ลูกค้าแล้ว และรอฝ่ายบัญชียืนยันรับเงิน" />
      <JobList 
        status="PICKED_UP"
        emptyTitle="ไม่มีงานที่รอรับเงิน"
        emptyDescription="ยังไม่มีงานที่อยู่ในสถานะ 'รับสินค้าแล้ว' (PICKED_UP) ในขณะนี้"
      />
    </>
  );
}