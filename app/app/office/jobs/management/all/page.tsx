"use client";

import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { JobTableList } from "@/components/job-table-list";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Filter } from "lucide-react";
import { jobStatusLabel } from "@/lib/ui-labels";
import { JOB_STATUSES } from "@/lib/constants";
import type { JobStatus } from "@/lib/types";

export default function OfficeAllJobsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  return (
    <>
      <PageHeader title="จัดการงานซ่อม - งานทั้งหมด" description="แสดงรายการงานซ่อมที่กำลังดำเนินการทั้งหมดทุกแผนก">
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
            <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="ค้นหาชื่อ/ทะเบียน/อะไหล่..."
                    className="pl-9 h-9 bg-background/50"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-48 h-9">
                    <div className="flex items-center gap-2">
                        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                        <SelectValue placeholder="ทุกสถานะ" />
                    </div>
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="ALL">งานที่ยังไม่ปิดทั้งหมด</SelectItem>
                    {JOB_STATUSES.filter(s => s !== 'CLOSED').map(s => (
                        <SelectItem key={s} value={s}>{jobStatusLabel(s as JobStatus)}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
      </PageHeader>
      <JobTableList 
        searchTerm={searchTerm}
        status={statusFilter === "ALL" ? undefined : (statusFilter as JobStatus)}
        excludeStatus={statusFilter === "ALL" ? "CLOSED" : undefined}
        limit={500}
        orderByField="lastActivityAt"
        orderByDirection="desc"
        emptyTitle="ไม่พบรายการงาน"
        emptyDescription="ไม่มีงานที่กำลังดำเนินการในระบบที่ตรงตามเงื่อนไข"
        showVehicleColumns
      />
    </>
  );
}
