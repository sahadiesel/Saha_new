
"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  limit, 
  where, 
  doc, 
  deleteDoc, 
  runTransaction, 
  serverTimestamp,
  writeBatch
} from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { 
  Loader2, 
  PlusCircle, 
  ClipboardList, 
  Search, 
  Eye, 
  Edit, 
  MoreHorizontal, 
  Trash2, 
  AlertCircle,
  RotateCcw,
  XCircle
} from "lucide-react";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import { safeFormat, APP_DATE_FORMAT } from "@/lib/date-utils";
import { cn, sanitizeForFirestore } from "@/lib/utils";
import type { Document } from "@/lib/types";
import { docStatusLabel } from "@/lib/ui-labels";

export default function OfficePartsWithdrawPage() {
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [withdrawals, setWithdrawals] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [docToDelete, setDocToDelete] = useState<Document | null>(null);
  const [docToCancel, setDocToCancel] = useState<Document | null>(null);

  const isAdmin = profile?.role === 'ADMIN' || profile?.role === 'MANAGER';

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

  const handleConfirmDelete = async () => {
    if (!db || !docToDelete || !profile) return;
    setIsActionLoading(true);

    try {
      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, "documents", docToDelete.id);
        const docSnap = await transaction.get(docRef);
        
        if (!docSnap.exists()) throw new Error("ไม่พบเอกสารในระบบ");
        const docData = docSnap.data() as Document;

        // If it was already ISSUED (stock deducted), we must revert stock
        if (docData.status === 'ISSUED') {
          for (const item of docData.items) {
            if (!item.partId) continue;
            const partRef = doc(db, "parts", item.partId);
            const partSnap = await transaction.get(partRef);
            
            if (partSnap.exists()) {
              const currentQty = partSnap.data().stockQty || 0;
              const revertQty = item.quantity || 0;
              
              transaction.update(partRef, {
                stockQty: currentQty + revertQty,
                updatedAt: serverTimestamp()
              });

              const actRef = doc(collection(db, "stockActivities"));
              transaction.set(actRef, sanitizeForFirestore({
                partId: item.partId,
                partCode: item.code,
                partName: item.description,
                type: 'ADJUST_ADD',
                diffQty: revertQty,
                beforeQty: currentQty,
                afterQty: currentQty + revertQty,
                notes: `คืนสต็อกเนื่องจากการลบใบเบิก ${docData.docNo} โดย ${profile.displayName}`,
                createdByUid: profile.uid,
                createdByName: profile.displayName,
                createdAt: serverTimestamp(),
              }));
            }
          }
        }

        transaction.delete(docRef);
      });

      toast({ 
        title: "ลบรายการเบิกสำเร็จ", 
        description: docToDelete.status === 'ISSUED' ? "ระบบได้ทำการคืนยอดสต็อกกลับเข้าคลังให้เรียบร้อยแล้วค่ะ" : "ลบข้อมูลฉบับร่างเรียบร้อยแล้วค่ะ" 
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "ลบไม่สำเร็จ", description: e.message });
    } finally {
      setIsActionLoading(false);
      setDocToDelete(null);
    }
  };

  const handleConfirmCancel = async () => {
    if (!db || !docToCancel || !profile) return;
    setIsActionLoading(true);

    try {
      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, "documents", docToCancel.id);
        const docSnap = await transaction.get(docRef);
        
        if (!docSnap.exists()) throw new Error("ไม่พบเอกสารในระบบ");
        const docData = docSnap.data() as Document;

        // 1. Revert Stock if was ISSUED
        if (docData.status === 'ISSUED') {
          for (const item of docData.items) {
            if (!item.partId) continue;
            const partRef = doc(db, "parts", item.partId);
            const partSnap = await transaction.get(partRef);
            
            if (partSnap.exists()) {
              const currentQty = partSnap.data().stockQty || 0;
              const revertQty = item.quantity || 0;
              
              transaction.update(partRef, {
                stockQty: currentQty + revertQty,
                updatedAt: serverTimestamp()
              });

              const actRef = doc(collection(db, "stockActivities"));
              transaction.set(actRef, sanitizeForFirestore({
                partId: item.partId,
                partCode: item.code,
                partName: item.description,
                type: 'ADJUST_ADD',
                diffQty: revertQty,
                beforeQty: currentQty,
                afterQty: currentQty + revertQty,
                notes: `คืนสต็อกเนื่องจากการยกเลิกใบเบิก ${docData.docNo} โดย ${profile.displayName}`,
                createdByUid: profile.uid,
                createdByName: profile.displayName,
                createdAt: serverTimestamp(),
              }));
            }
          }
        }

        // 2. Set status to CANCELLED
        transaction.update(docRef, {
          status: 'CANCELLED',
          updatedAt: serverTimestamp(),
          notes: (docData.notes || "") + `\n[System] ยกเลิกเมื่อ ${safeFormat(new Date(), 'dd/MM/yyyy HH:mm')} โดย ${profile.displayName} (คืนสต็อก/ยกเลิกการผูกบิล)`
        });
      });

      toast({ 
        title: "ยกเลิกรายการเบิกสำเร็จ", 
        description: "คืนยอดสต็อกกลับเข้าคลังและปลดการเชื่อมโยงเรียบร้อยแล้วค่ะ" 
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "ยกเลิกไม่สำเร็จ", description: e.message });
    } finally {
      setIsActionLoading(false);
      setDocToCancel(null);
    }
  };

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
                  <TableHead className="text-center">สถานะ</TableHead>
                  <TableHead className="text-right">มูลค่ารวม</TableHead>
                  <TableHead className="text-right w-24">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7} className="h-24 text-center"><Loader2 className="animate-spin mx-auto text-primary" /></TableCell></TableRow>
                ) : filtered.length > 0 ? (
                  filtered.map(w => {
                    const s = w.status.toUpperCase();
                    return (
                      <TableRow key={w.id} className={cn("hover:bg-muted/30", s === 'CANCELLED' && "opacity-50 grayscale")}>
                        <TableCell className="font-bold font-mono text-primary text-xs">
                          <Link href={`/app/documents/${w.id}`} className="hover:underline">{w.docNo}</Link>
                        </TableCell>
                        <TableCell className="text-xs">{safeFormat(new Date(w.docDate), APP_DATE_FORMAT)}</TableCell>
                        <TableCell>
                          {w.jobId ? (
                              <Badge variant="outline" className="font-mono text-[10px] border-primary/20 text-primary">
                                  {w.jobId}
                              </Badge>
                          ) : "-"}
                        </TableCell>
                        <TableCell className="text-sm font-medium">{w.customerSnapshot?.name}</TableCell>
                        <TableCell className="text-center">
                          <Badge 
                            variant={s === 'DRAFT' ? 'secondary' : s === 'CANCELLED' ? 'destructive' : 'default'} 
                            className={cn("text-[10px] min-w-[60px] justify-center", s === 'ISSUED' && "bg-green-600")}
                          >
                              {docStatusLabel(w.status, 'WITHDRAWAL')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-black">฿{w.grandTotal.toLocaleString()}</TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => router.push(`/app/documents/${w.id}`)}>
                                <Eye className="mr-2 h-4 w-4" /> ดูรายละเอียด
                              </DropdownMenuItem>
                              
                              {s === 'DRAFT' && (
                                <DropdownMenuItem onClick={() => router.push(`/app/office/parts/withdraw/new?editDocId=${w.id}`)}>
                                  <Edit className="mr-2 h-4 w-4" /> แก้ไขฉบับร่าง
                                </DropdownMenuItem>
                              )}

                              {s !== 'CANCELLED' && (
                                <DropdownMenuItem 
                                  className="text-orange-600 focus:text-orange-600"
                                  onClick={() => setDocToCancel(w)}
                                >
                                  <XCircle className="mr-2 h-4 w-4" /> ยกเลิกรายการ
                                </DropdownMenuItem>
                              )}

                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDocToDelete(w)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" /> ลบถาวร
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground italic">ไม่พบรายการเบิก</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Delete Dialog */}
      <AlertDialog open={!!docToDelete} onOpenChange={(o) => !o && setDocToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              ยืนยันการลบรายการถาวร?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>คุณต้องการลบเอกสารเลขที่ <span className="font-bold">{docToDelete?.docNo}</span> ใช่หรือไม่? การลบจะทำให้ข้อมูลหายไปจากระบบอย่างถาวร</p>
              {docToDelete?.status === 'ISSUED' && (
                <Alert variant="destructive" className="bg-destructive/5 border-destructive/20 text-destructive">
                  <RotateCcw className="h-4 w-4" />
                  <AlertTitle className="text-xs font-bold">ข้อมูลการคืนสต็อก</AlertTitle>
                  <AlertDescription className="text-[10px]">
                    เนื่องจากรายการนี้เบิกไปแล้ว เมื่อลบระบบจะทำการ **บวกยอดสินค้าคืนเข้าคลัง** ให้โดยอัตโนมัติค่ะ
                  </AlertDescription>
                </Alert>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionLoading}>ปิด</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmDelete} 
              disabled={isActionLoading}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isActionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "ยืนยันลบถาวร"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Dialog */}
      <AlertDialog open={!!docToCancel} onOpenChange={(o) => !o && setDocToCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-orange-600" />
              ยืนยันการยกเลิกรายการเบิก?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>ต้องการยกเลิกใบเบิกเลขที่ <span className="font-bold">{docToCancel?.docNo}</span> ใช่หรือไม่? เอกสารจะยังคงอยู่ในประวัติแต่สถานะจะเปลี่ยนเป็นยกเลิก</p>
              {docToCancel?.status === 'ISSUED' && (
                <Alert variant="secondary" className="bg-orange-50 border-orange-200 text-orange-800">
                  <RotateCcw className="h-4 w-4 text-orange-600" />
                  <AlertTitle className="text-xs font-bold">ผลของการยกเลิก</AlertTitle>
                  <AlertDescription className="text-[10px] space-y-1">
                    <p>• ระบบจะ **คืนยอดสินค้าเข้าคลัง** ให้โดยอัตโนมัติ</p>
                    <p>• ระบบจะ **ยกเลิกการผูกบิล** ออกจากใบงานซ่อมเพื่อให้เบิกใหม่ได้</p>
                  </AlertDescription>
                </Alert>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionLoading}>ปิด</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmCancel} 
              disabled={isActionLoading}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {isActionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "ยืนยันยกเลิก"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
