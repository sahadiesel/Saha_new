
"use client";

import { PageHeader } from "@/components/page-header";
import { JobList } from "@/components/job-list";
import { JOB_STATUSES_EXCLUDED_FROM_DEPARTMENT_VIEW } from "@/lib/job-department-visibility";

export default function OfficeJobManagementOutsourcePage() {
  return (
    <>
      <PageHeader title="จัดการงานซ่อม - งานส่งออกร้านนอก" description="งานทั้งหมดที่ส่งออกไปให้ร้านนอก" />
      <JobList 
        department="OUTSOURCE" 
        excludeStatus={JOB_STATUSES_EXCLUDED_FROM_DEPARTMENT_VIEW}
        emptyTitle="ไม่มีงานที่ส่งออกร้านนอก"
        emptyDescription="ยังไม่มีการส่งต่องานสำหรับแผนกนี้"
      />
    </>
  );
}
