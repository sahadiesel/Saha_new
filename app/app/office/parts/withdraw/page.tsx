
"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { collection, query, orderBy, onSnapshot, limit, where } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, PlusCircle, ClipboardList, History, Search, Eye, Edit } from "lucide-react";
import { Input } from "@/components/ui/input";
import { safeFormat, APP_DATE_FORMAT } from "@/lib/date-utils";
import type { Document } from "@/lib/types";
import { docStatusLabel } from "@/lib/ui-labels";

export default function OfficePartsWithdrawPage() {
  const { db } = useFirebase();
  const [withdrawals, setWithdrawals] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (!db) return;
    const q = query(
        collection(db, "documents"), 
        where("docType", "==", "WITHDRAWAL"),
        orderBy("docNo", "desc"), 
        limit(100)
    );
    return onSnapshot(q, (snap) => {
      setWithdrawals(snap.docs.map(d => ({ id: d.id, ...d.data() } as Document)));
      setLoading(false);
    }, (err) => {
        console.error(err);
        setLoading(false);
    });
  }, [db]);

  const filtered = useMemo(() => {
    if (!searchTerm) return withdrawals;
    const q = searchTerm.toLowerCase();
    return withdrawals.filter(w => 
      w.docNo.toLowerCase().includes(q) || 
      w.customerSnapshot?.name?.toLowerCase().includes(q) ||
      w.notes?.toLowerCase().includes(q) ||
      w.jobId?.toLowerCase().includes(q)
    );
  }, [withdrawals, searchTerm]);

  return (
    <div className="space-y-6">
      <PageHeader title="รายการเบิกสินค้า" description="ตรวจสอบและจัดการเอกสารใบเบิกอะไหล่เพื่อใช้ในการซ่อม">
        <Button asChild className="shadow-md">
          <Link href="/app/office/parts/withdraw/new">
            <PlusCircle className="mr-2 h-4 w-4" /> สร้างรายการเบิก
          </Link>
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-primary" />
              ประวัติใบเบิกอะไหล่
            </CardTitle>
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="ค้นหาเลขที่ใบเบิก, ชื่อลูกค้า, เลขใบงาน..." 
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
                  <TableHead className="w-32">เลขที่ใบเบิก</TableHead>
                  <TableHead className="w-24">วันที่</TableHead>
                  <TableHead>อ้างอิงใบงาน</TableHead>
                  <TableHead>ลูกค้า</TableHead>
                  <TableHead>สถานะ</TableHead>
                  <TableHead className="text-right">มูลค่ารวม</TableHead>
                  <TableHead className="text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7} className="h-24 text-center"><Loader2 className="animate-spin mx-auto text-primary" /></TableCell></TableRow>
                ) : filtered.length > 0 ? (
                  filtered.map(w => (
                    <TableRow key={w.id} className="hover:bg-muted/30">
                      <TableCell className="font-bold font-mono text-primary text-xs">{w.docNo}</TableCell>
                      <TableCell className="text-xs">{safeFormat(new Date(w.docDate), APP_DATE_FORMAT)}</TableCell>
                      <TableCell>
                        {w.jobId ? (
                            <Badge variant="outline" className="font-mono text-[10px] border-primary/20 text-primary">
                                {w.jobId}
                            </Badge>
                        ) : "-"}
                      </TableCell>
                      <TableCell className="text-sm">{w.customerSnapshot?.name}</TableCell>
                      <TableCell>
                        <Badge variant={w.status === 'DRAFT' ? 'secondary' : 'default'} className="text-[10px]">
                            {docStatusLabel(w.status, 'WITHDRAWAL')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-black">฿{w.grandTotal.toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                            {w.status === 'DRAFT' ? (
                                <Button asChild variant="outline" size="sm" className="h-8">
                                    <Link href={`/app/office/parts/withdraw/new?editDocId=${w.id}`}>
                                        <Edit className="h-3 w-3 mr-1" /> แก้ไข
                                    </Link>
                                </Button>
                            ) : (
                                <Button asChild variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                                    <Link href={`/app/documents/${w.id}`}><Eye className="h-4 w-4" /></Link>
                                </Button>
                            )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground italic">ไม่พบรายการเบิก</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
