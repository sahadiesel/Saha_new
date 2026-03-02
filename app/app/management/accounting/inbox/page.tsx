"use client";

import { useState, useMemo, useEffect, Suspense } from "react";
import { useAuth } from "@/context/auth-context";
import { useFirebase } from "@/firebase";
import { collection, query, onSnapshot, where, doc, serverTimestamp, type FirestoreError, updateDoc, runTransaction, limit, deleteField } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from 'next/navigation';
import { format } from "date-fns";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, CheckCircle, Ban, HandCoins, MoreHorizontal, Eye, AlertCircle, ExternalLink, Calendar, Info, RefreshCw, Save, Wallet, PlusCircle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { WithId } from "@/firebase";
import type { Document as DocumentType, AccountingAccount } from "@/lib/types";
import { safeFormat } from "@/lib/date-utils";
import { Label } from "@/components/ui/label";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';

const formatCurrency = (value: number) => (value ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function AccountingInboxPageContent() {
  const { profile, loading: authLoading } = useAuth();
  const { db, app: firebaseApp } = useFirebase();
  const { toast } = useToast();
  const router = useRouter();

  const [documents, setDocuments] = useState<WithId<DocumentType>[]>([]);
  const [approvedDocs, setApprovedDocs] = useState<WithId<DocumentType>[]>([]);
  const [accounts, setAccounts] = useState<WithId<AccountingAccount>[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<"receive" | "ar" | "receipts">("receive");
  const [indexCreationUrl, setIndexCreationUrl] = useState<string | null>(null);

  const [confirmingDoc, setConfirmingDoc] = useState<WithId<DocumentType> | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [disputingDoc, setDisputingDoc] = useState<WithId<DocumentType> | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [closingJobId, setClosingJobId] = useState<string | null>(null);

  const [selectedPaymentDate, setSelectedPaymentDate] = useState("");
  const [suggestedPayments, setSuggestedPayments] = useState<{accountId: string, amount: number}[]>([]);
  const [arDocToConfirm, setArDocToConfirm] = useState<WithId<DocumentType> | null>(null);

  const hasPermission = useMemo(() => {
    if (!profile) return false;
    return profile.role === 'ADMIN' || profile.role === 'MANAGER' || profile.department === 'MANAGEMENT' || profile.department === 'OFFICE';
  }, [profile]);

  useEffect(() => {
    if (!db || !hasPermission) {
      if (!hasPermission && !authLoading) setLoading(false);
      return;
    }

    // Docs needing review
    const docsQuery = query(
      collection(db, "documents"), 
      where("status", "==", "PENDING_REVIEW"),
      limit(200)
    );

    const unsubDocs = onSnapshot(docsQuery, 
      (snap) => { 
        setDocuments(snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<DocumentType>))); 
        setLoading(false);
        setIndexCreationUrl(null);
      },
      (err: FirestoreError) => { 
        if (err.code === 'permission-denied') {
          const permissionError = new FirestorePermissionError({
            path: 'documents',
            operation: 'list',
          } satisfies SecurityRuleContext);
          errorEmitter.emit('permission-error', permissionError);
        } else if (err.message?.includes('requires an index')) {
            const urlMatch = err.message.match(/https?:\/\/[^\s]+/);
            if (urlMatch) setIndexErrorUrl(urlMatch[0]);
        }
        setLoading(false); 
      }
    );

    // Docs approved but no receipt issued yet (only for cash/mixed)
    const approvedQuery = query(
        collection(db, "documents"),
        where("status", "==", "APPROVED"),
        where("receiptStatus", "==", "NONE"), // Assuming we set this or it's empty
        limit(100)
    );
    // Note: If receiptStatus is not existing, we might need a different query or client-side filter
    const unsubApproved = onSnapshot(approvedQuery, (snap) => {
        setApprovedDocs(snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<DocumentType>)).filter(d => !d.receiptDocId));
    });

    const accountsQuery = query(
      collection(db, "accountingAccounts"), 
      where("isActive", "==", true)
    );

    const unsubAccounts = onSnapshot(accountsQuery, 
      (snap) => {
          const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<AccountingAccount>));
          data.sort((a, b) => a.name.localeCompare(b.name, 'th'));
          setAccounts(data);
      },
      (err: FirestoreError) => {
        if (err.code === 'permission-denied') {
          const permissionError = new FirestorePermissionError({
            path: 'accountingAccounts',
            operation: 'list',
          } satisfies SecurityRuleContext);
          errorEmitter.emit('permission-error', permissionError);
        }
      }
    );

    return () => { unsubDocs(); unsubApproved(); unsubAccounts(); };
  }, [db, hasPermission, authLoading]);

  const filteredDocs = useMemo(() => {
    const filteredByTab = documents.filter(doc => {
      if (activeTab === 'receive') {
        return (doc.docType === 'DELIVERY_NOTE' || doc.docType === 'TAX_INVOICE') && (doc.paymentTerms === 'CASH' || !doc.paymentTerms);
      }
      if (activeTab === 'ar') {
        return (doc.docType === 'DELIVERY_NOTE' || doc.docType === 'TAX_INVOICE') && doc.paymentTerms === 'CREDIT';
      }
      if (activeTab === 'receipts') {
        return doc.docType === 'RECEIPT';
      }
      return false;
    });

    if (!searchTerm) return filteredByTab;
    const lowerSearch = searchTerm.toLowerCase();
    return filteredByTab.filter(doc => 
      doc.docNo.toLowerCase().includes(lowerSearch) ||
      (doc.customerSnapshot?.name || '').toLowerCase().includes(lowerSearch)
    );
  }, [documents, activeTab, searchTerm]);

  const callCloseJobFunction = async (jobId: string, paymentStatus: 'PAID' | 'UNPAID' = 'UNPAID') => {
    if (!firebaseApp) return;
    const functions = getFunctions(firebaseApp, 'us-central1');
    const closeJob = httpsCallable(functions, "closeJobAfterAccounting");
    setClosingJobId(jobId);
    try {
      const result: any = await closeJob({ jobId, paymentStatus });
      if (result.data?.ok) {
        toast({ title: "ย้ายงานเข้าประวัติสำเร็จ", description: "ใบงานถูกปิดและเก็บลงประวัติเรียบร้อยแล้วค่ะ" });
      }
    } catch (e: any) {
      toast({ 
        variant: "destructive", 
        title: "ย้ายเข้าประวัติไม่สำเร็จ", 
        description: "กรุณาแจ้งแอดมินเพื่อตรวจสอบข้อมูล" 
      });
    } finally {
      setClosingJobId(null);
    }
  };

  const handleOpenConfirmDialog = (doc: WithId<DocumentType>) => {
    setConfirmError(null);
    setConfirmingDoc(doc);
    setSelectedPaymentDate(doc.paymentDate || doc.docDate || format(new Date(), "yyyy-MM-dd"));
    if (doc.suggestedPayments && doc.suggestedPayments.length > 0) {
        setSuggestedPayments(doc.suggestedPayments.map(p => ({ accountId: p.accountId, amount: p.amount })));
    } else {
        const initialId = doc.receivedAccountId || doc.suggestedAccountId || accounts.find(a=>a.type==='CASH')?.id || accounts[0]?.id || "";
        setSuggestedPayments([{
            accountId: initialId,
            amount: doc.grandTotal
        }]);
    }
  };

  const handleUpdatePaymentLine = (index: number, field: string, value: any) => {
      const newPayments = [...suggestedPayments];
      (newPayments[index] as any)[field] = value;
      setSuggestedPayments(newPayments);
  };

  const handleApproveSaleDocument = async () => {
    if (!db || !profile || !confirmingDoc) return;
    setConfirmError(null);
    setIsSubmitting(true);
    const jobId = confirmingDoc.jobId;

    try {
      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, 'documents', confirmingDoc.id);
        const docSnap = await transaction.get(docRef);
        if (!docSnap.exists()) throw new Error("ไม่พบเอกสารในระบบ");
        
        if (docSnap.data().status === 'APPROVED' || docSnap.data().status === 'PAID') {
          throw new Error("รายการนี้ถูกตรวจสอบไปก่อนหน้านี้แล้ว");
        }

        const arId = `AR_${confirmingDoc.id}`;
        const arRef = doc(db, 'accountingObligations', arId);
        const customerName = confirmingDoc.customerSnapshot?.name || 'Unknown';

        // Prepare final data with inferred methods
        const finalPayments = suggestedPayments.map(p => {
            const acc = accounts.find(a => a.id === p.accountId);
            return {
                ...p,
                method: acc?.type === 'CASH' ? 'CASH' : 'TRANSFER'
            };
        });

        // Update Sale Document
        // NEW LOGIC: Just approve, do not close job yet for cash sales
        transaction.update(docRef, { 
            status: 'APPROVED', 
            arStatus: 'UNPAID', 
            paymentSummary: {
                paidTotal: 0,
                balance: confirmingDoc.grandTotal,
                paymentStatus: 'UNPAID'
            },
            suggestedPayments: finalPayments,
            paymentDate: selectedPaymentDate,
            updatedAt: serverTimestamp()
        });

        // Set AR Obligation as UNPAID
        transaction.set(arRef, {
          id: arId,
          type: 'AR', 
          status: 'UNPAID', 
          sourceDocType: confirmingDoc.docType, 
          sourceDocId: confirmingDoc.id, 
          sourceDocNo: confirmingDoc.docNo,
          amountTotal: confirmingDoc.grandTotal, 
          amountPaid: 0, 
          balance: confirmingDoc.grandTotal,
          createdAt: serverTimestamp(), 
          updatedAt: serverTimestamp(), 
          customerNameSnapshot: customerName,
          jobId: jobId || null,
          dueDate: confirmingDoc.dueDate || null,
        });
      });

      toast({ 
        title: "ตรวจสอบความถูกต้องสำเร็จ", 
        description: "กรุณาออกใบเสร็จรับเงินเพื่อบันทึกการรับเงินเข้าบัญชีจริง และงานจะปิดเมื่อยืนยันรับเงินค่ะ" 
      });
      
      setConfirmingDoc(null);
    } catch(e: any) {
      if (e.code === 'permission-denied') {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: 'documents/' + (confirmingDoc?.id || 'unknown'),
          operation: 'write',
        }));
      } else {
        setConfirmError(e.message || "Unknown error");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateAR = async (docObj: WithId<DocumentType>) => {
    if (!db || !profile) return;
    setIsSubmitting(true);
    const arId = `AR_${docObj.id}`;
    const arRef = doc(db, 'accountingObligations', arId);
    const docRef = doc(db, 'documents', docObj.id);
    const customerName = docObj.customerSnapshot?.name || 'Unknown';

    try {
      await runTransaction(db, async (transaction) => {
        transaction.set(arRef, {
          id: arId,
          type: 'AR', 
          status: 'UNPAID', 
          sourceDocType: docObj.docType, 
          sourceDocId: docObj.id, 
          sourceDocNo: docObj.docNo,
          amountTotal: docObj.grandTotal, 
          amountPaid: 0, 
          balance: docObj.grandTotal,
          createdAt: serverTimestamp(), 
          updatedAt: serverTimestamp(), 
          customerNameSnapshot: customerName,
          jobId: docObj.jobId || null,
          dueDate: docObj.dueDate || null,
        });
        transaction.update(docRef, {
          status: 'UNPAID',
          arStatus: 'UNPAID',
          paymentSummary: { paidTotal: 0, balance: docObj.grandTotal, paymentStatus: 'UNPAID' },
          arObligationId: arId,
          updatedAt: serverTimestamp()
        });
      });
      toast({ title: "ตั้งยอดลูกหนี้สำเร็จ" });
      if (docObj.jobId) callCloseJobFunction(docObj.jobId, 'UNPAID');
      setArDocToConfirm(null);
    } catch(e: any) {
      errorEmitter.emit('permission-error', new FirestorePermissionError({ path: docRef.path, operation: 'write' }));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDispute = async () => {
    if (!db || !disputingDoc || !disputeReason.trim()) return;
    setIsSubmitting(true);
    const docRef = doc(db, 'documents', disputingDoc.id);
    const updateData = {
      status: 'REJECTED',
      dispute: { isDisputed: true, reason: disputeReason, createdAt: serverTimestamp() },
      updatedAt: serverTimestamp()
    };
    try {
      await updateDoc(docRef, updateData);
      toast({ title: "ส่งเอกสารกลับเพื่อแก้ไขแล้ว" });
      setDisputingDoc(null);
      setDisputeReason("");
    } catch(e: any) {
      errorEmitter.emit('permission-error', new FirestorePermissionError({ path: docRef.path, operation: 'update', requestResourceData: updateData }));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="animate-spin h-10 w-10 text-primary" /></div>;
  }

  if (!hasPermission) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-4">
        <AlertCircle className="h-12 w-12 text-destructive/50" />
        <p className="text-lg">ไม่มีสิทธิ์เข้าถึง</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Inbox บัญชี (ตรวจสอบรายการขาย)" description="ตรวจสอบความถูกต้องของบิลก่อนลงสมุดบัญชีรายวัน" />
      
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
          <TabsList>
            <TabsTrigger value="receive">รอตรวจสอบ (Cash/Mixed)</TabsTrigger>
            <TabsTrigger value="ar">รอตั้งลูกหนี้ (Credit)</TabsTrigger>
            <TabsTrigger value="receipts">รอยืนยันใบเสร็จ</TabsTrigger>
          </TabsList>
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="ค้นหาเลขที่เอกสาร, ชื่อลูกค้า..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10"/>
          </div>
        </div>
        <Card>
          <CardContent className="pt-6">
            <TabsContent value="receive" className="mt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>วันที่</TableHead>
                    <TableHead>ลูกค้า</TableHead>
                    <TableHead>เอกสาร</TableHead>
                    <TableHead>ยอดเงิน</TableHead>
                    <TableHead className="text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={5} className="text-center h-24"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
                  ) : filteredDocs.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center h-24 text-muted-foreground italic">ไม่มีรายการรอตรวจสอบ (Cash)</TableCell></TableRow>
                  ) : filteredDocs.map(doc => (
                    <TableRow key={doc.id}>
                      <TableCell>{safeFormat(new Date(doc.docDate), "dd/MM/yy")}</TableCell>
                      <TableCell>{doc.customerSnapshot?.name || '--'}</TableCell>
                      <TableCell>
                        <div className="font-medium">{doc.docNo}</div>
                        <div className="text-xs text-muted-foreground">{doc.docType === 'TAX_INVOICE' ? 'ใบกำกับภาษี' : 'ใบส่งของชั่วคราว'}</div>
                        {doc.jobId && <Badge variant="outline" className="text-[8px] h-4 mt-1 bg-blue-50">มี Job ผูกอยู่</Badge>}
                      </TableCell>
                      <TableCell className="font-bold text-primary">{formatCurrency(doc.grandTotal)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {closingJobId === doc.jobId ? (
                            <Badge variant="outline" className="animate-pulse"><Loader2 className="h-3 w-3 mr-1 animate-spin"/> ปิดจ๊อบ...</Badge>
                          ) : (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => router.push(`/app/office/documents/${doc.id}`)}>
                                  <Eye className="mr-2 h-4 w-4"/> ดูรายละเอียด
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => handleOpenConfirmDialog(doc)} className="text-green-600 focus:text-green-600 font-bold">
                                  <CheckCircle className="mr-2 h-4 w-4"/> ยืนยันตรวจสอบ
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setDisputingDoc(doc)} className="text-destructive focus:text-destructive">
                                  <Ban className="mr-2 h-4 w-4"/> ตีกลับให้แก้ไข
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
            </TabsContent>
            <TabsContent value="ar" className="mt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>วันที่</TableHead>
                    <TableHead>ลูกค้า</TableHead>
                    <TableHead>เอกสาร</TableHead>
                    <TableHead>ยอดเงิน</TableHead>
                    <TableHead className="text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={5} className="text-center h-24"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
                  ) : filteredDocs.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center h-24 text-muted-foreground italic">ไม่มีรายการรอตั้งลูกหนี้ (Credit)</TableCell></TableRow>
                  ) : filteredDocs.map(doc => (
                    <TableRow key={doc.id}>
                      <TableCell>{safeFormat(new Date(doc.docDate), "dd/MM/yy")}</TableCell>
                      <TableCell>{doc.customerSnapshot?.name || '--'}</TableCell>
                      <TableCell>
                        <div className="font-medium">{doc.docNo}</div>
                        <div className="text-xs text-muted-foreground">{doc.docType === 'TAX_INVOICE' ? 'ใบกำกับภาษี' : 'ใบส่งของชั่วคราว'}</div>
                        {doc.jobId && <Badge variant="outline" className="text-[8px] h-4 mt-1 bg-blue-50">มี Job ผูกอยู่</Badge>}
                      </TableCell>
                      <TableCell className="font-bold text-amber-600">{formatCurrency(doc.grandTotal)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {closingJobId === doc.jobId ? (
                            <Badge variant="outline" className="animate-pulse"><Loader2 className="h-3 w-3 mr-1 animate-spin"/> ปิดจ๊อบ...</Badge>
                          ) : (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => router.push(`/app/office/documents/${doc.id}`)}>
                                  <Eye className="mr-2 h-4 w-4"/> ดูรายละเอียด
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setArDocToConfirm(doc)} disabled={isSubmitting} className="font-bold text-amber-600 focus:text-amber-600">
                                  <HandCoins className="mr-2 h-4 w-4"/> ยืนยันตั้งลูกหนี้
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setDisputingDoc(doc)} className="text-destructive focus:text-destructive">
                                  <Ban className="mr-2 h-4 w-4"/> ตีกลับให้แก้ไข
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
            </TabsContent>
            <TabsContent value="receipts" className="mt-0 space-y-8">
              {/* Added a section for Approved Invoices to provide clear next steps */}
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                    <h3 className="font-bold text-lg flex items-center gap-2"><Info className="h-5 w-5 text-primary"/> 1. บิลที่ตรวจสอบแล้ว (รอดำเนินการออกใบเสร็จ)</h3>
                    <Badge variant="outline" className="bg-primary/5">{approvedDocs.length} รายการ</Badge>
                </div>
                <Table>
                    <TableHeader className="bg-muted/30">
                        <TableRow>
                            <TableHead>เลขที่บิล</TableHead>
                            <TableHead>ลูกค้า</TableHead>
                            <TableHead className="text-right">ยอดเงิน</TableHead>
                            <TableHead className="text-right">จัดการ</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {approvedDocs.length > 0 ? approvedDocs.map(doc => (
                            <TableRow key={doc.id}>
                                <TableCell className="font-mono text-xs">{doc.docNo}</TableCell>
                                <TableCell className="text-sm">{doc.customerSnapshot?.name}</TableCell>
                                <TableCell className="text-right font-bold">{formatCurrency(doc.grandTotal)}</TableCell>
                                <TableCell className="text-right">
                                    <Button asChild size="sm" variant="default" className="h-8">
                                        <Link href={`/app/management/accounting/documents/receipt?customerId=${doc.customerId}&sourceDocId=${doc.id}`}>
                                            <PlusCircle className="mr-2 h-4 w-4"/> ออกใบเสร็จ
                                        </Link>
                                    </Button>
                                </TableCell>
                            </TableRow>
                        )) : (
                            <TableRow><TableCell colSpan={4} className="h-20 text-center text-muted-foreground italic text-xs">ไม่มีบิลค้างในขั้นตอนนี้</TableCell></TableRow>
                        )}
                    </TableBody>
                </Table>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                    <h3 className="font-bold text-lg flex items-center gap-2"><CheckCircle className="h-5 w-5 text-green-600"/> 2. ใบเสร็จที่รอตรวจสอบรับเงินจริง</h3>
                </div>
                <Table>
                    <TableHeader>
                    <TableRow>
                        <TableHead>วันที่</TableHead>
                        <TableHead>ลูกค้า</TableHead>
                        <TableHead>เลขที่ใบเสร็จ</TableHead>
                        <TableHead>ยอดเงิน</TableHead>
                        <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                    </TableHeader>
                    <TableBody>
                    {filteredDocs.length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="text-center h-24 text-muted-foreground italic">ไม่มีใบเสร็จที่รอยืนยันเงินเข้า</TableCell></TableRow>
                    ) : filteredDocs.map(doc => (
                        <TableRow key={doc.id}>
                        <TableCell>{safeFormat(new Date(doc.docDate), "dd/MM/yy")}</TableCell>
                        <TableCell>{doc.customerSnapshot?.name || '--'}</TableCell>
                        <TableCell>
                            <div className="font-medium">{doc.docNo}</div>
                            <div className="text-xs text-muted-foreground">อ้างอิง: {doc.referencesDocIds?.[0] || '-'}</div>
                        </TableCell>
                        <TableCell className="font-bold text-green-600">{formatCurrency(doc.grandTotal)}</TableCell>
                        <TableCell className="text-right">
                            <Button variant="outline" size="sm" onClick={() => router.push(`/app/management/accounting/documents/receipt/${doc.id}/confirm`)}>
                            <CheckCircle className="mr-2 h-4 w-4 text-green-600"/> ยืนยันรับเงิน
                            </Button>
                        </TableCell>
                        </TableRow>
                    ))}
                    </TableBody>
                </Table>
              </div>
            </TabsContent>
          </CardContent>
        </Card>
      </Tabs>

      <Dialog open={!!confirmingDoc} onOpenChange={(open) => !open && !isSubmitting && setConfirmingDoc(null)}>
        <DialogContent onInteractOutside={(e) => isSubmitting && e.preventDefault()} className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle>ตรวจสอบรายการขาย</DialogTitle>
            <DialogDescription>
                ตรวจสอบความถูกต้องของบิลและช่องทางการรับเงิน ก่อนส่งไปขั้นตอนออกใบเสร็จ
            </DialogDescription>
          </DialogHeader>
          
          {confirmError && (
            <div className="px-6 py-2">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>บันทึกไม่สำเร็จ</AlertTitle>
                <AlertDescription className="text-xs">{confirmError}</AlertDescription>
              </Alert>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
              <div className="p-4 bg-primary/5 rounded-lg border border-primary/20 text-center">
                <p className="text-sm text-muted-foreground">ยอดเงินรวมบิล</p>
                <p className="text-3xl font-black text-primary">฿{formatCurrency(confirmingDoc?.grandTotal ?? 0)}</p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2"><Calendar className="h-4 w-4"/> วันที่ออกเอกสาร</Label>
                    <Input type="date" className="w-40" value={selectedPaymentDate} onChange={(e) => setSelectedPaymentDate(e.target.value)} disabled={isSubmitting} />
                </div>

                <div className="space-y-3">
                    <Label className="flex items-center gap-2"><Wallet className="h-4 w-4" /> รายการรับเงิน (ตามที่ออฟฟิศระบุ)</Label>
                    <div className="border rounded-md overflow-hidden">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead>บัญชี (Account)</TableHead>
                                    <TableHead className="text-right">จำนวนเงิน</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {suggestedPayments.map((p, index) => (
                                    <TableRow key={index}>
                                        <TableCell className="p-2">
                                            <Select value={p.accountId} onValueChange={(v) => handleUpdatePaymentLine(index, 'accountId', v)} disabled={isSubmitting}>
                                                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="เลือกบัญชี..." /></SelectTrigger>
                                                <SelectContent>
                                                    {accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name} ({acc.type === 'CASH' ? 'เงินสด' : 'โอน'})</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                        <TableCell className="p-2 text-right">
                                            <Input 
                                                type="number" 
                                                className="h-8 text-right font-bold text-xs" 
                                                value={p.amount || ''} 
                                                onChange={(e) => handleUpdatePaymentLine(index, 'amount', parseFloat(e.target.value) || 0)} 
                                                disabled={isSubmitting} 
                                            />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </div>

                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="flex items-start gap-2 text-xs text-amber-800">
                        <Info className="h-4 w-4 mt-0.5 shrink-0" />
                        <div className="space-y-1">
                            <p className="font-bold">ขั้นตอนการบันทึกบัญชี</p>
                            <p>เมื่อกดปุ่มด้านล่าง ระบบจะบันทึกสถานะบิลว่า "ตรวจสอบแล้ว" และเปิดให้ไปออกใบเสร็จรับเงินได้</p>
                            <p className="text-destructive font-bold">เงินจะยังไม่เข้าบัญชีจริง จนกว่าใบเสร็จจะถูกสร้างและยืนยันรับเงินในภายหลังค่ะ</p>
                        </div>
                    </div>
                </div>
              </div>
          </div>
          <DialogFooter className="gap-2 bg-muted/20 p-6 border-t">
            <Button variant="outline" onClick={() => setConfirmingDoc(null)} disabled={isSubmitting}>ยกเลิก</Button>
            <Button onClick={handleApproveSaleDocument} disabled={isSubmitting || suggestedPayments.some(p => p.amount > 0 && !p.accountId)} className="bg-green-600 hover:bg-green-700 text-white min-w-[200px]">
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 animate-spin h-4 w-4" />
                    กำลังบันทึก...
                  </>
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    ยืนยันความถูกต้องของรายการ
                  </>
                )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!disputingDoc} onOpenChange={(open) => !open && setDisputingDoc(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ส่งเอกสารกลับเพื่อแก้ไข</DialogTitle>
            <DialogDescription>สำหรับเอกสารเลขที่: {disputingDoc?.docNo}</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <Label htmlFor="reason">ระบุเหตุผลที่ไม่ถูกต้อง</Label>
            <Textarea id="reason" placeholder="เช่น ยอดเงินไม่ตรง, เลือกประเภทลูกค้าผิด..." value={disputeReason} onChange={e => setDisputeReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisputingDoc(null)} disabled={isSubmitting}>ยกเลิก</Button>
            <Button variant="destructive" onClick={handleDispute} disabled={isSubmitting || !disputeReason}>{isSubmitting && <Loader2 className="mr-2 animate-spin" />}ยืนยันตีกลับ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!arDocToConfirm} onOpenChange={(open) => !open && setArDocToConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันตั้งยอดลูกหนี้</AlertDialogTitle>
            <AlertDialogDescription>
              ยืนยันการตั้งยอดค้างชำระ (AR) จำนวน {formatCurrency(arDocToConfirm?.grandTotal || 0)} บาท สำหรับลูกค้า {arDocToConfirm?.customerSnapshot?.name}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction onClick={() => arDocToConfirm && handleCreateAR(arDocToConfirm)}>ตกลง</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function AccountingInboxPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>}>
            <AccountingInboxPageContent />
        </Suspense>
    );
}
