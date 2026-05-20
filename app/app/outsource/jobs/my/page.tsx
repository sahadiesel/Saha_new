"use client";

import { PageHeader } from "@/components/page-header";
import { JobList } from "@/components/job-list";
import { useAuth } from "@/context/auth-context";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { JOB_STATUSES_IN_WORKER_MY_JOBS } from "@/lib/job-department-visibility";

export default function OutsourceMyJobsPage() {
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

  // Determine which ID to use for filtering. 
  // If this user is linked to a specific shop (vendor), use that shop's ID.
  // Otherwise, use the user's personal UID.
  const assigneeUid = profile.linkedVendorId || profile.uid;

  return (
    <>
      <PageHeader 
        title="งานของฉัน (งานนอก)" 
        description={profile.linkedVendorName ? `รายการงานที่มอบหมายให้ร้าน: ${profile.linkedVendorName}` : "งานที่ส่งออกร้านนอกที่คุณเป็นผู้ดูแลรับผิดชอบ"} 
      />
      <JobList 
        department="OUTSOURCE" 
        status={JOB_STATUSES_IN_WORKER_MY_JOBS}
        assigneeUid={assigneeUid}
        emptyTitle="ยังไม่มีงานที่มอบหมายให้ท่าน"
        emptyDescription={profile.linkedVendorName ? `ขณะนี้ยังไม่มีงานใหม่ที่มอบหมายให้ร้าน ${profile.linkedVendorName} ค่ะ` : "ไปที่หน้า 'งานทั้งหมด' เพื่อรับงานใหม่ (หากมีสิทธิ์)"}
      />
    </>
  );
}
