"use client";

import { useEffect, useMemo, useState, Suspense, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { doc, collection, query, where, writeBatch, serverTimestamp, getDocs, getDoc, runTransaction } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { useFirebase, useDoc } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Save, ArrowLeft, Calculator, Info, AlertCircle, CalendarDays } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { Document as DocumentType, AccountingAccount, AccountingObligation } from "@/lib/types";
import type { WithId } from "@/firebase/firestore/use-collection";
import { safeFormat } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
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

const allocationSchema = z.object({
  invoiceId: z.string(),
  invoiceDocNo: z.string(),
  grossRemaining: z.coerce.number(),
  withTax: z.boolean().default(false),
  grossApplied: z.coerce.number().min(0, "ยอดตัดหนี้ห้ามติดลบ"),
  withholdingPercent: z.coerce.number().min(0).max(100).optional(),
  withholdingAmount: z.coerce.number().min(0).optional(),
  netCashApplied: z.coerce.number().min(0),
});

const confirmReceiptSchema = z.object({
  accountId: z.string().min(1, "กรุณาเลือกบัญชีที่รับเงิน"),
  paymentDate: z.string().min(1, "กรุณาเลือกวันที่รับเงินจริง"),
  netReceivedTotal: z.coerce.number().min(0.01, "ยอดรับสุทธิต้องมากกว่า 0"),
  allocations: z.array(allocationSchema),
}).refine(
  (data) => {
    const totalNetApplied = data.allocations.reduce((sum, alloc) => sum + (alloc.netCashApplied || 0), 0);
    // Allow for small rounding differences (0.05 baht)
    return Math.abs(totalNetApplied - data.netReceivedTotal) < 0.06;
  },
  {
    message: "ยอดเงินที่จัดสรรรวมต้องเท่ากับยอดรับโอนจริง (ตรวจสอบยอดเงินที่ยังไม่ได้ระบุที่ท้ายตารางค่ะ)",
    path: ["netReceivedTotal"],
  }
).refine(
    (data) => data.allocations.every(alloc => alloc.grossApplied <= alloc.grossRemaining + 0.05), 
    {
        message: "มียอดตัดหนี้รวม (Gross) เกินยอดค้างชำระของบิลอ้างอิง",
        path: ["allocations"],
    }
);

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
      allocations: [],
      paymentDate: format(new Date(), 'yyyy-MM-dd'),
      netReceivedTotal: 0,
    },
  });

  const { fields, update } = useFieldArray({ control: form.control, name: "allocations" });
  const watchedAllocations = useWatch({ control: form.control, name: "allocations" });

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
            // Check if referring to Billing Notes or Invoices
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
        
        // Initial setup of allocations based on the outstanding debt
        const initialAllocations = fetchedInvoices.map(inv => {
            const ob = fetchedObligations[inv.id];
            const grossRemaining = Math.round((ob?.balance ?? inv.paymentSummary?.balance ?? inv.grandTotal) * 100) / 100;
            const whtRate = inv.docType === 'TAX_INVOICE' ? 0.03 : 0;
            const whtBase = inv.withTax ? (grossRemaining / 1.07) : grossRemaining;
            const whtAmount = Math.round(whtBase * whtRate * 100) / 100;
            const netCash = Math.round((grossRemaining - whtAmount) * 100) / 100;

            return {
                invoiceId: inv.id,
                invoiceDocNo: inv.docNo,
                grossRemaining,
                withTax: inv.withTax ?? false,
                grossApplied: grossRemaining,
                withholdingPercent: inv.docType === 'TAX_INVOICE' ? 3 : 0,
                withholdingAmount: whtAmount,
                netCashApplied: netCash,
            };
        });

        const totalNet = initialAllocations.reduce((sum, a) => sum + a.netCashApplied, 0);

        form.reset({
            accountId: receiptData.receivedAccountId || accountsData[0]?.id || "",
            paymentDate: receiptData.paymentDate || format(new Date(), "yyyy-MM-dd"),
            netReceivedTotal: Math.round(totalNet * 100) / 100,
            allocations: initialAllocations
        });

      } catch (err: any) {
        setError(err.message || "เกิดข้อผิดพลาดในการโหลดข้อมูล");
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [db, receiptId, form]);
  
  // Logic to recalculate line Net based on Gross and WHT %
  useEffect(() => {
    const subscription = form.watch((value, { name }) => {
      if (name && name.startsWith('allocations')) {
        const parts = name.split('.');
        if (parts.length >= 2) {
          const index = parseInt(parts[1], 10);
          const currentAlloc = form.getValues(`allocations.${index}`);
          if (!currentAlloc) return;
          
          let { grossApplied, withholdingPercent, withTax } = currentAlloc;
          grossApplied = Number(grossApplied) || 0;
          withholdingPercent = Number(withholdingPercent) || 0;
          
          const rate = withholdingPercent / 100;
          const whtBase = withTax ? (grossApplied / 1.07) : grossApplied;
          const whtAmount = Math.round(whtBase * rate * 100) / 100;
          const netCash = Math.round((grossApplied - whtAmount) * 100) / 100;

          // Only update if something changed to prevent loops
          if (currentAlloc.withholdingAmount !== whtAmount || currentAlloc.netCashApplied !== netCash) {
              update(index, {
                ...currentAlloc,
                withholdingAmount: whtAmount,
                netCashApplied: netCash,
              });
          }
        }
      }
    });
    return () => subscription.unsubscribe();
  }, [form, update]);
  
  const totals = useMemo(() => {
    const totalNetApplied = Math.round(watchedAllocations.reduce((sum, a) => sum + (a.netCashApplied || 0), 0) * 100) / 100;
    const totalWht = Math.round(watchedAllocations.reduce((sum, a) => sum + (a.withholdingAmount || 0), 0) * 100) / 100;
    const totalGrossApplied = Math.round(watchedAllocations.reduce((sum, a) => sum + (a.grossApplied || 0), 0) * 100) / 100;
    const remainingToAllocate = Math.round(((form.getValues('netReceivedTotal') || 0) - totalNetApplied) * 100) / 100;
    return { totalNetApplied, totalWht, totalGrossApplied, remainingToAllocate };
  }, [watchedAllocations, form]);

  const executeSubmit = async (data: ConfirmReceiptFormData) => {
    if (!db || !profile || !receipt) return;
    setIsLoading(true);
    const jobsToArchive: string[] = [];

    try {
        await runTransaction(db, async (transaction) => {
            const receiptRef = doc(db, 'documents', receipt.id);
            const receiptSnap = await transaction.get(receiptRef);
            
            if (!receiptSnap.exists()) throw new Error("ไม่พบใบเสร็จในระบบ");
            if (receiptSnap.data().status === 'CONFIRMED' || receiptSnap.data().accountingEntryId) {
                throw new Error("รายการนี้ถูกยืนยันไปก่อนหน้านี้แล้ว");
            }

            const account = accounts.find(a => a.id === data.accountId);
            if (!account) throw new Error("ไม่พบข้อมูลบัญชีที่เลือก");
            const paymentMethod = account.type === 'CASH' ? 'CASH' : 'TRANSFER';

            const arPaymentId = `ARPAY_${receipt.id}`;
            const arPaymentRef = doc(db, 'arPayments', arPaymentId);
            const entryId = `RECEIPT_${receipt.id}`;
            const entryRef = doc(db, 'accountingEntries', entryId);

            transaction.set(arPaymentRef, {
                id: arPaymentId,
                receiptId: receipt.id,
                customerId: receipt.customerId,
                paymentDate: data.paymentDate,
                netReceivedTotal: data.netReceivedTotal,
                withholdingTotal: totals.totalWht,
                allocations: data.allocations.filter(a => a.grossApplied > 0).map(a => ({
                    invoiceId: a.invoiceId,
                    invoiceDocNo: a.invoiceDocNo,
                    netCashApplied: a.netCashApplied,
                    withholdingAmount: a.withholdingAmount,
                    grossApplied: a.grossApplied,
                })),
                createdAt: serverTimestamp(),
            });
            
            transaction.set(entryRef, {
                entryType: 'RECEIPT',
                entryDate: data.paymentDate,
                amount: data.netReceivedTotal,
                accountId: data.accountId,
                paymentMethod: paymentMethod,
                sourceDocType: 'RECEIPT',
                sourceDocId: receipt.id,
                sourceDocNo: receipt.docNo,
                customerNameSnapshot: receipt.customerSnapshot?.name,
                createdAt: serverTimestamp(),
            });
            
            transaction.update(receiptRef, {
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
            });
            
            // Update individual Invoices and parent Billing Note
            const parentReferenceIds = receipt.referencesDocIds || [];
            for (const refId of parentReferenceIds) {
                const docRef = doc(db, 'documents', refId);
                transaction.update(docRef, { status: 'PAID', updatedAt: serverTimestamp() });
            }

            for (const alloc of data.allocations) {
                if (alloc.grossApplied > 0) {
                    const ob = obligations[alloc.invoiceId];
                    if (ob) {
                        const newAmountPaid = Math.round(((ob.amountPaid || 0) + alloc.grossApplied) * 100) / 100;
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

                        transaction.update(doc(db, 'documents', alloc.invoiceId), {
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
                            transaction.update(jobRef, { status: 'CLOSED', updatedAt: serverTimestamp(), lastActivityAt: serverTimestamp() });
                            transaction.set(doc(collection(jobRef, 'activities')), {
                                text: `ฝ่ายบัญชียืนยันรับเงินตามใบเสร็จ ${receipt.docNo} และปิดงานเรียบร้อยค่ะ`,
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
      setPendingFormData(data);
      setShowFinalConfirm(true);
  }

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>;
  if (error) return <PageHeader title="เกิดข้อผิดพลาด" description={error} />;

  return (
    <>
        <Suspense fallback={<Loader2 className="animate-spin" />}>
        <PageHeader title="ยืนยันรับเงินเข้าบัญชี" description={`สำหรับใบเสร็จเลขที่: ${receipt?.docNo}`} />
        <Form {...form}>
            <form onSubmit={form.handleSubmit(handlePreSubmit)} className="space-y-6">
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => router.back()}><ArrowLeft className="mr-2 h-4 w-4"/> กลับ</Button>
                    <Button type="submit" disabled={isLoading} className="bg-green-600 hover:bg-green-700">
                        <Save className="mr-2 h-4 w-4"/> ยืนยันข้อมูล
                    </Button>
                </div>
                
                <Card>
                    <CardHeader><CardTitle className="text-base">1. สรุปยอดเงินโอน (Actual Received)</CardTitle></CardHeader>
                    <CardContent className="grid md:grid-cols-2 gap-4">
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
                        <div className="md:col-span-2">
                            <FormField name="netReceivedTotal" control={form.control} render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-primary font-bold">ยอดเงินที่ได้รับจริง (ยอดโอน / เงินสด)</FormLabel>
                                    <FormControl><Input type="number" {...field} className="text-lg font-black border-primary/50" /></FormControl>
                                    <FormDescription className="text-xs text-muted-foreground">คือยอด "รวมบิล - ภาษีหัก ณ ที่จ่าย" (WHT) ที่ลูกค้าไม่ได้จ่ายเป็นเงินสดมาให้เราค่ะ</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row justify-between items-center">
                        <CardTitle className="text-base">2. จัดสรรยอดเงินตามบิล</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Alert variant="secondary" className="bg-blue-50 border-blue-200">
                            <Info className="h-4 w-4 text-blue-600" />
                            <AlertTitle className="text-blue-800">คำแนะนำการหัก ณ ที่จ่าย</AlertTitle>
                            <AlertDescription className="text-blue-700 text-xs">
                                สำหรับบิลที่มียอด VAT 7% ระบบจะคำนวณภาษีหัก ณ ที่จ่ายจาก **ยอดก่อน VAT** ให้อัตโนมัติเมื่อระบุ % ค่ะ
                            </AlertDescription>
                        </Alert>

                        <div className="border rounded-md overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/50">
                                        <TableHead>เลขที่ Invoice</TableHead>
                                        <TableHead className="text-right">ยอดค้างบิล</TableHead>
                                        <TableHead className="w-20 text-right">หัก (%)</TableHead>
                                        <TableHead className="w-32 text-right">ยอด WHT</TableHead>
                                        <TableHead className="w-40 text-right">ตัดหนี้รวม (Gross)</TableHead>
                                        <TableHead className="w-32 text-right">ยอดเงินโอน (Net)</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {fields.map((field, index) => (
                                        <TableRow key={field.id} className="hover:bg-transparent">
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-sm">{field.invoiceDocNo}</span>
                                                    {field.withTax && <Badge variant="outline" className="w-fit text-[8px] h-3 px-1 border-blue-200 text-blue-600 uppercase">Vat 7%</Badge>}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right text-xs font-mono">{formatCurrency(field.grossRemaining)}</TableCell>
                                            <TableCell><FormField control={form.control} name={`allocations.${index}.withholdingPercent`} render={({ field }) => (<Input type="number" className="text-right h-8" {...field} placeholder="3"/>)} /></TableCell>
                                            <TableCell className="text-right text-xs text-destructive font-medium">-{formatCurrency(watchedAllocations[index]?.withholdingAmount || 0)}</TableCell>
                                            <TableCell><FormField control={form.control} name={`allocations.${index}.grossApplied`} render={({ field }) => (<Input type="number" className="text-right h-8 font-bold" {...field} />)} /></TableCell>
                                            <TableCell className="text-right font-bold text-primary">{formatCurrency(watchedAllocations[index]?.netCashApplied || 0)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                                <TableFooter>
                                    <TableRow className="bg-muted/20">
                                        <TableCell colSpan={4} className="text-xs text-muted-foreground italic">
                                            ยอดเงินโอนที่ยังไม่ได้ระบุลงในบิล (Unallocated Cash):
                                        </TableCell>
                                        <TableCell colSpan={2} className={cn("text-right font-black text-lg", Math.abs(totals.remainingToAllocate) > 0.06 ? 'text-destructive' : 'text-green-600')}>
                                            ฿{formatCurrency(totals.remainingToAllocate)}
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
                            <p>เมื่อยืนยันแล้ว ระบบจะดำเนินการดังนี้:</p>
                            <ul className="list-disc pl-5 text-sm space-y-1">
                                <li>บันทึกรายรับเข้าบัญชี <span className="font-bold text-primary">{formatCurrency(pendingFormData?.netReceivedTotal || 0)} บาท</span></li>
                                <li>ตัดยอดหนี้ลูกหนี้ (AR) และใบวางบิลที่เกี่ยวข้อง</li>
                                <li>ปิดงานซ่อม (CLOSED) ทันทีหากชำระครบถ้วน</li>
                            </ul>
                            <p className="font-bold text-destructive">หมายเหตุ: รายการนี้ไม่สามารถแก้ไขได้อีกหลังจากยืนยันค่ะ</p>
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                    <AlertDialogAction onClick={() => pendingFormData && executeSubmit(pendingFormData)} disabled={isLoading}>
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>} ยืนยันข้อมูล
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
        </Suspense>
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