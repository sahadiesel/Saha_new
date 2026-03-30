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
import { Loader2, Search, AlertCircle, MoreHorizontal, XCircle, Trash2, Edit, Eye, ChevronLeft, ChevronRight, ExternalLink, RotateCcw, Hash, Filter, Receipt } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { safeFormat, APP_DATE_FORMAT } from '@/lib/date-utils';
import type { Document, DocType } from "@/lib/types";
import { docStatusLabel } from "@/lib/ui-labels";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

interface DocumentListProps {
  docType: DocType;
  limit?: number;
  orderByField?: string;
  orderByDirection?: OrderByDirection;
  baseContext?: 'office' | 'accounting';
}

const getDocDisplayStatus = (doc: Document): { key: string; label: string; description: string; variant: "default" | "secondary" | "destructive" | "outline" } => {
    const statusKey = String(doc.status ?? "").toUpperCase();
    const label = docStatusLabel(doc.status, doc.docType);

    let description = "สถานะเอกสารปกติ";
    switch(statusKey) {
        case "DRAFT": description = "ออฟฟิศกำลังจัดทำ ยังไม่ได้ส่งให้บัญชีตรวจสอบ"; break;
        case "PENDING_REVIEW": description = "ส่งเรื่องให้ฝ่ายบัญชีตรวจสอบแล้ว"; break;
        case "REJECTED": description = "ฝ่ายบัญชีพบจุดที่ต้องแก้ไขและส่งกลับมาให้ออฟฟิศ"; break;
        case "APPROVED": description = "ฝ่ายบัญชีตรวจสอบข้อมูลเบื้องต้นถูกต้องแล้ว (รอออกใบเสร็จ)"; break;
        case "PAID": description = "บันทึกรับเงินเข้าสมุดบัญชีเรียบร้อยแล้ว"; break;
        case "CANCELLED": description = "เอกสารนี้ถูกยกเลิกการใช้งานแล้ว"; break;
        case "UNPAID": description = "เป็นรายการขายเชื่อ ยอดเงินยังคงค้างชำระในระบบ"; break;
        case "PARTIAL": description = "ได้รับเงินมาบางส่วนแล้ว ยอดที่เหลือยังค้างชำระ"; break;
    }

    if (doc.docType === 'DELIVERY_NOTE' && statusKey === 'APPROVED') {
        description = "ใบส่งของรอฝ่ายบัญชียืนยันรับเงินเพื่อปิดงาน";
    }

    if (statusKey === "CANCELLED") return { key: "CANCELLED", label, description, variant: "destructive" };
    if (statusKey === "PAID") return { key: "PAID", label, description, variant: "default" };
    if (statusKey === "REJECTED") return { key: "REJECTED", label, description, variant: "destructive" };
    if (statusKey === "PENDING_REVIEW" || (doc.docType === 'DELIVERY_NOTE' && statusKey === 'APPROVED')) return { key: "PENDING_REVIEW", label, description, variant: "secondary" };
    if (statusKey === "DRAFT") return { key: "DRAFT", label, description, variant: "outline" };

    return { key: statusKey, label, description, variant: "outline" };
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
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [prefixFilter, setPrefixFilter] = useState("ALL");
  const [indexErrorUrl, setIndexErrorUrl] = useState<string | null>(null);
  
  const [docToAction, setDocToAction] = useState<Document | null>(null);
  const [isCancelAlertOpen, setIsCancelAlertOpen] = useState(false);
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false);
  const [isRevertAlertOpen, setIsRevertAlertOpen] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  
  const [currentPage, setCurrentPage] = useState(0);

  const [billingReceiptOpen, setBillingReceiptOpen] = useState(false);
  const [billingReceiptSource, setBillingReceiptSource] = useState<Document | null>(null);
  const [billingLines, setBillingLines] = useState<{ id: string; docNo: string; balance: number }[]>([]);
  const [billingPickLoading, setBillingPickLoading] = useState(false);
  const [billingSelected, setBillingSelected] = useState<Record<string, boolean>>({});

  const isUserAdmin = profile?.role === 'ADMIN' || profile?.role === 'MANAGER';

  const canManageDocs = (isUserAdmin || profile?.department === 'OFFICE' || profile?.department === 'MANAGEMENT') && 
                        profile?.department !== 'PURCHASING';

  const uniqueStatuses = useMemo(() => {
    const base = ["ALL", "DRAFT", "PENDING_REVIEW", "REJECTED", "APPROVED", "UNPAID", "PARTIAL", "PAID", "CANCELLED"];
    if (docType === 'DELIVERY_NOTE') return base.filter(s => s !== "APPROVED");
    return base;
  }, [docType]);

  const availablePrefixes = useMemo(() => {
    const prefixes = new Set<string>();
    allDocuments.forEach(doc => {
      const match = doc.docNo.match(/^[A-Za-z]+/);
      if (match) prefixes.add(match[0]);
    });
    return Array.from(prefixes).sort();
  }, [allDocuments]);

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
    const unsubscribe = onSnapshot(stableQuery, (snapshot) => {
        setAllDocuments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Document)));
        setLoading(false);
    }, (err) => {
        if (err.message?.includes('requires an index')) {
            const urlMatch = err.message.match(/https?:\/\/[^\s]+/);
            if (urlMatch) setIndexErrorUrl(urlMatch[0]);
        } else if (err.code === 'permission-denied') {
            errorEmitter.emit('permission-error', new FirestorePermissionError({
                path: 'documents',
                operation: 'list',
            }));
        }
        setLoading(false);
    });
    return () => unsubscribe();
  }, [stableQuery]);

  const processedDocuments = useMemo(() => {
    let filtered = [...allDocuments];
    if (prefixFilter !== "ALL") filtered = filtered.filter(doc => doc.docNo.startsWith(prefixFilter));
    if (statusFilter !== "ALL") filtered = filtered.filter(doc => getDocDisplayStatus(doc).key === statusFilter);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      filtered = filtered.filter(doc =>
        doc.docNo.toLowerCase().includes(q) ||
        (doc.customerSnapshot.name || "").toLowerCase().includes(q) ||
        (doc.customerSnapshot.phone || "").toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [allDocuments, searchTerm, statusFilter, prefixFilter]);
  
  const paginatedDocuments = useMemo(() => processedDocuments.slice(currentPage * limitProp, (currentPage + 1) * limitProp), [processedDocuments, currentPage, limitProp]);
  const totalPages = Math.max(1, Math.ceil(processedDocuments.length / limitProp));
  
  useEffect(() => { setCurrentPage(0); }, [searchTerm, statusFilter, prefixFilter]);

  const unlinkJob = async (batch: any, docObj: Document) => {
    if (!docObj.jobId) return;
    const jobRef = doc(db!, 'jobs', docObj.jobId);
    const jobSnap = await getDoc(jobRef);
    if (jobSnap.exists()) {
      const jobData = jobSnap.data();
      if (jobData.salesDocId === docObj.id) {
        batch.update(jobRef, {
          status: 'DONE',
          salesDocId: deleteField(),
          salesDocNo: deleteField(),
          salesDocType: deleteField(),
          lastActivityAt: serverTimestamp(),
        });
        const activityRef = doc(collection(jobRef, 'activities'));
        batch.set(activityRef, {
          text: `[System] เอกสาร ${docObj.docNo} ถูกยกเลิก/ลบ: ระบบคืนสถานะงานเป็น "ทำเสร็จ" เพื่อให้ออกบิลใหม่ได้ค่ะ`,
          userName: profile?.displayName || "System",
          userId: profile?.uid || "system",
          createdAt: serverTimestamp(),
        });
      }
    }
  };

  const cleanBillingRun = async (docObj: Document) => {
    if (!db || docObj.docType !== 'BILLING_NOTE') return;
    const monthId = docObj.billingRunId || docObj.docDate.substring(0, 7);
    const customerId = docObj.customerId || docObj.customerSnapshot?.id;
    if (monthId && customerId) {
      try { await updateDoc(doc(db, 'billingRuns', monthId), { [`createdBillingNotes.${customerId}`]: deleteField(), updatedAt: serverTimestamp() }); } catch (e) {}
    }
  };

  const confirmCancel = async () => {
    if (!db || !docToAction || !profile) return;
    setIsActionLoading(true);
    try {
      const batch = writeBatch(db);
      const docRef = doc(db, 'documents', docToAction.id);
      batch.update(docRef, { status: 'CANCELLED', updatedAt: serverTimestamp(), notes: (docToAction.notes || "") + `\n[System] ยกเลิกเมื่อ ${safeFormat(new Date(), APP_DATE_FORMAT + ' HH:mm')} โดย ${profile.displayName}` });
      await unlinkJob(batch, docToAction);
      await batch.commit();
      await cleanBillingRun(docToAction);
      toast({ title: "ยกเลิกเอกสารเรียบร้อย" });
    } catch (err: any) { toast({ variant: 'destructive', title: "Error", description: err.message }); } finally { setIsActionLoading(false); setIsCancelAlertOpen(false); setDocToAction(null); }
  };

  const confirmDelete = async () => {
    if (!db || !docToAction || !profile) return;
    setIsActionLoading(true);
    try {
      const batch = writeBatch(db);
      await unlinkJob(batch, docToAction);
      batch.delete(doc(db, 'documents', docToAction.id));
      await batch.commit();
      await cleanBillingRun(docToAction);
      toast({ title: "ลบเอกสารสำเร็จ" });
    } catch (err: any) { toast({ variant: 'destructive', title: "Error", description: err.message }); } finally { setIsActionLoading(false); setIsDeleteAlertOpen(false); setDocToAction(null); }
  };

  const openBillingReceiptPicker = async (bn: Document) => {
    if (!db) return;
    setBillingReceiptSource(bn);
    setBillingReceiptOpen(true);
    setBillingPickLoading(true);
    setBillingLines([]);
    setBillingSelected({});
    try {
      const ids = bn.invoiceIds || [];
      const rows = await Promise.all(
        ids.map(async (invoiceId) => {
          const s = await getDoc(doc(db, "documents", invoiceId));
          if (!s.exists()) return null;
          const d = s.data() as Document;
          return {
            id: s.id,
            docNo: d.docNo,
            balance: d.paymentSummary?.balance ?? d.grandTotal,
          };
        })
      );
      const ok = rows.filter(Boolean) as { id: string; docNo: string; balance: number }[];
      setBillingLines(ok);
      const sel: Record<string, boolean> = {};
      ok.forEach((r) => {
        sel[r.id] = true;
      });
      setBillingSelected(sel);
    } catch (er: unknown) {
      const msg = er instanceof Error ? er.message : "Unknown error";
      toast({ variant: "destructive", title: "โหลดรายการไม่สำเร็จ", description: msg });
      setBillingReceiptOpen(false);
    } finally {
      setBillingPickLoading(false);
    }
  };

  const confirmRevertPayment = async () => {
    if (!db || !docToAction || !profile) return;
    setIsActionLoading(true);
    try {
      const batch = writeBatch(db);
      if (docToAction.accountingEntryId) batch.delete(doc(db, 'accountingEntries', docToAction.accountingEntryId));
      batch.update(doc(db, 'documents', docToAction.id), { status: 'APPROVED', paymentSummary: { paidTotal: 0, balance: docToAction.grandTotal, paymentStatus: 'UNPAID' }, receiptStatus: deleteField(), accountingEntryId: deleteField(), updatedAt: serverTimestamp() });
      await batch.commit();
      toast({ title: "กู้คืนสถานะสำเร็จ" });
    } catch (err: any) { toast({ variant: 'destructive', title: "Error", description: err.message }); } finally { setIsActionLoading(false); setIsRevertAlertOpen(false); setDocToAction(null); }
  };

  return (
    <>
      <Card>
        <CardContent className="pt-6 space-y-4">
          {indexErrorUrl && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>ต้องสร้างดัชนี (Index) ก่อน</AlertTitle>
              <Button asChild variant="outline" size="sm" className="mt-2"><a href={indexErrorUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" /> สร้าง Index</a></Button>
            </Alert>
          )}
          <div className="flex flex-col md:flex-row gap-3">
            <div className="w-full md:w-48"><Select value={prefixFilter} onValueChange={setPrefixFilter}><SelectTrigger className="bg-background"><div className="flex items-center gap-2"><Hash className="h-3.5 w-3.5 text-muted-foreground"/><SelectValue placeholder="Prefix..." /></div></SelectTrigger><SelectContent><SelectItem value="ALL">ทุก Prefix</SelectItem>{availablePrefixes.map(p => (<SelectItem key={p} value={p}>{p}</SelectItem>))}</SelectContent></Select></div>
            <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="ค้นหาชื่อลูกค้า, เบอร์โทร, เลขบิล..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10 bg-background" /></div>
            <div className="w-full md:w-56"><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="bg-background"><div className="flex items-center gap-2"><Filter className="h-3.5 w-3.5 text-muted-foreground"/><SelectValue placeholder="สถานะ..." /></div></SelectTrigger><SelectContent>{uniqueStatuses.map(status => (<SelectItem key={status} value={status}>{status === "ALL" ? "ทุกสถานะ" : docStatusLabel(status, docType)}</SelectItem>))}</SelectContent></Select></div>
          </div>
          {loading ? (<div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>) : (<div className="border rounded-md"><Table><TableHeader><TableRow><TableHead>เลขที่</TableHead><TableHead>วันที่</TableHead><TableHead>ลูกค้า</TableHead><TableHead>สถานะ</TableHead><TableHead className="text-right">ยอดสุทธิ</TableHead><TableHead className="text-right w-[100px]">จัดการ</TableHead></TableRow></TableHeader><TableBody>{paginatedDocuments.length > 0 ? paginatedDocuments.map(docItem => {
                    const displayStatus = getDocDisplayStatus(docItem);
                    const viewPath = docItem.docType === 'DELIVERY_NOTE' ? `/app/office/documents/delivery-note/${docItem.id}` : (docItem.docType === 'TAX_INVOICE' ? `/app/office/documents/tax-invoice/${docItem.id}` : `/app/documents/${docItem.id}`);
                    const editPath = (['TAX_INVOICE', 'DELIVERY_NOTE', 'QUOTATION'].includes(docItem.docType) && baseContext === 'office') ? `/app/office/documents/${docItem.docType.toLowerCase().replace('_', '-')}/new?editDocId=${docItem.id}` : (docItem.docType === 'RECEIPT' ? `/app/management/accounting/documents/receipt?tab=new&editDocId=${docItem.id}` : null);
                    return (<TableRow key={docItem.id}><TableCell className="font-mono text-xs font-bold text-primary">{docItem.docNo}</TableCell><TableCell className="text-xs">{safeFormat(new Date(docItem.docDate), APP_DATE_FORMAT)}</TableCell><TableCell className="text-sm font-medium">{docItem.customerSnapshot?.name || "-"}</TableCell><TableCell><Badge variant={displayStatus.variant} className="text-[10px]">{displayStatus.label}</Badge></TableCell><TableCell className="text-right font-bold">{docItem.grandTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</TableCell><TableCell className="text-right"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => router.push(viewPath)}><Eye className="mr-2 h-4 w-4"/> ดูรายละเอียด</DropdownMenuItem>{docItem.docType === 'BILLING_NOTE' && baseContext === 'accounting' && docItem.invoiceIds && docItem.invoiceIds.length > 0 && (<DropdownMenuItem onSelect={(e) => e.preventDefault()} onClick={() => { void openBillingReceiptPicker(docItem); }}><Receipt className="mr-2 h-4 w-4"/> ออกใบเสร็จ (เลือกบิลย่อย)</DropdownMenuItem>)}{editPath && canManageDocs && (<DropdownMenuItem onSelect={() => router.push(editPath)} disabled={docItem.status === 'PAID' && !isUserAdmin}><Edit className="mr-2 h-4 w-4"/> แก้ไข</DropdownMenuItem>)}{isUserAdmin && docItem.status === 'PAID' && !docItem.receiptDocId && (<DropdownMenuItem onSelect={(e) => { e.preventDefault(); setDocToAction(docItem); setIsRevertAlertOpen(true); }} className="text-amber-600 focus:text-amber-600 font-bold"><RotateCcw className="mr-2 h-4 w-4" /> กู้คืนเพื่อออกใบเสร็จ</DropdownMenuItem>)}{canManageDocs && docType !== 'QUOTATION' && (<DropdownMenuItem onSelect={(e) => { e.preventDefault(); setDocToAction(docItem); setIsCancelAlertOpen(true); }} disabled={docItem.status === 'CANCELLED' || (docItem.status === 'PAID' && !isUserAdmin)}><XCircle className="mr-2 h-4 w-4"/> ยกเลิก</DropdownMenuItem>)}{isUserAdmin && (<DropdownMenuItem onSelect={(e) => { e.preventDefault(); setDocToAction(docItem); setIsDeleteAlertOpen(true); }} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" /> ลบ</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></TableCell></TableRow>)}) : <TableRow><TableCell colSpan={6} className="h-24 text-center italic text-muted-foreground">ไม่พบเอกสาร</TableCell></TableRow>}</TableBody></Table></div>)}
        </CardContent>
        {totalPages > 1 && (<CardFooter className="justify-between"><span className="text-xs text-muted-foreground">หน้า {currentPage + 1} จาก {totalPages}</span><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setCurrentPage(p => p - 1)} disabled={currentPage === 0}><ChevronLeft className="h-4 w-4" /></Button><Button variant="outline" size="sm" onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage >= totalPages - 1}><ChevronRight className="h-4 w-4" /></Button></div></CardFooter>)}
      </Card>
      <AlertDialog open={isCancelAlertOpen} onOpenChange={setIsCancelAlertOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>ยกเลิกเอกสาร {docToAction?.docNo}</AlertDialogTitle><AlertDialogDescription>ระบบจะยกเลิกบิลนี้และย้อนสถานะจ๊อบเป็น "ทำเสร็จ" (DONE) เพื่อให้สามารถออกบิลใหม่ทดแทนได้ค่ะ</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={isActionLoading}>ปิด</AlertDialogCancel><AlertDialogAction onClick={confirmCancel} disabled={isActionLoading}>{isActionLoading ? <Loader2 className="h-4 w-4 animate-spin"/> : 'ยืนยันยกเลิก'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <AlertDialog open={isDeleteAlertOpen} onOpenChange={setIsDeleteAlertOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>ลบเอกสาร {docToAction?.docNo}</AlertDialogTitle><AlertDialogDescription>ต้องการลบเอกสารนี้อย่างถาวรใช่หรือไม่? การลบจะล้างลิงก์ในจ๊อบและย้อนสถานะจ๊อบกลับเป็น "ทำเสร็จ" ให้ทันทีค่ะ</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={isActionLoading}>ปิด</AlertDialogCancel><AlertDialogAction onClick={confirmDelete} disabled={isActionLoading} className="bg-destructive hover:bg-destructive/90">{isActionLoading ? <Loader2 className="h-4 w-4 animate-spin"/> : 'ยืนยันลบถาวร'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <AlertDialog open={isRevertAlertOpen} onOpenChange={setIsRevertAlertOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>กู้คืนเพื่อออกใบเสร็จ?</AlertDialogTitle><AlertDialogDescription>ระบบจะลบรายการรับเงินในสมุดบัญชีของบิลนี้ออก และเปลี่ยนสถานะกลับเป็น "รอออกใบเสร็จ" เพื่อให้คุณจัดการตามระบบใหม่ที่ถูกต้องได้ค่ะ</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={isActionLoading}>ยกเลิก</AlertDialogCancel><AlertDialogAction onClick={confirmRevertPayment} disabled={isActionLoading} className="bg-amber-600 hover:bg-amber-700">ยืนยันกู้คืน</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>

      <Dialog
        open={billingReceiptOpen}
        onOpenChange={(o) => {
          if (!o) {
            setBillingReceiptOpen(false);
            setBillingReceiptSource(null);
            setBillingLines([]);
            setBillingSelected({});
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>ออกใบเสร็จจากใบวางบิล</DialogTitle>
            <DialogDescription>
              เลือกบิลย่อยที่จะรวมในใบเสร็จ (เทียบเท่าการเลือกทีละใบในหน้าลูกหนี้) — {billingReceiptSource?.docNo}
            </DialogDescription>
          </DialogHeader>
          {billingPickLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3 py-2">
              {billingLines.map((row) => (
                <label
                  key={row.id}
                  className="flex items-center gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/40"
                >
                  <Checkbox
                    checked={!!billingSelected[row.id]}
                    onCheckedChange={(v) =>
                      setBillingSelected((prev) => ({ ...prev, [row.id]: v === true }))
                    }
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm font-medium">{row.docNo}</div>
                    <div className="text-xs text-muted-foreground">
                      ยอดคงค้าง {row.balance.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setBillingReceiptOpen(false);
                setBillingReceiptSource(null);
              }}
            >
              ปิด
            </Button>
            <Button
              disabled={
                billingPickLoading ||
                !billingReceiptSource ||
                !Object.entries(billingSelected).some(([, v]) => v)
              }
              className="bg-green-600 hover:bg-green-700"
              onClick={() => {
                if (!billingReceiptSource) return;
                const ids = Object.entries(billingSelected)
                  .filter(([, v]) => v)
                  .map(([k]) => k);
                if (ids.length === 0) return;
                const customerId =
                  billingReceiptSource.customerId || billingReceiptSource.customerSnapshot?.id || "";
                const q = new URLSearchParams();
                q.set("tab", "new");
                if (customerId) q.set("customerId", customerId);
                q.set("sourceDocIds", ids.join(","));
                router.push(`/app/management/accounting/documents/receipt?${q.toString()}`);
                setBillingReceiptOpen(false);
                setBillingReceiptSource(null);
              }}
            >
              <Receipt className="mr-2 h-4 w-4" />
              ไปหน้าออกใบเสร็จ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}