"use client";

import { PageHeader } from "@/components/page-header";
import { JobList } from "@/components/job-list";
import { useAuth } from "@/context/auth-context";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { JOB_STATUSES_IN_WORKER_MY_JOBS } from "@/lib/job-department-visibility";

export default function CarServiceMyJobsPage() {
  const { profile, loading } = useAuth();

  if (loading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="animate-spin h-8 w-8" /></div>;
  }
  
  if (!profile) {
     return (
        <Card className="text-center py-12">
            <CardHeader>
                <CardTitle>ไม่สามารถโหลดข้อมูลผู้ใช้ได้</CardTitle>
                <CardDescription>กรุณาลองเข้าสู่ระบบใหม่อีกครั้ง</CardDescription>
            </CardHeader>
        </Card>
     );
  }

  return (
    <>
      <PageHeader title="งานของฉัน" description="งานที่อยู่ในความรับผิดชอบของคุณ" />
      <JobList 
        department="CAR_SERVICE" 
        status={JOB_STATUSES_IN_WORKER_MY_JOBS}
        assigneeUid={profile.uid}
        emptyTitle="คุณยังไม่มีงานที่กำลังทำ"
        emptyDescription="ไปที่หน้า 'งานทั้งหมด' เพื่อรับงานใหม่"
      />
    </>
  );
}
