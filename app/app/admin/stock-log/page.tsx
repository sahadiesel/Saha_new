"use client";

import { useState, useMemo } from "react";
import { collection, query, orderBy, limit, type Query } from "firebase/firestore";
import { useFirebase, useCollection } from "@/firebase";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, Search, History, ClipboardList, TrendingUp, TrendingDown, ShoppingCart, User } from "lucide-react";
import { safeFormat, APP_DATE_TIME_FORMAT } from "@/lib/date-utils";
import type { StockActivity } from "@/lib/types";
import { cn } from "@/lib/utils";

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
  const [searchTerm, setSearchTerm] = useState("");

  const logQuery = useMemo(() => 
    db ? query(collection(db, "stockActivities"), orderBy("createdAt", "desc"), limit(500)) : null
  , [db]);

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
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              รายการความเคลื่อนไหวล่าสุด
            </CardTitle>
            <div className="relative w-full sm:w-80">
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
          <div className="border rounded-xl overflow-hidden shadow-sm">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>วัน/เวลา</TableHead>
                  <TableHead>สินค้า (รหัส/ชื่อ)</TableHead>
                  <TableHead>ประเภท</TableHead>
                  <TableHead className="text-right">จำนวนเดิม</TableHead>
                  <TableHead className="text-right">ปรับปรุง</TableHead>
                  <TableHead className="text-right">ยอดใหม่</TableHead>
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
                          <p className="text-xs line-clamp-1 max-w-[180px]">{log.partName}</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant={style.variant} className="text-[9px] px-1.5 h-5">
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
                      ไม่พบประวัติการปรับปรุงสต็อกที่ระบุ
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
