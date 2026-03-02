"use client";

import { useEffect, useMemo, useState, Suspense, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { doc, collection, query, where, writeBatch, serverTimestamp, getDocs, getDoc, runTransaction } from "firebase/firestore";
import { useFirebase, useDoc } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Save, ArrowLeft, Calculator } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

const allocationSchema = z.object({
  invoiceId: z.string(),
  invoiceDocNo: z.string(),
  grossRemaining: z.coerce.number(),
  netCashApplied: z.coerce.number().min(0, "ยอดเงินห้ามติดลบ"),
  withholdingPercent: z.coerce.number().min(0).max(100).optional(),
  withholdingAmount: z.coerce.number().min(0).optional(),
  grossApplied: z.coerce.number().min(0),
});

const confirmReceiptSchema = z.object({
  accountId: z.string().min(1, "กรุณาเลือกบัญชีที่รับเงิน"),
  paymentDate: z.string().min(1, "กรุณาเลือกวันที่รับเงินจริง"),
  netReceivedTotal: z.coerce.number().min(0.01, "ยอดรับสุทธิต้องมากกว่า 0"),
  allocations: z.array(allocationSchema),
}).refine(
  (data) => {
    const totalNetApplied = data.allocations.reduce((sum, alloc) => sum + (alloc.netCashApplied || 0), 0);
    return Math.abs(totalNetApplied - data.netReceivedTotal) < 0.01;
  },
  {
    message: "ยอดเงินที่จัดสรรรวมต้องเท่ากับยอดรับสุทธิ",
    path: ["netReceivedTotal"],
  }
).refine(
    (data) => data.allocations.every(alloc => alloc.grossApplied <= alloc.grossRemaining + 0.01), 
    {
        message: "มียอดจัดสรรเกินยอดค้างชำระของบิลอ้างอิง",
        path: ["allocations"],
    }
);

type ConfirmReceiptFormData = z.infer<typeof confirmReceiptSchema>;

