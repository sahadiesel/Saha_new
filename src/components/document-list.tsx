"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { collection, onSnapshot, query, where, type FirestoreError, doc, updateDoc, serverTimestamp, deleteDoc, orderBy, type OrderByDirection, limit, getDoc, deleteField, writeBatch } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";

import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Search, AlertCircle, MoreHorizontal, XCircle, Trash2, Edit, Eye, ChevronLeft, ChevronRight, ExternalLink, RotateCcw } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { safeFormat } from '@/lib/date-utils';
import type { Document, DocType } from "@/lib/types";
import { docStatusLabel } from "@/lib/ui-labels";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface DocumentListProps {
  docType: DocType;
  limit?: number;
  orderByField?: string;
  orderByDirection?: OrderByDirection;
  baseContext?: 'office' | 'accounting';
}

const getDocDisplayStatus = (doc: Document): { key: string; label: string; description: string; variant: "default" | "secondary" | "destructive" | "outline" } => {
    const status = String(doc.status ?? "").toUpperCase();
    const label = docStatusLabel(status) || status;

    let description = "สถานะเอกสารปกติ";
    switch(status) {
        case "DRAFT": description = "ออฟฟิศกำลังจัดทำ ยังไม่ได้ส่งให้บัญชีตรวจสอบ"; break;
        case "PENDING_REVIEW": description = "ส่งเรื่องให้ฝ่ายบัญชีตรวจสอบรายการขายแล้ว"; break;
        case "REJECTED": description = "ฝ่ายบัญชีพบจุดที่ต้องแก้ไขและส่งกลับมาให้ออฟฟิศ"; break;
        case "APPROVED": description = "ฝ่ายบัญชีตรวจสอบข้อมูลเบื้องต้นถูกต้องแล้ว"; break;
        case "PAID": description = "บันทึกรับเงินเข้าสมุดบัญชีเรียบร้อยแล้ว"; break;
        case "CANCELLED": description = "เอกสารนี้ถูกยกเลิกการใช้งานแล้ว"; break;
        case "UNPAID": description = "เป็นรายการขายเชื่อ ยอดเงินยังคงค้างชำระในระบบ"; break;
        case "PARTIAL": description = "ได้รับเงินมาบางส่วนแล้ว ยอดที่เหลือยังค้างชำระ"; break;
    }

    if (status === "CANCELLED") return { key: "CANCELLED", label, description, variant: "destructive" };
    if (status === "PAID") return { key: "PAID", label, description, variant: "default" };
    if (status === "REJECTED") return { key: "REJECTED", label, description, variant: "destructive" };
    if (status === "PENDING_REVIEW") return { key: "PENDING_REVIEW", label, description, variant: "secondary" };
    if (status === "DRAFT") return { key: "DRAFT", label, description, variant: "outline" };

    return { key: status, label, description, variant: "outline" };
};

