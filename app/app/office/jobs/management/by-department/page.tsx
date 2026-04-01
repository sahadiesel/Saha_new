
"use client";

import { useState, Suspense, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { JobList } from "@/components/job-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, Loader2 } from "lucide-react";
import type { JobStatus } from "@/lib/types";

// Stable constant to prevent infinite loops in children
// ซ่อนงานที่ "รับสินค้าแล้ว/รอรับเงิน" ออกจากหน้าตามแผนก
const EXCLUDE_DEPT_VIEW: JobStatus[] = ["CLOSED", "PICKED_UP"];

function ByDepartmentContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [searchTerm, setSearchTerm] = useState("");

  const activeTab = searchParams.get("dept") || "car-service";

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("dept", value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <>
      <PageHeader title="จัดการงานซ่อม - ตามแผนก" description="แสดงงานทั้งหมดที่ยังไม่ปิด แยกตามแผนกที่รับผิดชอบ" />
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
          <TabsList>
            <TabsTrigger value="car-service">งานซ่อมหน้าร้าน</TabsTrigger>
            <TabsTrigger value="commonrail">แผนกคอมมอนเรล</TabsTrigger>
            <TabsTrigger value="mechanic">แผนกแมคคานิค</TabsTrigger>
            <TabsTrigger value="outsource">งานส่งออกร้านนอก</TabsTrigger>
          </TabsList>
          <div className="relative w-full md:w-auto md:max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="ค้นหาชื่อ/เบอร์โทร..."
              className="pl-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        <Card>
            <CardContent className="p-0">
                <TabsContent value="car-service" className="mt-0">
                    {activeTab === 'car-service' && (
                        <JobList 
                            searchTerm={searchTerm}
                            department="CAR_SERVICE" 
                            excludeStatus={EXCLUDE_DEPT_VIEW}
                            emptyTitle="ไม่มีงานในแผนกซ่อมหน้าร้าน"
                            emptyDescription="ยังไม่มีการเปิดงานสำหรับแผนกนี้"
                            sortByOldestInSystem
                            showSystemAgeBadge
                        />
                    )}
                </TabsContent>
                <TabsContent value="commonrail" className="mt-0">
                    {activeTab === 'commonrail' && (
                        <JobList 
                            searchTerm={searchTerm}
                            department="COMMONRAIL" 
                            excludeStatus={EXCLUDE_DEPT_VIEW}
                            emptyTitle="ไม่มีงานในแผนกคอมมอนเรล"
                            emptyDescription="ยังไม่มีการเปิดงานสำหรับแผนกนี้"
                            sortByOldestInSystem
                            showSystemAgeBadge
                        />
                    )}
                </TabsContent>
                <TabsContent value="mechanic" className="mt-0">
                    {activeTab === 'mechanic' && (
                        <JobList 
                            searchTerm={searchTerm}
                            department="MECHANIC" 
                            excludeStatus={EXCLUDE_DEPT_VIEW}
                            emptyTitle="ไม่มีงานในแผนกแมคคานิค"
                            emptyDescription="ยังไม่มีการเปิดงานสำหรับแผนกนี้"
                            sortByOldestInSystem
                            showSystemAgeBadge
                        />
                    )}
                </TabsContent>
                <TabsContent value="outsource" className="mt-0">
                    {activeTab === 'outsource' && (
                        <JobList 
                            searchTerm={searchTerm}
                            department="OUTSOURCE" 
                            excludeStatus={EXCLUDE_DEPT_VIEW}
                            emptyTitle="ไม่มีงานที่ส่งออกร้านนอก"
                            emptyDescription="ยังไม่มีการส่งต่องานสำหรับแผนกนี้"
                            sortByOldestInSystem
                            showSystemAgeBadge
                        />
                    )}
                </TabsContent>
            </CardContent>
        </Card>
      </Tabs>
    </>
  );
}

export default function OfficeJobManagementByDepartmentPage() {
  return (
    <Suspense fallback={<div className="flex justify-center p-12"><Loader2 className="animate-spin h-8 w-8" /></div>}>
      <ByDepartmentContent />
    </Suspense>
  );
}