const formatCurrency = (value: number) => value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ConfirmReceiptPageContent() {
  const { receiptId } = useParams();
  const router = useRouter();
  const { db } = useFirebase();
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
        if (invoiceIds.length === 0) {
            setInvoices([]);
            setObligations({});
            return;
        }

        const firstRefId = invoiceIds[0];
        const sourceDocSnap = await getDoc(doc(db, 'documents', firstRefId));
        if (sourceDocSnap.exists() && sourceDocSnap.data().docType === 'BILLING_NOTE') {
            invoiceIds = sourceDocSnap.data().invoiceIds || [];
        }

        if (invoiceIds.length === 0) {
            setInvoices([]);
            setObligations({});
        } else {
            const invoicesQuery = query(collection(db, "documents"), where("__name__", "in", invoiceIds));
            const obligationsQuery = query(collection(db, 'accountingObligations'), where('sourceDocId', 'in', invoiceIds));
            
            const [invoicesSnap, obligationsSnap] = await Promise.all([
                getDocs(invoicesQuery),
                getDocs(obligationsQuery),
            ]);

            const fetchedInvoices = invoicesSnap.docs.map(d => ({id: d.id, ...d.data()}) as WithId<DocumentType>);
            const fetchedObligations = Object.fromEntries(obligationsSnap.docs.map(d => [d.data().sourceDocId, {id: d.id, ...d.data()} as WithId<AccountingObligation>]));
            
            setInvoices(fetchedInvoices);
            setObligations(fetchedObligations);
        }

        const accountsQuery = query(collection(db, "accountingAccounts"), where("isActive", "==", true));
        const accountsSnap = await getDocs(accountsQuery);
        setAccounts(accountsSnap.docs.map(d => ({id: d.id, ...d.data()}) as WithId<AccountingAccount>));
        
        form.reset({
            accountId: receiptData.receivedAccountId || accountsSnap.docs[0]?.id || "",
            paymentDate: receiptData.paymentDate || format(new Date(), "yyyy-MM-dd"),
            netReceivedTotal: receiptData.grandTotal,
            allocations: invoices.map(inv => {
                const ob = obligations[inv.id];
                const grossRemaining = ob?.balance ?? inv.paymentSummary?.balance ?? inv.grandTotal;
                return {
                    invoiceId: inv.id,
                    invoiceDocNo: inv.docNo,
                    grossRemaining,
                    netCashApplied: 0,
                    withholdingAmount: 0,
                    grossApplied: 0,
                };
            })
        });

      } catch (err: any) {
        setError(err.message || "เกิดข้อผิดพลาดในการโหลดข้อมูล");
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [db, receiptId, form]);
  
  const handleAutoAllocate = useCallback(() => {
    const netTotal = form.getValues('netReceivedTotal');
    let remainingToAllocate = netTotal;
    const currentAllocations = form.getValues('allocations');
    
    const sortedAllocations = [...currentAllocations].sort((a,b) => {
        const invA = invoices.find(i => i.id === a.invoiceId);
        const invB = invoices.find(i => i.id === b.invoiceId);
        return new Date(invA?.docDate || 0).getTime() - new Date(invB?.docDate || 0).getTime();
    });

    const newAllocations = sortedAllocations.map(alloc => {
      const grossRemaining = alloc.grossRemaining;
      const amountToApply = Math.min(remainingToAllocate, grossRemaining);
      remainingToAllocate -= amountToApply;
      return { ...alloc, netCashApplied: amountToApply, withholdingAmount: 0, withholdingPercent: 0, grossApplied: amountToApply };
    });

    newAllocations.forEach(newAlloc => {
        const originalIndex = form.getValues('allocations').findIndex(a => a.invoiceId === newAlloc.invoiceId);
        if (originalIndex !== -1) {
            update(originalIndex, newAlloc);
        }
    });

    if (remainingToAllocate > 0.01) {
        toast({
            variant: "default",
            title: "ยอดเงินคงเหลือ",
            description: `มีเงินคงเหลือ ${formatCurrency(remainingToAllocate)} บาท ที่ยังไม่ได้จัดสรร`,
        });
    }
  }, [form, invoices, toast, update]);

  useEffect(() => {
    const subscription = form.watch((value, { name, type }) => {
      if (name && name.startsWith('allocations')) {
        const parts = name.split('.');
        if (parts.length >= 2) {
          const index = parseInt(parts[1], 10);
          const currentAlloc = form.getValues(`allocations.${index}`);
          if (!currentAlloc) return;
          
          let { netCashApplied, withholdingPercent, withholdingAmount, grossApplied } = currentAlloc;
          netCashApplied = netCashApplied || 0;
          withholdingPercent = withholdingPercent || 0;
          withholdingAmount = withholdingAmount || 0;

          if(parts[2] === 'netCashApplied') {
             if(withholdingPercent > 0) {
                 grossApplied = netCashApplied / (1 - (withholdingPercent / 100));
                 withholdingAmount = grossApplied - netCashApplied;
             } else {
                 grossApplied = netCashApplied + withholdingAmount;
             }
          } else if (parts[2] === 'withholdingPercent') {
             grossApplied = netCashApplied / (1 - (withholdingPercent / 100));
             withholdingAmount = grossApplied - netCashApplied;
          } else if (parts[2] === 'withholdingAmount') {
             grossApplied = netCashApplied + withholdingAmount;
             if (grossApplied > 0) {
                withholdingPercent = (withholdingAmount / grossApplied) * 100;
             } else {
                withholdingPercent = 0;
             }
          }

          update(index, {
            ...currentAlloc,
            withholdingPercent: Number(Number(withholdingPercent).toFixed(4)),
            withholdingAmount: Number(Number(withholdingAmount).toFixed(2)),
            grossApplied: Number(Number(grossApplied).toFixed(2)),
          });
        }
      }
    });
    return () => subscription.unsubscribe();
  }, [form, update]);
  
  const totals = useMemo(() => {
    const totalNetApplied = watchedAllocations.reduce((sum, a) => sum + (a.netCashApplied || 0), 0);
    const totalWht = watchedAllocations.reduce((sum, a) => sum + (a.withholdingAmount || 0), 0);
    const totalGrossApplied = watchedAllocations.reduce((sum, a) => sum + (a.grossApplied || 0), 0);
    const remainingToAllocate = (form.getValues('netReceivedTotal') || 0) - totalNetApplied;
    return { totalNetApplied, totalWht, totalGrossApplied, remainingToAllocate };
  }, [watchedAllocations, form]);

  const executeSubmit = async (data: ConfirmReceiptFormData) => {
    if (!db || !profile || !receipt) return;
    setIsLoading(true);
    try {
        await runTransaction(db, async (transaction) => {
            const receiptRef = doc(db, 'documents', receipt.id);
            const receiptSnap = await transaction.get(receiptRef);
            
            if (!receiptSnap.exists()) throw new Error("ไม่พบใบเสร็จในระบบ");
            
            if (receiptSnap.data().status === 'CONFIRMED' || receiptSnap.data().receiptStatus === 'CONFIRMED' || receiptSnap.data().accountingEntryId) {
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
            
            for (const alloc of data.allocations) {
                if (alloc.grossApplied > 0) {
                    const ob = obligations[alloc.invoiceId];
                    if (ob) {
                        const newBalance = Math.max(0, ob.balance - alloc.grossApplied);
                        const newStatus = newBalance <= 0.01 ? 'PAID' : 'PARTIAL';
                        
                        transaction.update(doc(db, 'accountingObligations', ob.id), {
                            amountPaid: (ob.amountPaid || 0) + alloc.grossApplied,
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
                                paidTotal: (ob.amountPaid || 0) + alloc.grossApplied,
                                balance: newBalance,
                                paymentStatus: newStatus
                            },
                            updatedAt: serverTimestamp(),
                        });
                    }
                }
            }
        });
        
        toast({ title: "ยืนยันการรับเงินสำเร็จ" });
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
        <PageHeader title="ยืนยันรับเงินเข้าบัญชี" description={`สำหรับใบเสร็จเลขที่: ${receipt?.docNo}`} />
        <Form {...form}>
            <form onSubmit={form.handleSubmit(handlePreSubmit)} className="space-y-6">
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => router.back()}><ArrowLeft className="mr-2 h-4 w-4"/> กลับ</Button>
                    <Button type="submit" disabled={isLoading}><Save className="mr-2 h-4 w-4"/> ยืนยันข้อมูล</Button>
                </div>
                
                <Card>
                    <CardHeader><CardTitle className="text-base">1. สรุปยอดรับเงิน</CardTitle></CardHeader>
                    <CardContent className="grid md:grid-cols-2 gap-4">
                        <FormField name="paymentDate" control={form.control} render={({ field }) => (<FormItem><FormLabel>วันที่รับเงินจริง</FormLabel><FormControl><Input type="date" {...field}/></FormControl><FormMessage /></FormItem>)} />
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
                            <FormField name="netReceivedTotal" control={form.control} render={({ field }) => (<FormItem><FormLabel>ยอดรับสุทธิ (Net)</FormLabel><FormControl><Input type="number" {...field} className="text-lg font-bold" /></FormControl><FormMessage /></FormItem>)} />
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row justify-between items-center">
                        <CardTitle className="text-base">2. จัดสรรยอดเงินตามบิล</CardTitle>
                        <Button type="button" variant="secondary" onClick={handleAutoAllocate}><Calculator className="mr-2 h-4 w-4"/> จัดสรรอัตโนมัติ</Button>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader><TableRow><TableHead>เลขที่ Invoice</TableHead><TableHead className="text-right">ยอดค้าง</TableHead><TableHead className="w-40 text-right">ยอดรับครั้งนี้ (Net)</TableHead><TableHead className="w-28 text-right">หัก WHT (%)</TableHead><TableHead className="w-36 text-right">ยอด WHT (บาท)</TableHead><TableHead className="w-40 text-right">ยอดตัดหนี้รวม (Gross)</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {fields.map((field, index) => (
                                    <TableRow key={field.id}>
                                        <TableCell className="font-medium">{field.invoiceDocNo}</TableCell>
                                        <TableCell className="text-right">{formatCurrency(field.grossRemaining)}</TableCell>
                                        <TableCell><FormField control={form.control} name={`allocations.${index}.netCashApplied`} render={({ field }) => (<Input type="number" className="text-right h-8" {...field} />)} /></TableCell>
                                        <TableCell><FormField control={form.control} name={`allocations.${index}.withholdingPercent`} render={({ field }) => (<Input type="number" className="text-right h-8" {...field} placeholder="เช่น 3"/>)} /></TableCell>
                                        <TableCell><FormField control={form.control} name={`allocations.${index}.withholdingAmount`} render={({ field }) => (<Input type="number" className="text-right h-8" {...field} />)} /></TableCell>
                                        <TableCell className="text-right font-semibold">{formatCurrency(field.grossApplied)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                            <TableFooter>
                                <TableRow>
                                    <TableCell colSpan={4} className="text-sm">ยอดเงินคงเหลือที่ยังไม่ได้จัดสรร:</TableCell>
                                    <TableCell colSpan={2} className={cn("text-right font-bold text-lg", Math.abs(totals.remainingToAllocate) > 0.01 ? 'text-destructive' : 'text-green-600')}>{formatCurrency(totals.remainingToAllocate)}</TableCell>
                                </TableRow>
                            </TableFooter>
                        </Table>
                    </CardContent>
                </Card>
            </form>
        </Form>

        <AlertDialog open={showFinalConfirm} onOpenChange={setShowFinalConfirm}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>ยืนยันข้อมูลการรับเงินและจัดสรรหนี้?</AlertDialogTitle>
                    <AlertDialogDescription>
                        เมื่อยืนยันแล้ว ระบบจะ <span className="font-bold text-destructive">ลงบัญชีรายรับและปรับยอดลูกหนี้ทันที</span> โดยไม่สามารถแก้ไขได้อีก
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                    <AlertDialogAction onClick={() => pendingFormData && executeSubmit(pendingFormData)} disabled={isLoading}>
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>} ตกลง ยืนยันข้อมูล
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