export function DocumentList({ 
  docType,
  limit: limitProp = 10,
  orderByField = 'docNo',
  orderByDirection = 'desc',
  baseContext = 'office'
}: DocumentListProps) {
  const { db } = useFirebase();
  const { toast } = useToast();
  const router = useRouter();
  const { profile } = useAuth();

  const [allDocuments, setAllDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FirestoreError | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [indexCreationUrl, setIndexCreationUrl] = useState<string | null>(null);
  
  const [docToAction, setDocToAction] = useState<Document | null>(null);
  const [isCancelAlertOpen, setIsCancelAlertOpen] = useState(false);
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false);
  const [isRevertAlertOpen, setIsRevertAlertOpen] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  
  const [currentPage, setCurrentPage] = useState(0);

  const isUserAdmin = profile?.role === 'ADMIN' || profile?.role === 'MANAGER';

  const uniqueStatuses = useMemo(() => ["ALL", "DRAFT", "PENDING_REVIEW", "REJECTED", "APPROVED", "UNPAID", "PARTIAL", "PAID", "CANCELLED"], []);

  const stableQuery = useMemo(() => {
    if (!db) return null;
    return query(
      collection(db, "documents"), 
      where("docType", "==", docType),
      orderBy(orderByField, orderByDirection),
      limit(500)
    );
  }, [db, docType, orderByField, orderByDirection]);

  useEffect(() => {
    if (!stableQuery) return;
    
    setLoading(true);
    setIndexCreationUrl(null);
    const unsubscribe = onSnapshot(stableQuery, (snapshot) => {
        const docsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Document));
        setAllDocuments(docsData);
        setLoading(false);
        setError(null);
    }, (err: FirestoreError) => {
        console.error("Error fetching documents: ", err);
        setError(err);
        if (err.message?.includes('requires an index')) {
            const urlMatch = err.message.match(/https?:\/\/[^\s]+/);
            if (urlMatch) setIndexCreationUrl(urlMatch[0]);
        }
        setLoading(false);
    });

    return () => unsubscribe();
  }, [stableQuery]);

  const processedDocuments = useMemo(() => {
    let filtered = [...allDocuments];

    if (statusFilter !== "ALL") {
        filtered = filtered.filter(doc => getDocDisplayStatus(doc).key === statusFilter);
    }

    if (searchTerm) {
      const lowercasedTerm = searchTerm.toLowerCase();
      filtered = filtered.filter(doc =>
        doc.docNo.toLowerCase().includes(lowercasedTerm) ||
        (doc.customerSnapshot.name || "").toLowerCase().includes(lowercasedTerm) ||
        (doc.customerSnapshot.phone || "").includes(lowercasedTerm) ||
        doc.jobId?.toLowerCase().includes(lowercasedTerm) ||
        doc.carSnapshot?.licensePlate?.toLowerCase().includes(lowercasedTerm)
      );
    }

    return filtered;
  }, [allDocuments, searchTerm, statusFilter]);
  
  const paginatedDocuments = useMemo(() => {
    const start = currentPage * limitProp;
    const end = start + limitProp;
    return processedDocuments.slice(start, end);
  }, [processedDocuments, currentPage, limitProp]);

  const totalPages = Math.max(1, Math.ceil(processedDocuments.length / limitProp));
  
  useEffect(() => {
    setCurrentPage(0);
  }, [searchTerm, statusFilter]);

  const cleanBillingRun = async (docObj: Document) => {
    if (!db || docObj.docType !== 'BILLING_NOTE') return;
    const monthId = docObj.billingRunId || docObj.docDate.substring(0, 7);
    const customerId = docObj.customerId || docObj.customerSnapshot?.id || docObj.customerSnapshot?.phone;
    if (monthId && customerId) {
      try {
        await updateDoc(doc(db, 'billingRuns', monthId), {
          [`createdBillingNotes.${customerId}`]: deleteField(),
          updatedAt: serverTimestamp()
        });
      } catch (e) { console.warn("Billing run cleanup failed", e); }
    }
  };

  const confirmCancel = async () => {
    if (!db || !docToAction || !profile) return;
    setIsActionLoading(true);
    try {
      const batch = writeBatch(db);
      const docRef = doc(db, 'documents', docToAction.id);
      
      batch.update(docRef, {
        status: 'CANCELLED',
        updatedAt: serverTimestamp(),
        notes: (docToAction.notes || "") + `\n[System] ยกเลิกเมื่อ ${safeFormat(new Date(), 'dd/MM/yy HH:mm')} โดย ${profile.displayName}`
      });

      if (docToAction.jobId) {
        const jobRef = doc(db, 'jobs', docToAction.jobId);
        const jobSnap = await getDoc(jobRef);
        
        if (jobSnap.exists()) {
          const jobData = jobSnap.data();
          if (jobData.salesDocId === docToAction.id) {
            batch.update(jobRef, {
              status: 'DONE',
              salesDocId: deleteField(),
              salesDocNo: deleteField(),
              salesDocType: deleteField(),
              lastActivityAt: serverTimestamp(),
            });

            const activityRef = doc(collection(db, 'jobs', docToAction.jobId, 'activities'));
            batch.set(activityRef, {
              text: `ยกเลิกเอกสาร ${docToAction.docNo}: ระบบล้างข้อมูลการผูกบิลและย้อนสถานะงานกลับเป็น "ทำเสร็จ" เพื่อให้ออกบิลใหม่ได้`,
              userName: profile.displayName,
              userId: profile.uid,
              createdAt: serverTimestamp(),
            });
          }
        }
      }

      await batch.commit();
      await cleanBillingRun(docToAction);
      toast({ title: "ยกเลิกเอกสารเรียบร้อย", description: "สถานะใบงานถูกย้อนกลับเพื่อให้จัดการใหม่ได้แล้วค่ะ" });
    } catch (err: any) {
      toast({ variant: 'destructive', title: "ยกเลิกไม่สำเร็จ", description: err.message });
    } finally {
      setIsActionLoading(false);
      setIsCancelAlertOpen(false);
      setDocToAction(null);
    }
  };

  const confirmRevertPayment = async () => {
    if (!db || !docToAction || !profile) return;
    setIsActionLoading(true);
    
    try {
      const batch = writeBatch(db);
      const docRef = doc(db, 'documents', docToAction.id);
      
      if (docToAction.accountingEntryId) {
        const entryRef = doc(db, 'accountingEntries', docToAction.accountingEntryId);
        batch.delete(entryRef);
      }

      batch.update(docRef, {
        status: 'APPROVED', 
        paymentSummary: {
            paidTotal: 0,
            balance: docToAction.grandTotal,
            paymentStatus: 'UNPAID'
        },
        receiptStatus: deleteField(),
        accountingEntryId: deleteField(),
        updatedAt: serverTimestamp(),
        notes: (docToAction.notes || "") + `\n[Fix] กู้คืนสถานะเพื่อรอออกใบเสร็จ โดย ${profile.displayName} เมื่อ ${safeFormat(new Date(), 'dd/MM/yy HH:mm')}`
      });

      await batch.commit();
      toast({ title: "กู้คืนสถานะสำเร็จ", description: "บิลนี้กลับไปรอออกใบเสร็จ และลบยอดเงินซ้ำออกจากสมุดบัญชีแล้วค่ะ" });
    } catch (err: any) {
      toast({ variant: 'destructive', title: "กู้คืนไม่สำเร็จ", description: err.message });
    } finally {
      setIsActionLoading(false);
      setIsRevertAlertOpen(false);
      setDocToAction(null);
    }
  };

  const confirmDelete = async () => {
    if (!db || !docToAction) return;
    setIsActionLoading(true);
    try {
      await cleanBillingRun(docToAction);
      await deleteDoc(doc(db, 'documents', docToAction.id));
      toast({ title: "ลบเอกสารสำเร็จ" });
    } catch (err: any) {
      toast({ variant: 'destructive', title: "ลบไม่สำเร็จ", description: err.message });
    } finally {
      setIsActionLoading(false);
      setIsDeleteAlertOpen(false);
      setDocToAction(null);
    }
  };

  return (
    <>
      <Card>
        <CardContent className="pt-6 space-y-4">
          {indexCreationUrl && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>ต้องสร้างดัชนี (Index) ก่อน</AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <span>ฐานข้อมูลต้องการดัชนีเพื่อเรียงลำดับเอกสาร กรุณากดปุ่มด้านล่างเพื่อสร้าง Index</span>
                <Button asChild variant="outline" size="sm" className="w-fit">
                  <a href={indexCreationUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" /> สร้าง Index ใน Firebase Console
                  </a>
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาบิล, ชื่อลูกค้า, ทะเบียนรถ..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[200px]"><SelectValue placeholder="กรองตามสถานะ..." /></SelectTrigger>
              <SelectContent>
                {uniqueStatuses.map(status => (
                    <SelectItem key={status} value={status}>{status === "ALL" ? "ทุกสถานะ" : docStatusLabel(status) || status}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {loading ? (
            <div className="flex justify-center items-center h-48"><Loader2 className="animate-spin h-8 w-8" /></div>
          ) : (
            <div className="border rounded-md">
              <TooltipProvider>
                <Table>
                  <TableHeader><TableRow><TableHead>เลขที่</TableHead><TableHead>วันที่</TableHead><TableHead>ลูกค้า</TableHead><TableHead>สถานะ</TableHead><TableHead className="text-right">ยอดสุทธิ</TableHead><TableHead className="text-right w-[100px]">จัดการ</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {paginatedDocuments.length > 0 ? paginatedDocuments.map(docItem => {
                      const displayStatus = getDocDisplayStatus(docItem);
                      const viewPath = docItem.docType === 'DELIVERY_NOTE' ? `/app/office/documents/delivery-note/${docItem.id}` : (docItem.docType === 'TAX_INVOICE' ? `/app/office/documents/tax-invoice/${docItem.id}` : `/app/documents/${docItem.id}`);
                      const editPath = baseContext === 'office' && ['TAX_INVOICE', 'DELIVERY_NOTE', 'QUOTATION'].includes(docItem.docType) ? `/app/office/documents/${docItem.docType.toLowerCase().replace('_', '-')}/new?editDocId=${docItem.id}` : null;

                      return (
                      <TableRow key={docItem.id}>
                        <TableCell className="font-medium">{docItem.docNo}</TableCell>
                        <TableCell>{safeFormat(new Date(docItem.docDate), 'dd/MM/yyyy')}</TableCell>
                        <TableCell>{docItem.customerSnapshot?.name || "ไม่ทราบชื่อ"}</TableCell>
                        <TableCell><Tooltip><TooltipTrigger asChild><Badge variant={displayStatus.variant} className="cursor-help">{displayStatus.label}</Badge></TooltipTrigger><TooltipContent><p>{displayStatus.description}</p></TooltipContent></Tooltip></TableCell>
                        <TableCell className="text-right">{docItem.grandTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => router.push(viewPath)}><Eye className="mr-2 h-4 w-4"/> ดูรายละเอียด</DropdownMenuItem>
                              {editPath && <DropdownMenuItem onSelect={() => router.push(editPath)} disabled={docItem.status === 'PAID' && !isUserAdmin}> <Edit className="mr-2 h-4 w-4"/> แก้ไข</DropdownMenuItem>}
                              
                              {isUserAdmin && docItem.status === 'PAID' && !docItem.receiptDocId && (
                                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setDocToAction(docItem); setIsRevertAlertOpen(true); }} className="text-amber-600 focus:text-amber-600 font-bold">
                                    <RotateCcw className="mr-2 h-4 w-4" /> กู้คืนเพื่อออกใบเสร็จ
                                </DropdownMenuItem>
                              )}

                              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setDocToAction(docItem); setIsCancelAlertOpen(true); }} disabled={docItem.status === 'CANCELLED' || (docItem.status === 'PAID' && !isUserAdmin)}> <XCircle className="mr-2 h-4 w-4"/> ยกเลิก</DropdownMenuItem>
                              {isUserAdmin && <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setDocToAction(docItem); setIsDeleteAlertOpen(true); }} className="text-destructive focus:text-destructive"> <Trash2 className="mr-2 h-4 w-4" /> ลบ</DropdownMenuItem>}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )}) : (
                      <TableRow><TableCell colSpan={6} className="h-24 text-center">{searchTerm ? "ไม่พบเอกสารที่ตรงกับคำค้นหา" : "ไม่พบเอกสาร"}</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </TooltipProvider>
            </div>
          )}
        </CardContent>
         {totalPages > 1 && (
          <CardFooter>
            <div className="flex w-full justify-between items-center">
              <span className="text-sm text-muted-foreground">หน้า {currentPage + 1} จาก {totalPages}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => p - 1)} disabled={currentPage === 0}><ChevronLeft className="h-4 w-4" /> ก่อนหน้า</Button>
                <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage >= totalPages - 1}>ถัดไป <ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          </CardFooter>
        )}
      </Card>

      <AlertDialog open={isCancelAlertOpen} onOpenChange={setIsCancelAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการยกเลิกเอกสาร</AlertDialogTitle>
            <AlertDialogDescription>การยกเลิกนี้จะย้อนสถานะใบงานกลับไปเป็น "ทำเสร็จ" (DONE) เพื่อให้สามารถออกบิลใบใหม่ได้ คุณต้องการดำเนินการต่อหรือไม่?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionLoading}>ปิด</AlertDialogCancel>
            <AlertDialogAction onClick={confirmCancel} disabled={isActionLoading}>{isActionLoading ? <Loader2 className="h-4 w-4 animate-spin"/> : 'ยืนยันการยกเลิก'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isRevertAlertOpen} onOpenChange={setIsRevertAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><RotateCcw className="h-5 w-5 text-amber-500"/> กู้คืนสถานะเพื่อรอออกใบเสร็จ?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>ระบบตรวจพบว่าบิลเลขที่ <span className="font-bold">{docToAction?.docNo}</span> ถูกบันทึกรับเงินเข้าบัญชีไปแล้วโดยข้ามขั้นตอนใบเสร็จ</p>
                <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-800 text-xs">
                  <strong>การดำเนินการนี้จะ:</strong>
                  <ul className="list-disc pl-4 mt-1">
                      <li>ลบรายการเงินเข้าในสมุดบัญชี (Cashbook) ของบิลใบนี้ออก</li>
                      <li>เปลี่ยนสถานะบิลกลับเป็น "รอออกใบเสร็จ"</li>
                      <li>เพื่อให้คุณสามารถไปออกใบเสร็จและยืนยันรับเงินตามระบบใหม่ได้ถูกต้องค่ะ</li>
                  </ul>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionLoading}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRevertPayment} disabled={isActionLoading} className="bg-amber-600 hover:bg-amber-700">
                {isActionLoading ? <Loader2 className="h-4 w-4 animate-spin"/> : 'ยืนยันการกู้คืน'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isDeleteAlertOpen} onOpenChange={setIsDeleteAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>ยืนยันการลบ</AlertDialogTitle><AlertDialogDescription>คุณต้องการลบเอกสารนี้อย่างถาวรใช่หรือไม่? การลบจะล้างประวัติการผูกพันกับใบงานด้วยเช่นกัน และเลขที่นี้จะถูกนำกลับมาใช้ใหม่ในบิลใบถัดไป</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionLoading}>ปิด</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={isActionLoading}>{isActionLoading ? <Loader2 className="h-4 w-4 animate-spin"/> : 'ยืนยันการลบ'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
