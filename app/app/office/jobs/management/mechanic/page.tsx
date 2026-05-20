
"use client";

import { PageHeader } from "@/components/page-header";
import { JobList } from "@/components/job-list";
import { JOB_STATUSES_EXCLUDED_FROM_DEPARTMENT_VIEW } from "@/lib/job-department-visibility";

export default function OfficeJobManagementMechanicPage() {
  return (
    <>
      <PageHeader title="จัดการงานซ่อม - แผนกปั๊มหัวฉีดแมคคานิค" description="งานทั้งหมดของแผนก Mechanic" />
      <JobList 
        department="MECHANIC" 
        excludeStatus={JOB_STATUSES_EXCLUDED_FROM_DEPARTMENT_VIEW}
        emptyTitle="ไม่มีงานในแผนกแมคคานิค"
        emptyDescription="ยังไม่มีการเปิดงานสำหรับแผนกนี้"
      />
    </>
  );
}
