
"use client";

import { PageHeader } from "@/components/page-header";
import { JobList } from "@/components/job-list";
import { JOB_STATUSES_EXCLUDED_FROM_DEPARTMENT_VIEW } from "@/lib/job-department-visibility";

export default function OfficeJobManagementCommonrailPage() {
  return (
    <>
      <PageHeader title="จัดการงานซ่อม - แผนกปั๊มหัวฉีดคอมมอนเรล" description="งานทั้งหมดของแผนก Commonrail" />
      <JobList 
        department="COMMONRAIL" 
        excludeStatus={JOB_STATUSES_EXCLUDED_FROM_DEPARTMENT_VIEW}
        emptyTitle="ไม่มีงานในแผนกคอมมอนเรล"
        emptyDescription="ยังไม่มีการเปิดงานสำหรับแผนกนี้"
      />
    </>
  );
}
