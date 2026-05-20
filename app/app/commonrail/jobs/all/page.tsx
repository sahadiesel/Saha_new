"use client";

import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { JobList } from "@/components/job-list";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Filter } from "lucide-react";
import { jobStatusLabel } from "@/lib/ui-labels";
import type { JobStatus } from "@/lib/types";
import { JOB_STATUSES_IN_DEPARTMENT_VIEW } from "@/lib/job-department-visibility";

export default function CommonrailAllJobsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  return (
    <>
      <PageHeader title="งานทั้งหมด" description="งานใหม่และงานที่กำลังทำทั้งหมดในแผนก Commonrail">
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
            <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                    placeholder="ค้นหาชื่อ/ทะเบียน/อะไหล่..." 
                    className="pl-8 h-9" 
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
                    <SelectItem value="ALL">งานที่กำลังทำทั้งหมด</SelectItem>
                    {JOB_STATUSES_IN_DEPARTMENT_VIEW.map(s => (
                        <SelectItem key={s} value={s}>{jobStatusLabel(s)}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
      </PageHeader>
      <JobList 
        department="COMMONRAIL" 
        status={statusFilter === "ALL" ? JOB_STATUSES_IN_DEPARTMENT_VIEW : (statusFilter as JobStatus)} 
        searchTerm={searchTerm}
      />
    </>
  );
}
