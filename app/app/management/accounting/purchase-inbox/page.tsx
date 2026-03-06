"use client";

import { useState, useMemo, useEffect, Suspense } from "react";
import { useAuth } from "@/context/auth-context";
import { useFirebase } from "@/firebase";
import { collection, query, onSnapshot, orderBy, doc, writeBatch, serverTimestamp, getDoc, type FirestoreError, where, runTransaction } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Loader2, Search, MoreHorizontal, CheckCircle, XCircle, Eye, AlertCircle } from "lucide-react";
import { WithId } from "@/firebase";
import { PurchaseClaim, AccountingAccount, PurchaseDoc, Part } from "@/lib/types";
import { safeFormat } from "@/lib/date-utils";
import Link from "next/link";

type ClaimStatus = "PENDING" | "APPROVED" | "REJECTED";

const formatCurrency = (value: number) => {
  return (value ?? 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const cashApprovalSchema = z.object({
  paidDate: z.string().min(1, "กรุณาเลือกวันที่จ่ายเงิน"),
  accountId: z.string().min(1, "กรุณาเลือกบัญชี"),
});

function ApproveCashDialog({ claim, accounts, onClose, onConfirm }: { claim: WithId<PurchaseClaim>, accounts: WithId<AccountingAccount>[], onClose: () => void, onConfirm: (formData: z.infer<typeof cashApprovalSchema>) => Promise<void> }) {
  const [isLoading, setIsLoading] = useState(false);
  const form = useForm<z.infer<typeof cashApprovalSchema>>({
    resolver: zodResolver(cashApprovalSchema),
    defaultValues: {
      paidDate: format(new Date(), "yyyy-MM-dd"),
      accountId: claim.suggestedAccountId || (accounts.find(a=>a.type==='CASH')?.id || accounts[0]?.id || ""),
    },
  });

  const handleSubmit = async (data: z.infer<typeof cashApprovalSchema>) => {
    setIsLoading(true);
    await onConfirm(data);
    setIsLoading(false);
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ยืนยันการจ่ายเงิน (รายการซื้อ)</DialogTitle>
          <DialogDescription>สำหรับเอกสาร: {claim.purchaseDocNo} ({claim.vendorNameSnapshot})</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form id="approve-cash-form" onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 py-4">
            <FormField control={form.control} name="paidDate" render={({ field }) => (<FormItem><FormLabel>วันที่จ่ายเงินจริง</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>)} />
            <FormField control={form.control} name="accountId" render={({ field }) => (
              <FormItem>
                <FormLabel>หักเงินจากบัญชี</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="เลือกบัญชี..." /></SelectTrigger></FormControl>
                  <SelectContent>{accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name} ({acc.type === 'CASH' ? 'เงินสด' : 'โอน'})</SelectItem>)}</SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <div className="p-4 border rounded-md text-center bg-primary/5">
                <p className="text-sm text-muted-foreground">ยอดเงินที่จะบันทึกจ่าย</p>
                <p className="text-2xl font-bold text-primary">{formatCurrency(claim.amountTotal)} บาท</p>
            </div>
          </form>
        </Form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>ยกเลิก</Button>
          <Button type="submit" form="approve-cash-form" disabled={isLoading}>{isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}ยืนยันการจ่ายและลงบัญชี</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectClaimDialog({ claim, onClose, onConfirm }: { claim: WithId<PurchaseClaim>, onClose: () => void, onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  
  const handleSubmit = async () => {
    if (!reason.trim()) {
      toast({ variant: "destructive", title: "กรุณากรอกเหตุผล" });
      return;
    }
    setIsLoading(true);
    await onConfirm(reason);
    setIsLoading(false);
  };
  
  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ตีกลับรายการซื้อ</DialogTitle>
          <DialogDescription>ระบุเหตุผลเพื่อให้ออฟฟิศแก้ไขเอกสาร: {claim.purchaseDocNo}</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Textarea placeholder="เช่น ยอดเงินไม่ตรงกับบิล, เลือกชื่อร้านค้าผิด..." value={reason} onChange={e => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>ยกเลิก</Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={isLoading || !reason.trim()}>{isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}ยืนยันตีกลับ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PurchaseInboxPageContent() {
  const { profile, loading: authLoading } = useAuth();
  const { db } = useFirebase();
  const { toast } = useToast();
  
  const [claims, setClaims] = useState<WithId<PurchaseClaim>[]>([]);
  const [accounts, setAccounts] = useState<WithId<AccountingAccount>[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<ClaimStatus>("PENDING");

  const [approvingClaim, setApprovingClaim] = useState<WithId<PurchaseClaim> | null>(null);
  const [rejectingClaim, setRejectingClaim] = useState<WithId<PurchaseClaim> | null>(null);

  const hasPermission = useMemo(() => {
    if (!profile) return false;
    return profile.role === 'ADMIN' || profile.role === 'MANAGER' || profile.department === 'MANAGEMENT';
  }, [profile]);

  useEffect(() => {
    if (!db || !hasPermission) {
      if (!hasPermission && !authLoading) setLoading(false);
      return;
    }
    const claimsQuery = query(collection(db, "purchaseClaims"), orderBy("updatedAt", "desc"));
    const accountsQuery = query(collection(db, "accountingAccounts"), where("isActive", "==", true));
    
    const unsubClaims = onSnapshot(claimsQuery, 
      (snap) => { setClaims(snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<PurchaseClaim>))); setLoading(false); },
      (error: FirestoreError) => {
        toast({ variant: 'destructive', title: "เกิดข้อผิดพลาดในการโหลดข้อมูล", description: error.message });
        setLoading(false);
      }
    );

    const unsubAccounts = onSnapshot(accountsQuery, 
      (snap) => { setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<AccountingAccount>))); },
      (error: FirestoreError) => {
        toast({ variant: 'destructive', title: "เกิดข้อผิดพลาดในการโหลดข้อมูลบัญชี", description: error.message });
      }
    );

    return () => { unsubClaims(); unsubAccounts(); };
  }, [db, toast, hasPermission, authLoading]);
  
  const filteredClaims = useMemo(() => {
    let filtered = claims.filter(c => c.status === activeTab);
    if (searchTerm) {
        const lowerSearch = searchTerm.toLowerCase();
        filtered = filtered.filter(c => 
            c.purchaseDocNo.toLowerCase().includes(lowerSearch) ||
            c.vendorNameSnapshot?.toLowerCase().includes(lowerSearch) ||
            c.invoiceNo?.toLowerCase().includes(lowerSearch) ||
            c.note?.toLowerCase().includes(lowerSearch)
        );
    }
    return filtered;
  }, [claims, activeTab, searchTerm]);

  const handleApproveCash = async (formData: z.infer<typeof cashApprovalSchema>) => {
    if (!db || !profile || !approvingClaim) return;
    
    const account = accounts.find(a => a.id === formData.accountId);
    if (!account) return;

    try {
        await runTransaction(db, async (transaction) => {
            const purchaseDocRef = doc(db, 'purchaseDocs', approvingClaim.purchaseDocId);
            const purchaseDocSnap = await transaction.get(purchaseDocRef);
            if (!purchaseDocSnap.exists()) throw new Error(`ไม่พบเอกสารจัดซื้อเลขที่ ${approvingClaim.purchaseDocNo}`);
            
            const claimRef = doc(db, 'purchaseClaims', approvingClaim.id);
            const entryId = `PURCHASE_${approvingClaim.purchaseDocId}`;
            const entryRef = doc(db, 'accountingEntries', entryId);

            const paymentMethod = account.type === 'CASH' ? 'CASH' : 'TRANSFER';

            // Check if entry already exists
            const entrySnap = await transaction.get(entryRef);
            if (entrySnap.exists()) throw new Error("รายการนี้เคยถูกลงบัญชีไปแล้ว");

            transaction.update(claimRef, { 
                status: 'APPROVED', 
                approvedAt: serverTimestamp(), 
                approvedByUid: profile.uid, 
                approvedByName: profile.displayName,
                updatedAt: serverTimestamp()
            });

            transaction.set(entryRef, {
                entryType: 'CASH_OUT',
                entryDate: formData.paidDate,
                amount: approvingClaim.amountTotal,
                accountId: formData.accountId,
                paymentMethod: paymentMethod,
                description: `จ่ายค่าสินค้า/อะไหล่: ${approvingClaim.vendorNameSnapshot} (บิล: ${approvingClaim.invoiceNo})`,
                sourceDocId: approvingClaim.purchaseDocId,
                sourceDocNo: approvingClaim.purchaseDocNo,
                sourceDocType: 'PURCHASE',
                vendorNameSnapshot: approvingClaim.vendorNameSnapshot,
                createdAt: serverTimestamp(),
            });

            transaction.update(purchaseDocRef, { 
                status: 'PAID', 
                approvedAt: serverTimestamp(), 
                approvedByUid: profile.uid, 
                approvedByName: profile.displayName, 
                accountingEntryId: entryId,
                updatedAt: serverTimestamp()
            });
        });
        
        toast({ title: "อนุมัติและลงบัญชีสำเร็จ" });
        setApprovingClaim(null);
    } catch (e: any) {
        toast({ variant: 'destructive', title: "เกิดข้อผิดพลาด", description: e.message });
    }
  };
  
  const handleApproveCredit = async () => {
     if (!db || !profile || !approvingClaim) return;
     try {
        await runTransaction(db, async (transaction) => {
            const purchaseDocRef = doc(db, 'purchaseDocs', approvingClaim.purchaseDocId);
            const purchaseDocSnap = await transaction.get(purchaseDocRef);
            if (!purchaseDocSnap.exists()) throw new Error(`ไม่พบเอกสารจัดซื้อเลขที่ ${approvingClaim.purchaseDocNo}`);
            const purchaseDocData = purchaseDocSnap.data() as PurchaseDoc;

            const claimRef = doc(db, 'purchaseClaims', approvingClaim.id);
            const apId = `AP_${approvingClaim.purchaseDocId}`;
            const apObligationRef = doc(db, 'accountingObligations', apId);
            
            const apSnap = await transaction.get(apObligationRef);
            if (apSnap.exists()) throw new Error("รายการเจ้าหนี้นี้เคยถูกสร้างไปแล้ว");

            transaction.update(claimRef, { 
                status: 'APPROVED', 
                approvedAt: serverTimestamp(), 
                approvedByUid: profile.uid, 
                approvedByName: profile.displayName,
                updatedAt: serverTimestamp()
            });

            transaction.set(apObligationRef, {
                id: apId,
                type: 'AP', 
                status: 'UNPAID',
                vendorId: purchaseDocData.vendorId,
                vendorShortNameSnapshot: purchaseDocData.vendorSnapshot.shortName,
                vendorNameSnapshot: purchaseDocData.vendorSnapshot.companyName,
                invoiceNo: purchaseDocData.invoiceNo,
                sourceDocType: 'PURCHASE', 
                sourceDocId: purchaseDocData.id, 
                sourceDocNo: purchaseDocData.docNo,
                docDate: purchaseDocData.docDate, 
                dueDate: purchaseDocData.dueDate || null,
                amountTotal: purchaseDocData.grandTotal, 
                amountPaid: 0, 
                balance: purchaseDocData.grandTotal,
                createdAt: serverTimestamp(), 
                updatedAt: serverTimestamp(),
            });

            transaction.update(purchaseDocRef, { 
                status: 'UNPAID', 
                approvedAt: serverTimestamp(), 
                approvedByUid: profile.uid, 
                approvedByName: profile.displayName, 
                apObligationId: apId,
                updatedAt: serverTimestamp()
            });
        });
        
        toast({ title: "อนุมัติรายการสำเร็จ" });
        setApprovingClaim(null);
     } catch (e: any) {
        toast({ variant: 'destructive', title: "เกิดข้อผิดพลาด", description: e.message });
     }
  };

  const handleRejectConfirm = async (reason: string) => {
    if (!db || !profile || !rejectingClaim) return;
    try {
        const batch = writeBatch(db);
        batch.update(doc(db, 'purchaseClaims', rejectingClaim.id), { 
            status: 'REJECTED', 
            rejectedAt: serverTimestamp(), 
            rejectedByUid: profile.uid, 
            rejectedByName: profile.displayName, 
            rejectReason: reason,
            updatedAt: serverTimestamp()
        });
        batch.update(doc(db, 'purchaseDocs', rejectingClaim.purchaseDocId), { 
            status: 'REJECTED',
            reviewRejectReason: reason,
            reviewRejectedAt: serverTimestamp(),
            reviewRejectedByName: profile.displayName,
            updatedAt: serverTimestamp()
        });
        await batch.commit();
        toast({ title: "ตีกลับรายการสำเร็จ" });
        setRejectingClaim(null);
    } catch(e: any) {
        toast({ variant: 'destructive', title: "เกิดข้อผิดพลาด", description: e.message });
    }
  };

  if (authLoading) {
    return <div className="flex justify-center p-8"><Loader2 className="animate-spin h-10 w-10 text-primary" /></div>;
  }

  if (!hasPermission) return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-4">
      <AlertCircle className="h-12 w-12 text-destructive/50" />
      <p className="text-lg">ไม่มีสิทธิ์เข้าถึง</p>
    </div>
  );

  return (
    <>
      <PageHeader title="รอตรวจสอบรายการซื้อ" description="ตรวจสอบความถูกต้องและอนุมัติยอดเพื่อลงบัญชีรายวัน" />
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ClaimStatus)}>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
          <TabsList>
            <TabsTrigger value="PENDING">รอตรวจสอบ</TabsTrigger>
            <TabsTrigger value="APPROVED">ยืนยันแล้ว</TabsTrigger>
            <TabsTrigger value="REJECTED">ตีกลับ</TabsTrigger>
          </TabsList>
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="ค้นหาชื่อร้านค้า, เลขบิล..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10"/>
          </div>
        </div>
        <Card>
          <CardContent className="pt-6 overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>วันที่อัปเดต</TableHead><TableHead>ร้านค้า</TableHead><TableHead>เลขที่เอกสาร/บิล</TableHead><TableHead className="text-right">ยอดเงิน</TableHead><TableHead>รูปแบบ</TableHead><TableHead>สถานะ</TableHead><TableHead className="text-right">จัดการ</TableHead></TableRow></TableHeader>
              <TableBody>
                {loading ? <TableRow><TableCell colSpan={7} className="text-center h-24"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
                : filteredClaims.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center h-24 text-muted-foreground italic">ไม่พบรายการ</TableCell></TableRow>
                : filteredClaims.map(claim => (
                    <TableRow key={claim.id}>
                        <TableCell className="text-xs whitespace-nowrap">{safeFormat(claim.updatedAt, "dd/MM/yy HH:mm")}</TableCell>
                        <TableCell className="font-medium">{claim.vendorNameSnapshot}</TableCell>
                        <TableCell className="text-xs">
                            <div className="font-mono">{claim.purchaseDocNo}</div>
                            <div className="text-muted-foreground italic">บิล: {claim.invoiceNo}</div>
                        </TableCell>
                        <TableCell className="text-right font-bold text-primary">{formatCurrency(claim.amountTotal)}</TableCell>
                        <TableCell><Badge variant={claim.paymentMode === 'CASH' ? 'default' : 'outline'}>{claim.paymentMode === 'CASH' ? 'เงินสด' : 'เครดิต'}</Badge></TableCell>
                        <TableCell>
                            <Badge variant={claim.status === 'APPROVED' ? 'default' : claim.status === 'REJECTED' ? 'destructive' : 'secondary'}>
                                {claim.status === 'PENDING' ? 'รอตรวจสอบ' : claim.status === 'APPROVED' ? 'ยืนยันแล้ว' : 'ตีกลับ'}
                            </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                                <Button variant="ghost" size="icon" asChild title="ดูรายละเอียด">
                                    <Link href={`/app/office/parts/purchases/${claim.purchaseDocId}`}><Eye className="h-4 w-4"/></Link>
                                </Button>
                                {claim.status === 'PENDING' && (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4"/></Button></DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem onSelect={() => setApprovingClaim(claim)} className="text-green-600 focus:text-green-600 font-semibold">
                                                <CheckCircle className="mr-2 h-4 w-4"/>ยืนยันลงบัญชี
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onSelect={() => setRejectingClaim(claim)} className="text-destructive focus:text-destructive">
                                                <XCircle className="mr-2 h-4 w-4"/>ตีกลับแก้ไข
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                )}
                            </div>
                        </TableCell>
                    </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Tabs>
      {approvingClaim?.paymentMode === 'CASH' && <ApproveCashDialog claim={approvingClaim} accounts={accounts} onClose={() => setApprovingClaim(null)} onConfirm={handleApproveCash} />}
      {approvingClaim?.paymentMode === 'CREDIT' && (
          <AlertDialog open={true} onOpenChange={(open) => !open && setApprovingClaim(null)}>
              <AlertDialogContent>
                  <AlertDialogHeader><AlertDialogTitle>ยืนยันรายการซื้อ (เครดิต)</AlertDialogTitle><AlertDialogDescription>ต้องการอนุมัติรายการนี้เพื่อบันทึกเป็นเจ้าหนี้การค้า (AP) หรือไม่?</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter>
                      <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                      <AlertDialogAction onClick={handleApproveCredit}>ยืนยันรายการ</AlertDialogAction>
                  </AlertDialogFooter>
              </AlertDialogContent>
          </AlertDialog>
      )}
      {rejectingClaim && <RejectClaimDialog claim={rejectingClaim} onClose={() => setRejectingClaim(null)} onConfirm={handleRejectConfirm} />}
    </>
  );
}

export default function PurchaseInboxPage() {
  return (
    <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>}>
      <PurchaseInboxPageContent />
    </Suspense>
  );
}
