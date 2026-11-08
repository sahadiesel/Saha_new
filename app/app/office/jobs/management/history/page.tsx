"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { JobTableList } from "@/components/job-table-list";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search } from "lucide-react";

const THAI_MONTHS = [
  { value: 0, label: "ทุกเดือน" },
  { value: 1, label: "มกราคม" },
  { value: 2, label: "กุมภาพันธ์" },
  { value: 3, label: "มีนาคม" },
  { value: 4, label: "เมษายน" },
  { value: 5, label: "พฤษภาคม" },
  { value: 6, label: "มิถุนายน" },
  { value: 7, label: "กรกฎาคม" },
  { value: 8, label: "สิงหาคม" },
  { value: 9, label: "กันยายน" },
  { value: 10, label: "ตุลาคม" },
  { value: 11, label: "พฤศจิกายน" },
  { value: 12, label: "ธันวาคม" },
] as const;

export default function OfficeJobManagementHistoryPage() {
  const currentYear = new Date().getFullYear();
  const [searchTerm, setSearchTerm] = useState("");
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(0);

  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = currentYear; y >= currentYear - 5; y -= 1) years.push(y);
    return years;
  }, [currentYear]);

  return (
    <>
      <PageHeader title="จัดการงานซ่อม - ประวัติงานซ่อม" description="งานที่ปิดไปแล้วทั้งหมด">
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-full sm:w-[120px] bg-background/50">
              <SelectValue placeholder="ปี" />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  ปี {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-full sm:w-[140px] bg-background/50">
              <SelectValue placeholder="เดือน" />
            </SelectTrigger>
            <SelectContent>
              {THAI_MONTHS.map((m) => (
                <SelectItem key={m.value} value={String(m.value)}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="ค้นหาชื่อ/เบอร์โทร/เลขที่จ๊อบ..."
              className="pl-9 w-full sm:w-[300px] bg-background/50"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </PageHeader>
      <JobTableList
        searchTerm={searchTerm}
        status="CLOSED"
        source="archive"
        year={year}
        month={month}
        dense
        limit={20}
        orderByField="lastActivityAt"
        orderByDirection="desc"
        emptyTitle="ไม่พบประวัติงานซ่อม"
        emptyDescription="ยังไม่มีรายการงานที่ถูกปิดในระบบ หรือไม่พบข้อมูลที่ตรงกับการค้นหา"
      />
    </>
  );
}
