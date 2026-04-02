
"use client";

import { useState, Suspense, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { JobList } from "@/components/job-list";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, Loader2 } from "lucide-react";
import type { JobDepartment, JobStatus } from "@/lib/types";

// Stable constant to prevent infinite loops in children
// ซ่อนงานที่ "รับสินค้าแล้ว/รอรับเงิน" ออกจากหน้าตามแผนก
const EXCLUDE_DEPT_VIEW: JobStatus[] = ["CLOSED", "PICKED_UP"];

const DEPT_TAB_TO_DEPARTMENT = {
  "car-service": "CAR_SERVICE",
  commonrail: "COMMONRAIL",
  mechanic: "MECHANIC",
  outsource: "OUTSOURCE",
} as const satisfies Record<string, JobDepartment>;

type DeptTab = keyof typeof DEPT_TAB_TO_DEPARTMENT;

const TAB_EMPTY: Record<DeptTab, { title: string; description: string }> = {
  "car-service": {
    title: "ไม่มีงานในแผนกซ่อมหน้าร้าน",
    description: "ยังไม่มีการเปิดงานสำหรับแผนกนี้",
  },
  commonrail: {
    title: "ไม่มีงานในแผนกคอมมอนเรล",
    description: "ยังไม่มีการเปิดงานสำหรับแผนกนี้",
  },
  mechanic: {
    title: "ไม่มีงานในแผนกแมคคานิค",
    description: "ยังไม่มีการเปิดงานสำหรับแผนกนี้",
  },
  outsource: {
    title: "ไม่มีงานที่ส่งออกร้านนอก",
    description: "ยังไม่มีการส่งต่องานสำหรับแผนกนี้",
  },
};

function normalizeDeptTab(raw: string | null): DeptTab {
  if (raw && raw in DEPT_TAB_TO_DEPARTMENT) return raw as DeptTab;
  return "car-service";
}

function ByDepartmentContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [searchTerm, setSearchTerm] = useState("");

  const deptQuery = searchParams.get("dept");
  const activeTab = useMemo(() => normalizeDeptTab(deptQuery), [deptQuery]);

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
                {/* JobList เดียว + key ตามแท็บ — หลีกเลี่ยงการ mount ซ้ำ/ช้าเมื่อ Radix Tabs + Suspense */}
                <div className="p-0">
                  <JobList
                    key={activeTab}
                    searchTerm={searchTerm}
                    department={DEPT_TAB_TO_DEPARTMENT[activeTab]}
                    excludeStatus={EXCLUDE_DEPT_VIEW}
                    emptyTitle={TAB_EMPTY[activeTab].title}
                    emptyDescription={TAB_EMPTY[activeTab].description}
                    sortByOldestInSystem
                    showSystemAgeBadge
                  />
                </div>
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
