
"use client";

import { useEffect, useMemo, useState, Suspense, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { doc, collection, query, where, serverTimestamp, getDocs, getDoc, runTransaction } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Save, ArrowLeft, Calculator, Info, AlertCircle, CalendarDays, Wallet, Percent } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { Document as DocumentType, AccountingAccount, AccountingObligation } from "@/lib/types";
import type { WithId } from "@/firebase/firestore/use-collection";
import { safeFormat } from "@/lib/date-utils";
import { cn, sanitizeForFirestore } from "@/lib/utils";
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
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

const confirmReceiptSchema = z.object({
  accountId: z.string().min(1, "กรุณาเลือกบัญชีที่รับเงิน"),
  paymentDate: z.string().min(1, "กรุณาเลือกวันที่รับเงินจริง"),
  netReceivedTotal: z.coerce.number().min(0.01, "ยอดรับสุทธิต้องมากกว่า 0"),
  whtPercent: z.coerce.number().min(0).max(100).default(0),
});

type ConfirmReceiptFormData = z.infer<typeof confirmReceiptSchema>;

const formatCurrency = (value: number) => value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ConfirmReceiptPageContent() {
  const { receiptId } = useParams();
  const router = useRouter();
  const { db, app: firebaseApp } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [receipt, setReceipt] = useState<WithId<DocumentType> | null>(null);
  const [invoices, setInvoices] = useState<WithId<DocumentType>[]>([]);
  const [obligations, setObligations] = useState<Record<string, WithId<AccountingObligation>>>({});
  const [accounts, setAccounts] = useState<WithId<AccountingAccount>[]>([]);
  
  const [showFinalConfirm, setShowFinalConfirm] = useState(false);
  const [pendingFormData, setPendingFormData] = useState<ConfirmReceiptFormData | null>(null);

  const form = useForm<ConfirmReceiptFormData>({
    resolver: zodResolver(confirmReceiptSchema),
    defaultValues: {
      paymentDate: format(new Date(), 'yyyy-MM-dd'),
      netReceivedTotal: 0,
      whtPercent: 0,
      accountId: "",
    },
  });

  const watchedNetReceivedTotal = useWatch({ control: form.control, name: "netReceivedTotal" }) || 0;
  const watchedWhtPercent = useWatch({ control: form.control, name: "whtPercent" }) || 0;

  useEffect(() => {
    if (!db || !receiptId) return;

    const fetchData = async () => {
      setIsLoading(true);
      try {
        const receiptRef = doc(db, 'documents', receiptId as string);
        const receiptSnap = await getDoc(receiptRef);

        if (!receiptSnap.exists() || receiptSnap.data().docType !== 'RECEIPT') {
          throw new Error("ไม่พบข้อมูลใบเสร็จรับเงินที่ต้องการ");
        }

        const receiptData = { id: receiptSnap.id, ...receiptSnap.data() } as WithId<DocumentType>;
        if (receiptData.status === 'CONFIRMED' || receiptData.receiptStatus === 'CONFIRMED') {
          setError("ใบเสร็จนี้ถูกยืนยันการรับเงินไปก่อนหน้านี้แล้ว");
          setIsLoading(false);
          return;
        }
        setReceipt(receiptData);

        let invoiceIds = receiptData.referencesDocIds || [];
        let fetchedInvoices: WithId<DocumentType>[] = [];
        let fetchedObligations: Record<string, WithId<AccountingObligation>> = {};

        if (invoiceIds.length > 0) {
            const sourceDocsQuery = query(collection(db, "documents"), where("__name__", "in", invoiceIds));
            const sourceDocsSnap = await getDocs(sourceDocsQuery);
            
            let allRelevantInvoiceIds: string[] = [];
            sourceDocsSnap.docs.forEach(d => {
                if (d.data().docType === 'BILLING_NOTE') {
                    allRelevantInvoiceIds = [...allRelevantInvoiceIds, ...(d.data().invoiceIds || [])];
                } else {
                    allRelevantInvoiceIds.push(d.id);
                }
            });

            if (allRelevantInvoiceIds.length > 0) {
                const invoicesQuery = query(collection(db, "documents"), where("__name__", "in", allRelevantInvoiceIds));
                const obligationsQuery = query(collection(db, 'accountingObligations'), where('sourceDocId', 'in', allRelevantInvoiceIds));
                
                const [invoicesSnap, obligationsSnap] = await Promise.all([
                    getDocs(invoicesQuery),
                    getDocs(obligationsQuery),
                ]);

                fetchedInvoices = invoicesSnap.docs.map(d => ({id: d.id, ...d.data()}) as WithId<DocumentType>);
                fetchedObligations = Object.fromEntries(obligationsSnap.docs.map(d => [d.data().sourceDocId, {id: d.id, ...d.data()} as WithId<AccountingObligation>]));
            }
        }

        setInvoices(fetchedInvoices);
        setObligations(fetchedObligations);

        const accountsQuery = query(collection(db, "accountingAccounts"), where("isActive", "==", true));
        const accountsSnap = await getDocs(accountsQuery);
        const accountsData = accountsSnap.docs.map(d => ({id: d.id, ...d.data()}) as WithId<AccountingAccount>);
        setAccounts(accountsData);
        
        // Auto-calculate initial Net Received
        const initialNetTotal = fetchedInvoices.reduce((sum, inv) => {
            const gross = obligations[inv.id]?.balance ?? inv.paymentSummary?.balance ?? inv.grandTotal;
            const whtBase = inv.withTax ? (gross / 1.07) : gross;
            // Default check: if doc is TAX_INVOICE, maybe user wants 3%
            const initialWhtRate = inv.docType === 'TAX_INVOICE' ? 0.03 : 0; 
            return sum + (gross - (whtBase * initialWhtRate));
        }, 0);

        form.reset({
            accountId: receiptData.receivedAccountId || accountsData[0]?.id || "",
            paymentDate: receiptData.paymentDate || format(new Date(), "yyyy-MM-dd"),
            netReceivedTotal: Math.round(initialNetTotal * 100) / 100,
            whtPercent: fetchedInvoices.some(inv => inv.docType === 'TAX_INVOICE') ? 3 : 0
        });

      } catch (err: any) {
        setError(err.message || "เกิดข้อผิดพลาดในการโหลดข้อมูล");
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [db, receiptId, form]);
  
  // Calculate allocations for display
  const calculatedAllocations = useMemo(() => {
    return invoices.map(inv => {
        const ob = obligations[inv.id];
        const gross = Math.round((ob?.balance ?? inv.paymentSummary?.balance ?? inv.grandTotal) * 100) / 100;
        const whtRate = watchedWhtPercent / 100;
        const whtBase = inv.withTax ? (gross / 1.07) : gross;
        const whtAmount = Math.round(whtBase * whtRate * 100) / 100;
        const netCash = Math.round((gross - whtAmount) * 100) / 100;

        return {
            invoiceId: inv.id,
            invoiceDocNo: inv.docNo,
            withTax: inv.withTax ?? false,
            gross,
            whtAmount,
            netCash
        };
    });
  }, [invoices, obligations, watchedWhtPercent]);

  const totals = useMemo(() => {
    const totalNetCalculated = Math.round(calculatedAllocations.reduce((sum, a) => sum + a.netCash, 0) * 100) / 100;
    const totalWht = Math.round(calculatedAllocations.reduce((sum, a) => sum + a.whtAmount, 0) * 100) / 100;
    const totalGross = Math.round(calculatedAllocations.reduce((sum, a) => sum + a.gross, 0) * 100) / 100;
    const unallocated = Math.round((watchedNetReceivedTotal - totalNetCalculated) * 100) / 100;
    return { totalNetCalculated, totalWht, totalGross, unallocated };
  }, [calculatedAllocations, watchedNetReceivedTotal]);

  const executeSubmit = async (data: ConfirmReceiptFormData) => {
    if (!db || !profile || !receipt) return;
    setIsLoading(true);
    const jobsToArchive: string[] = [];

    try {
        await runTransaction(db, async (transaction) => {
            const receiptRef = doc(db, 'documents', receipt.id);
            const receiptSnap = await transaction.get(receiptRef);
            
            if (!receiptSnap.exists()) throw new Error("ไม่พบใบเสร็จในระบบ");
            const rData = receiptSnap.data();
            
            if (rData.status === 'CONFIRMED' || rData.accountingEntryId) {
                throw new Error("รายการนี้ถูกยืนยันไปก่อนหน้านี้แล้ว");
            }

            const account = accounts.find(a => a.id === data.accountId);
            if (!account) throw new Error("ไม่พบข้อมูลบัญชีที่เลือก");
            const paymentMethod = account.type === 'CASH' ? 'CASH' : 'TRANSFER';

            const arPaymentId = `ARPAY_${receipt.id}`;
            const arPaymentRef = doc(db, 'arPayments', arPaymentId);
            const entryId = `RECEIPT_${receipt.id}`;
            const entryRef = doc(db, 'accountingEntries', entryId);

            const customerName = rData.customerSnapshot?.name || 'ลูกค้าทั่วไป';
            const receiptDocNo = rData.docNo || "Unknown";

            transaction.set(arPaymentRef, sanitizeForFirestore({
                id: arPaymentId,
                receiptId: receipt.id,
                customerId: receipt.customerId,
                paymentDate: data.paymentDate,
                netReceivedTotal: data.netReceivedTotal,
                withholdingTotal: totals.totalWht,
                allocations: calculatedAllocations.map(a => ({
                    invoiceId: a.invoiceId,
                    invoiceDocNo: a.invoiceDocNo,
                    netCashApplied: a.netCash,
                    withholdingAmount: a.whtAmount,
                    grossApplied: a.gross,
                })),
                createdAt: serverTimestamp(),
            }));
            
            transaction.set(entryRef, sanitizeForFirestore({
                entryType: 'RECEIPT',
                entryDate: data.paymentDate,
                amount: data.netReceivedTotal,
                accountId: data.accountId,
                paymentMethod: paymentMethod,
                categoryMain: 'เก็บเงินลูกหนี้',
                categorySub: 'รับชำระตามบิลในระบบ',
                description: `รับเงินตามใบเสร็จ: ${receiptDocNo} (${customerName})`,
                sourceDocType: 'RECEIPT',
                sourceDocId: receipt.id,
                sourceDocNo: receiptDocNo,
                customerNameSnapshot: customerName,
                createdAt: serverTimestamp(),
            }));
            
            transaction.update(receiptRef, sanitizeForFirestore({
                status: 'CONFIRMED',
                receiptStatus: 'CONFIRMED',
                accountingEntryId: entryId,
                confirmedPayment: {
                    accountId: data.accountId,
                    method: paymentMethod,
                    receivedDate: data.paymentDate,
                    netReceivedTotal: data.netReceivedTotal,
                    withholdingTotal: totals.totalWht,
                    arPaymentId: arPaymentId,
                },
                updatedAt: serverTimestamp(),
            }));
            
            const parentReferenceIds = rData.referencesDocIds || [];
            for (const refId of parentReferenceIds) {
                const docRef = doc(db, 'documents', refId);
                const dSnap = await transaction.get(docRef);
                if (dSnap.exists()) {
                    const dData = dSnap.data();
                    transaction.update(docRef, { status: 'PAID', updatedAt: serverTimestamp() });
                }
            }

            for (const a of calculatedAllocations) {
                const ob = obligations[a.invoiceId];
                if (ob) {
                    const newAmountPaid = Math.round(((ob.amountPaid || 0) + a.gross) * 100) / 100;
                    const newBalance = Math.max(0, Math.round((ob.amountTotal - newAmountPaid) * 100) / 100);
                    const newStatus = newBalance <= 0.05 ? 'PAID' : 'PARTIAL';
                    
                    transaction.update(doc(db, 'accountingObligations', ob.id), {
                        amountPaid: newAmountPaid,
                        balance: newBalance,
                        status: newStatus,
                        lastPaymentDate: data.paymentDate,
                        paidOffDate: newStatus === 'PAID' ? data.paymentDate : null,
                        updatedAt: serverTimestamp(),
                    });

                    transaction.update(doc(db, 'documents', a.invoiceId), {
                        status: newStatus,
                        arStatus: newStatus,
                        paymentSummary: {
                            paidTotal: newAmountPaid,
                            balance: newBalance,
                            paymentStatus: newStatus
                        },
                        updatedAt: serverTimestamp(),
                    });

                    if (newStatus === 'PAID' && ob.jobId) {
                        const jobRef = doc(db, 'jobs', ob.jobId);
                        const jobSnap = await transaction.get(jobRef);
                        if (jobSnap.exists()) {
                            transaction.update(jobRef, { status: 'CLOSED', updatedAt: serverTimestamp(), lastActivityAt: serverTimestamp() });
                            transaction.set(doc(collection(jobRef, 'activities')), {
                                text: `ฝ่ายบัญชียืนยันรับเงินตามใบเสร็จ ${receiptDocNo} และปิดงานเรียบร้อยค่ะ`,
                                userName: profile.displayName,
                                userId: profile.uid,
                                createdAt: serverTimestamp()
                            });
                            jobsToArchive.push(ob.jobId);
                        }
                    }
                }
            }
        });
        
        if (jobsToArchive.length > 0) {
            const functions = getFunctions(firebaseApp!, 'us-central1');
            const closeJob = httpsCallable(functions, "closeJobAfterAccounting");
            for (const jId of Array.from(new Set(jobsToArchive))) {
                await closeJob({ jobId: jId, paymentStatus: 'PAID' }).catch(e => console.error("Archive error", e));
            }
        }

        toast({ title: "ยืนยันการรับเงินสำเร็จ", description: "ข้อมูลบัญชีและลูกหนี้ถูกปรับปรุงเรียบร้อยแล้วค่ะ" });
        router.push('/app/management/accounting/inbox');
    } catch (err: any) {
        toast({ variant: 'destructive', title: "ไม่สามารถยืนยันได้", description: err.message });
    } finally {
        setIsLoading(false);
    }
  };

  const handlePreSubmit = (data: ConfirmReceiptFormData) => {
      if (Math.abs(totals.unallocated) > 0.06) {
          toast({ variant: "destructive", title: "ยอดเงินไม่ลงตัว", description: "ยอดเงินที่ได้รับจริงไม่ตรงกับยอดในบิลที่จัดสรร กรุณาตรวจสอบอีกครั้งค่ะ" });
          return;
      }
      setPendingFormData(data);
      setShowFinalConfirm(true);
  }

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>;
  if (error) return <PageHeader title="เกิดข้อผิดพลาด" description={error} />;

  return (
    <>
        <PageHeader title="ยืนยันรับเงินเข้าบัญชี" description={`สำหรับใบเสร็จเลขที่: ${receipt?.docNo}`} />
        <Form {...form}>
            <form onSubmit={form.handleSubmit(handlePreSubmit)} className="space-y-6">
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => router.back()}><ArrowLeft className="mr-2 h-4 w-4"/> กลับ</Button>
                    <Button type="submit" disabled={isLoading} className="bg-green-600 hover:bg-green-700 font-bold">
                        <Save className="mr-2 h-4 w-4"/> ยืนยันข้อมูล
                    </Button>
                </div>
                
                <Card>
                    <CardHeader><CardTitle className="text-base">1. สรุปยอดเงินโอน (Actual Received)</CardTitle></CardHeader>
                    <CardContent className="space-y-6">
                        <div className="grid md:grid-cols-2 gap-6">
                            <FormField
                              control={form.control}
                              name="paymentDate"
                              render={({ field }) => (
                                <FormItem className="flex flex-col">
                                  <FormLabel>วันที่รับเงินจริง</FormLabel>
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <FormControl>
                                        <Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal h-10", !field.value && "text-muted-foreground")}>
                                          {field.value ? format(parseISO(field.value), "dd/MM/yyyy") : <span>เลือกวันที่</span>}
                                          <CalendarDays className="ml-auto h-4 w-4 opacity-50" />
                                        </Button>
                                      </FormControl>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                      <Calendar mode="single" selected={field.value ? parseISO(field.value) : undefined} onSelect={(date) => field.onChange(date ? format(date, "yyyy-MM-dd") : "")} initialFocus />
                                    </PopoverContent>
                                  </Popover>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField name="accountId" control={form.control} render={({ field }) => (
                              <FormItem>
                                <FormLabel>เข้าบัญชี</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl><SelectTrigger><SelectValue placeholder="เลือกบัญชี..." /></SelectTrigger></FormControl>
                                  <SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.type === 'CASH' ? 'เงินสด' : 'โอน'})</SelectItem>)}</SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )} />
                        </div>

                        <div className="grid md:grid-cols-2 gap-6">
                            <FormField name="netReceivedTotal" control={form.control} render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-primary font-bold">ยอดเงินที่ได้รับจริง (ยอดโอน / เงินสด)</FormLabel>
                                    <FormControl>
                                        <div className="relative">
                                            <Input type="number" {...field} className="text-xl font-black border-primary/50 pl-10 h-12" />
                                            <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-primary/50" />
                                        </div>
                                    </FormControl>
                                    <FormDescription className="text-[10px]">ยอด "รวมบิล - ภาษีหัก ณ ที่จ่าย" (WHT) ที่ลูกค้าจ่ายมาให้เราค่ะ</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )} />

                            <FormField name="whtPercent" control={form.control} render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-amber-600 font-bold">หัก ณ ที่จ่าย (%)</FormLabel>
                                    <FormControl>
                                        <div className="relative">
                                            <Input type="number" step="any" {...field} className="text-xl font-bold border-amber-300 pl-10 h-12" />
                                            <Percent className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-amber-400" />
                                        </div>
                                    </FormControl>
                                    <FormDescription className="text-[10px]">ระบุ % เพื่อให้ระบบคำนวณยอดหักภาษีอัตโนมัติ (ปกติคือ 3%)</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row justify-between items-center">
                        <CardTitle className="text-base">2. รายละเอียดการจัดสรรยอดตามบิล (Display Only)</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Alert variant="secondary" className="bg-blue-50 border-blue-200">
                            <Info className="h-4 w-4 text-blue-600" />
                            <AlertTitle className="text-blue-800 text-xs font-bold">ข้อมูลการคำนวณ</AlertTitle>
                            <AlertDescription className="text-blue-700 text-[10px]">
                                ตารางนี้แสดงว่ายอดเงินที่พี่โจ้กรอกด้านบน ถูกแบ่งไปหักลบหนี้ในแต่ละบิลอย่างไรบ้างค่ะ
                            </AlertDescription>
                        </Alert>

                        <div className="border rounded-lg overflow-hidden shadow-sm">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/50">
                                        <TableHead>เลขที่บิล</TableHead>
                                        <TableHead className="text-right">ยอดค้าง (Gross)</TableHead>
                                        <TableHead className="text-right">หัก ({watchedWhtPercent}%)</TableHead>
                                        <TableHead className="text-right">ยอดเงินโอน (Net)</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {calculatedAllocations.map((a) => (
                                        <TableRow key={a.invoiceId} className="hover:bg-transparent">
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-sm">{a.invoiceDocNo}</span>
                                                    {a.withTax && <Badge variant="outline" className="w-fit text-[8px] h-3 px-1 border-blue-200 text-blue-600 uppercase">Vat 7%</Badge>}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-sm">{formatCurrency(a.gross)}</TableCell>
                                            <TableCell className="text-right text-xs text-destructive font-medium">-{formatCurrency(a.whtAmount)}</TableCell>
                                            <TableCell className="text-right font-bold text-primary">{formatCurrency(a.netCash)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                                <TableFooter>
                                    <TableRow className="bg-muted/20">
                                        <TableCell colSpan={3} className="text-xs text-muted-foreground italic">
                                            ส่วนต่างยอดโอน (Unallocated Cash):
                                        </TableCell>
                                        <TableCell className={cn("text-right font-black text-lg", Math.abs(totals.unallocated) > 0.06 ? 'text-destructive' : 'text-green-600')}>
                                            ฿{formatCurrency(totals.unallocated)}
                                        </TableCell>
                                    </TableRow>
                                </TableFooter>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </form>
        </Form>

        <AlertDialog open={showFinalConfirm} onOpenChange={setShowFinalConfirm}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>ยืนยันการจัดสรรและรับเงิน?</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div className="space-y-3">
                            <p>ตรวจสอบข้อมูลครั้งสุดท้ายก่อนบันทึกบัญชี:</p>
                            <div className="p-4 bg-muted rounded-lg space-y-2 text-sm">
                                <div className="flex justify-between"><span>ยอดรับจริง:</span><span className="font-bold text-primary">{formatCurrency(watchedNetReceivedTotal)} บาท</span></div>
                                <div className="flex justify-between"><span>หักภาษี (WHT) รวม:</span><span className="font-bold text-destructive">-{formatCurrency(totals.totalWht)} บาท</span></div>
                                <div className="flex justify-between border-t pt-2 mt-2"><span>ยอดตัดหนี้รวม (Gross):</span><span className="font-bold text-green-600">{formatCurrency(totals.totalGross)} บาท</span></div>
                            </div>
                            <p className="text-xs text-muted-foreground">ระบบจะบันทึกรายรับและปิดงานซ่อมที่เกี่ยวข้องให้โดยอัตโนมัติค่ะ</p>
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                    <AlertDialogAction onClick={() => pendingFormData && executeSubmit(pendingFormData)} disabled={isLoading} className="bg-green-600 hover:bg-green-700">
                        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Check className="mr-2 h-4 w-4"/>} ยืนยันข้อมูลถูกต้อง
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </>
  );
}

export default function ConfirmReceiptPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>}>
            <ConfirmReceiptPageContent />
        </Suspense>
    );
}
