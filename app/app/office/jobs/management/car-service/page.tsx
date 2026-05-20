
"use client";

import { PageHeader } from "@/components/page-header";
import { JobList } from "@/components/job-list";
import { JOB_STATUSES_EXCLUDED_FROM_DEPARTMENT_VIEW } from "@/lib/job-department-visibility";

export default function OfficeJobManagementCarServicePage() {
  return (
    <>
      <PageHeader title="จัดการงานซ่อม - งานซ่อมหน้าร้าน" description="งานทั้งหมดของแผนก Car Service" />
      <JobList 
        department="CAR_SERVICE" 
        excludeStatus={JOB_STATUSES_EXCLUDED_FROM_DEPARTMENT_VIEW}
        emptyTitle="ไม่มีงานในแผนกซ่อมหน้าร้าน"
        emptyDescription="ยังไม่มีการเปิดงานสำหรับแผนกนี้"
      />
    </>
  );
}
