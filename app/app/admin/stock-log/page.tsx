"use client";

import { useState, useMemo } from "react";
import { collection, query, where, orderBy, limit, Timestamp, type Query } from "firebase/firestore";
import { useFirebase, useCollection } from "@/firebase";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, History, ClipboardList, TrendingUp, TrendingDown, ShoppingCart, User } from "lucide-react";
import { safeFormat, APP_DATE_TIME_FORMAT } from "@/lib/date-utils";
import type { StockActivity } from "@/lib/types";
import { cn } from "@/lib/utils";

const MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

const getActivityTypeStyles = (type: StockActivity['type']) => {
  switch (type) {
    case 'ADJUST_ADD': return { label: 'ปรับเพิ่ม', variant: 'secondary' as const, icon: TrendingUp, color: 'text-green-600' };
    case 'ADJUST_REMOVE': return { label: 'ปรับลด', variant: 'destructive' as const, icon: TrendingDown, color: 'text-destructive' };
    case 'PURCHASE': return { label: 'ซื้อเข้า', variant: 'default' as const, icon: ShoppingCart, color: 'text-primary' };
    case 'WITHDRAW': return { label: 'เบิกออก', variant: 'outline' as const, icon: ClipboardList, color: 'text-amber-600' };
    default: return { label: type, variant: 'outline' as const, icon: History, color: 'text-muted-foreground' };
  }
};

export default function StockLogPage() {
  const { db } = useFirebase();
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(() => now.getFullYear());
  const [month, setMonth] = useState(() => now.getMonth() + 1);
  const [searchTerm, setSearchTerm] = useState("");
  const years = useMemo(() => {
    const current = now.getFullYear();
    return Array.from({ length: 5 }, (_, i) => current - i);
  }, [now]);

  const logQuery = useMemo(() => {
    if (!db) return null;
    const start = Timestamp.fromDate(new Date(year, month - 1, 1));
    const end = Timestamp.fromDate(new Date(year, month, 1));
    return query(
      collection(db, "stockActivities"),
      where("createdAt", ">=", start),
      where("createdAt", "<", end),
      orderBy("createdAt", "desc"),
      limit(500)
    );
  }, [db, year, month]);

  const { data: logs, isLoading } = useCollection<StockActivity>(logQuery as Query<StockActivity> | null);

  const filteredLogs = useMemo(() => {
    if (!logs) return [];
    if (!searchTerm.trim()) return logs;
    const q = searchTerm.toLowerCase();
    return logs.filter(l => 
      l.partCode.toLowerCase().includes(q) || 
      l.partName.toLowerCase().includes(q) || 
      l.createdByName.toLowerCase().includes(q) ||
      l.notes.toLowerCase().includes(q)
    );
  }, [logs, searchTerm]);

  return (
    <div className="space-y-6 pb-20">
      <PageHeader title="Stock Activity Log" description="ประวัติการเคลื่อนไหวและการปรับปรุงจำนวนสินค้าในคลัง" />

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <CardTitle className="text-lg flex items-center gap-2 shrink-0">
              <History className="h-5 w-5 text-primary" />
              รายการความเคลื่อนไหวล่าสุด
            </CardTitle>
            <div className="flex gap-2">
              <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
                <SelectTrigger className="h-9 w-[108px]" aria-label="ปี">
                  <SelectValue placeholder="ปี" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((item) => (
                    <SelectItem key={item} value={String(item)}>{item}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={String(month)} onValueChange={(value) => setMonth(Number(value))}>
                <SelectTrigger className="h-9 w-[148px]" aria-label="เดือน">
                  <SelectValue placeholder="เดือน" />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((label, index) => (
                    <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="relative w-full xl:ml-auto xl:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="ค้นหารหัสอะไหล่, ชื่อสินค้า, หรือชื่อพนักงาน..." 
                className="pl-10"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-xl overflow-x-auto shadow-sm">
            <Table className="table-fixed min-w-[920px]">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-[108px]">วัน/เวลา</TableHead>
                  <TableHead className="w-[34%]">สินค้า (รหัส/ชื่อ)</TableHead>
                  <TableHead className="w-[132px]">ประเภท</TableHead>
                  <TableHead className="w-[88px] text-right">จำนวนเดิม</TableHead>
                  <TableHead className="w-[88px] text-right">ปรับปรุง</TableHead>
                  <TableHead className="w-[88px] text-right">ยอดใหม่</TableHead>
                  <TableHead>เหตุผล / ผู้ทำรายการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="h-32 text-center"><Loader2 className="animate-spin mx-auto text-primary" /></TableCell></TableRow>
                ) : filteredLogs.length > 0 ? (
                  filteredLogs.map(log => {
                    const style = getActivityTypeStyles(log.type);
                    const isAdd = log.type === 'ADJUST_ADD' || log.type === 'PURCHASE';
                    return (
                      <TableRow key={log.id} className="hover:bg-muted/30">
                        <TableCell className="text-[10px] text-muted-foreground">
                          {safeFormat(log.createdAt, APP_DATE_TIME_FORMAT)}
                        </TableCell>
                        <TableCell>
                          <p className="font-bold text-[11px] font-mono text-primary uppercase">{log.partCode}</p>
                          <p className="text-sm leading-snug line-clamp-2">{log.partName}</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant={style.variant} className="whitespace-nowrap text-[11px] px-2 h-6">
                            <style.icon className="mr-1 h-2.5 w-2.5" />
                            {style.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{log.beforeQty}</TableCell>
                        <TableCell className={cn("text-right font-bold text-sm", style.color)}>
                          {isAdd ? "+" : "-"}{log.diffQty}
                        </TableCell>
                        <TableCell className="text-right font-black text-sm">{log.afterQty}</TableCell>
                        <TableCell>
                          <p className="text-[11px] font-medium italic">"{log.notes || "-"}"</p>
                          <div className="flex items-center gap-1 text-[9px] text-muted-foreground mt-1">
                            <User className="h-2 w-2" />
                            {log.createdByName}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground italic">
                      ไม่พบความเคลื่อนไหวใน{MONTHS[month - 1]} {year}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
