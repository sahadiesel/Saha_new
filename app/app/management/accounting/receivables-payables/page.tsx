"use client";

import { useMemo, Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { useFirebase, useCollection, useDoc, type WithId } from "@/firebase";
import { collection, query, where, onSnapshot, doc, writeBatch, serverTimestamp, getDoc, type FirestoreError, addDoc, limit, orderBy, runTransaction } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format, parseISO } from "date-fns";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Search, AlertCircle, HandCoins, ExternalLink, PlusCircle, ChevronsUpDown, Receipt, Wallet, ArrowDownCircle, Info, FileStack, CalendarDays } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Calendar } from "@/components/ui/calendar";

import type { AccountingObligation, AccountingAccount, UserProfile, Vendor, Document as DocumentType, AccountingEntry, PurchaseDoc, StoreSettings, DocumentSettings } from "@/lib/types";
import { safeFormat, APP_DATE_FORMAT } from "@/lib/date-utils";
import { cn, sanitizeForFirestore } from "@/lib/utils";

const formatCurrency = (value: number | null | undefined) => {
  return (value ?? 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const arPaymentSchema = z.object({
  paymentDate: z.string().min(1, "กรุณาเลือกวันที่"),
  amount: z.coerce.number().positive("จำนวนเงินต้องมากกว่า 0"),
  accountId: z.string().min(1, "กรุณาเลือกบัญชี"),
  notes: z.string().optional(),
  withholdingEnabled: z.boolean().default(false),
  withholdingAmount: z.coerce.number().min(0).optional(),
});

function ReceivePaymentDialog({
  obligation,
  accounts,
  isOpen,
  onClose,
}: {
  obligation: WithId<AccountingObligation>;
  accounts: WithId<AccountingAccount>[];
  isOpen: boolean;
  onClose: () => void;
}) {
  const { db } = useFirebase();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<z.infer<typeof arPaymentSchema>>({
    resolver: zodResolver(arPaymentSchema),
    defaultValues: {
      paymentDate: new Date().toISOString().split("T")[0],
      amount: obligation.balance,
      withholdingEnabled: false,
      withholdingAmount: 0,
      notes: "",
      accountId: accounts[0]?.id || "",
    },
  });

  useEffect(() => {
    form.reset({
      paymentDate: new Date().toISOString().split("T")[0],
      amount: obligation.balance,
      withholdingEnabled: false,
      withholdingAmount: 0,
      notes: "",
      accountId: accounts[0]?.id || "",
    });
  }, [obligation, accounts, form]);

  const watchedAmount = form.watch('amount');
  const watchedWhtEnabled = form.watch('withholdingEnabled');
  const watchedWhtAmount = form.watch('withholdingAmount') || 0;
  const cashReceived = watchedAmount - (watchedWhtEnabled ? watchedWhtAmount : 0);

  const handleSavePayment = async (data: z.infer<typeof arPaymentSchema>) => {
    if (!db) return;
    const account = accounts.find(a => a.id === data.accountId);
    if (!account) return;

    setIsSubmitting(true);
    const paymentMethod = account.type === 'CASH' ? 'CASH' : 'TRANSFER';

    try {
      const batch = writeBatch(db);

      const obligationRef = doc(db, 'accountingObligations', obligation.id);
      const newAmountPaid = Math.round(((obligation.amountPaid || 0) + data.amount) * 100) / 100;
      const newBalance = Math.max(0, Math.round((obligation.amountTotal - newAmountPaid) * 100) / 100);
      const newStatus = newBalance <= 0.05 ? 'PAID' : 'PARTIAL';
      
      batch.update(obligationRef, {
        amountPaid: newAmountPaid,
        balance: newBalance,
        status: newStatus,
        lastPaymentDate: data.paymentDate,
        paidOffDate: newStatus === 'PAID' ? data.paymentDate : null,
        updatedAt: serverTimestamp(),
      });
      
      const entryRef = doc(collection(db, "accountingEntries"));
      batch.set(entryRef, {
          entryType: "CASH_IN",
          entryDate: data.paymentDate,
          amount: cashReceived,
          accountId: data.accountId,
          paymentMethod: paymentMethod,
          description: `รับชำระหนี้จาก ${obligation.customerNameSnapshot} (อ้างอิง: ${obligation.sourceDocNo})`,
          sourceDocType: obligation.sourceDocType,
          sourceDocId: obligation.sourceDocId,
          sourceDocNo: obligation.sourceDocNo,
          customerNameSnapshot: obligation.customerNameSnapshot,
          jobId: obligation.jobId,
          createdAt: serverTimestamp(),
      });

      if (obligation.sourceDocId) {
        const sourceDocRef = doc(db, 'documents', obligation.sourceDocId);
        const sourceDocSnap = await getDoc(sourceDocRef);
        
        if (sourceDocSnap.exists()) {
            const sourceDoc = sourceDocSnap.data() as DocumentType;
            const currentPaidTotal = sourceDoc.paymentSummary?.paidTotal || 0;
            const updatedPaidTotal = Math.round((currentPaidTotal + data.amount) * 100) / 100;
            const updatedBalance = Math.max(0, Math.round((sourceDoc.grandTotal - updatedPaidTotal) * 100) / 100);
            const updatedStatus = updatedBalance <= 0.05 ? 'PAID' : 'PARTIAL';

            batch.update(sourceDocRef, {
                status: updatedStatus,
                arStatus: updatedStatus,
                paymentSummary: {
                    paidTotal: updatedPaidTotal,
                    balance: updatedBalance,
                    paymentStatus: updatedStatus
                },
                paymentDate: data.paymentDate,
                paymentMethod: paymentMethod,
                receivedAccountId: data.accountId,
                cashReceived: cashReceived,
                withholdingEnabled: data.withholdingEnabled,
                withholdingAmount: data.withholdingAmount,
                updatedAt: serverTimestamp(),
            });
        }
      }

      if (newStatus === 'PAID' && obligation.jobId) {
          const jobRef = doc(db, 'jobs', obligation.jobId);
          const jobSnap = await getDoc(jobRef);
          if (jobSnap.exists()) {
              batch.update(jobRef, {
                  status: 'CLOSED',
                  updatedAt: serverTimestamp(),
                  lastActivityAt: serverTimestamp()
              });
          }
      }

      await batch.commit();
      toast({ title: "บันทึกการรับชำระสำเร็จ", description: newStatus === 'PAID' ? "ปิดงานซ่อมเรียบร้อยแล้วค่ะ" : "" });
      onClose();

    } catch (e: any) {
      console.error(e);
      toast({ variant: 'destructive', title: "เกิดข้อผิดพลาด", description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle>รับชำระหนี้</DialogTitle>
          <DialogDescription>สำหรับเอกสาร: {obligation.sourceDocNo}</DialogDescription>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <Form {...form}>
            <form id="payment-form" onSubmit={form.handleSubmit(handleSavePayment)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="paymentDate"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>วันที่รับเงิน</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant={"outline"}
                              className={cn(
                                "w-full pl-3 text-left font-normal h-10",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              {field.value ? format(parseISO(field.value), "dd/MM/yyyy") : <span>เลือกวันที่</span>}
                              <CalendarDays className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value ? parseISO(field.value) : undefined}
                            onSelect={(date) => field.onChange(date ? format(date, "yyyy-MM-dd") : "")}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField name="amount" control={form.control} render={({ field }) => (<FormItem><FormLabel>จำนวนเงินที่รับ</FormLabel><FormControl><Input type="number" {...field}/></FormControl><FormMessage/></FormItem>)} />
              </div>
               <div className="grid grid-cols-1 gap-4">
                <FormField name="accountId" control={form.control} render={({ field }) => (
                    <FormItem>
                        <FormLabel>เข้าบัญชี</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue placeholder="เลือกบัญชี..." /></SelectTrigger></FormControl>
                            <SelectContent>
                                {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.type === 'CASH' ? 'เงินสด' : 'โอน'})</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <FormMessage/>
                    </FormItem>
                )} />
              </div>
              <div className="p-4 border rounded-md bg-muted/20 space-y-4">
                <FormField control={form.control} name="withholdingEnabled" render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="font-bold cursor-pointer text-primary">มีหัก ณ ที่จ่าย (WHT)</FormLabel>
                  </FormItem>
                )} />
                {watchedWhtEnabled && (
                  <FormField control={form.control} name="withholdingAmount" render={({ field }) => (
                    <FormItem className="animate-in slide-in-from-top-1 duration-200">
                      <FormLabel>ยอดเงินที่ถูกหัก (WHT)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} value={field.value || 0} />
                      </FormControl>
                      <FormMessage/>
                    </FormItem>
                  )} />
                )}
              </div>
              <div className="text-right space-y-1 p-2">
                  <p className="text-sm">ยอดรับชำระ: {formatCurrency(watchedAmount)}</p>
                  {watchedWhtEnabled && <p className='text-xs text-destructive'>หัก ณ ที่จ่าย: -{formatCurrency(watchedWhtAmount || 0)}</p>}
                  <p className="font-bold text-xl text-primary">ยอดเงินเข้าจริง: {formatCurrency(cashReceived)}</p>
              </div>
               <FormField control={form.control} name="notes" render={({ field }) => (<FormItem><FormLabel>หมายเหตุ</FormLabel><FormControl><Textarea {...field}/></FormControl></FormItem>)} />
            </form>
          </Form>
        </div>

        <DialogFooter className="p-6 pt-4 border-t bg-muted/10">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>ยกเลิก</Button>
          <Button type="submit" form="payment-form" disabled={isSubmitting}>{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}บันทึกการรับชำระ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const apPaymentSchema = z.object({
  paymentDate: z.string().min(1, "กรุณาเลือกวันที่"),
  amount: z.coerce.number().positive("จำนวนเงินต้องมากกว่า 0"),
  accountId: z.string().min(1, "กรุณาเลือกบัญชี"),
  notes: z.string().optional(),
  withholdingEnabled: z.boolean().default(false),
  withholdingPercent: z.coerce.number().min(0).max(100).optional(),
});

function PayCreditorDialog({ obligation, accounts, isOpen, onClose }: { obligation: WithId<AccountingObligation>; accounts: WithId<AccountingAccount>[]; isOpen: boolean; onClose: () => void; }) {
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<z.infer<typeof apPaymentSchema>>({
    resolver: zodResolver(apPaymentSchema),
    defaultValues: {
      paymentDate: new Date().toISOString().split("T")[0],
      amount: obligation.balance,
      notes: "",
      accountId: accounts[0]?.id || "",
      withholdingEnabled: false,
      withholdingPercent: 3,
    },
  });
  
  const watchedAccountId = form.watch("accountId");
  const watchedAmount = form.watch("amount") || 0;
  const watchedWhtEnabled = form.watch("withholdingEnabled");
  const watchedWhtPercent = form.watch("withholdingPercent") || 0;

  const sourceDocRef = useMemo(() => {
      if (!db || !obligation.sourceDocId) return null;
      const col = obligation.sourceDocType === 'PURCHASE' ? 'purchaseDocs' : 'documents';
      return doc(db, col, obligation.sourceDocId);
  }, [db, obligation.sourceDocId, obligation.sourceDocType]);
  const { data: sourceDoc } = useDoc<any>(sourceDocRef);

  const accountRef = useMemo(() => db && watchedAccountId ? doc(db, 'accountingAccounts', watchedAccountId) : null, [db, watchedAccountId]);
  const { data: accountData, isLoading: isLoadingAccount } = useDoc<AccountingAccount>(accountRef);

  const entriesQuery = useMemo(() => {
    if (!db || !watchedAccountId) return null;
    return query(collection(db, 'accountingEntries'), where('accountId', '==', watchedAccountId));
  }, [db, watchedAccountId]);
  const { data: accountEntries, isLoading: isLoadingEntries } = useCollection<AccountingEntry>(entriesQuery);

  const storeSettingsRef = useMemo(() => (db ? doc(db, "settings", "store") : null), [db]);
  const { data: storeSettings } = useDoc<StoreSettings>(storeSettingsRef);

  const currentBalance = useMemo(() => {
    if (!accountData) return 0;
    let balance = accountData.openingBalance || 0;
    if (accountEntries) {
      accountEntries.forEach(e => {
        if (e.entryType === 'RECEIPT' || e.entryType === 'CASH_IN') balance += e.amount;
        else if (e.entryType === 'CASH_OUT') balance -= e.amount;
      });
    }
    return balance;
  }, [accountData, accountEntries]);

  const whtInfo = useMemo(() => {
      if (!sourceDoc || !watchedWhtEnabled) return { whtBase: 0, whtAmount: 0 };
      
      const isPurchase = obligation.sourceDocType === 'PURCHASE';
      if (!isPurchase) return { whtBase: watchedAmount, whtAmount: watchedAmount * (watchedWhtPercent / 100) };

      const purchase = sourceDoc as PurchaseDoc;
      const whtBase = (purchase.withTax && purchase.vatAmount > 0) ? purchase.subtotal : purchase.grandTotal;
      const whtAmount = whtBase * (watchedWhtPercent / 100);
      return { whtBase, whtAmount };
  }, [sourceDoc, watchedWhtEnabled, watchedWhtPercent, watchedAmount, obligation.sourceDocType]);

  const cashOutAmount = watchedAmount - whtInfo.whtAmount;
  const balanceAfter = currentBalance - cashOutAmount;
  const isInsufficient = currentBalance < cashOutAmount;
  const canOverride = profile?.role === 'ADMIN' || profile?.role === 'MANAGER';
  const isBlocked = isInsufficient && !canOverride;

  useEffect(() => {
    if (isOpen) {
        form.reset({
            paymentDate: new Date().toISOString().split("T")[0],
            amount: obligation.balance,
            notes: "",
            accountId: accounts[0]?.id || "",
            withholdingEnabled: false,
            withholdingPercent: 3,
        });
    }
  }, [obligation, accounts, form, isOpen]);

  const handleSavePayment = async (data: z.infer<typeof apPaymentSchema>) => {
    if (!db || !profile || !storeSettings) return;

    const account = accounts.find(a => a.id === data.accountId);
    if (!account) return;

    if (data.withholdingEnabled) {
        if (!storeSettings.taxId) {
            toast({ variant: 'destructive', title: 'ข้อมูลร้านไม่ครบถ้วน', description: 'กรุณาตั้งค่าเลขผู้เสียภาษีของร้านก่อนออกใบหัก ณ ที่จ่าย'});
            return;
        }
        if (obligation.sourceDocType === 'PURCHASE' && sourceDoc) {
            const purchase = sourceDoc as PurchaseDoc;
            if (!purchase.vendorSnapshot.taxId || !purchase.vendorSnapshot.address) {
                toast({ variant: 'destructive', title: 'ข้อมูลร้านค้าไม่ครบถ้วน', description: 'ร้านค้าต้องมีเลขผู้เสียภาษีและที่อยู่เพื่อออกใบหัก ณ ที่จ่าย'});
                return;
            }
        }
    }

    setIsSubmitting(true);
    const paymentMethod = account.type === 'CASH' ? 'CASH' : 'TRANSFER';

    try {
      await runTransaction(db, async (transaction) => {
        const year = new Date(data.paymentDate).getFullYear();
        const counterRef = doc(db, 'documentCounters', String(year));
        const docSettingsRef = doc(db, 'settings', 'documents');
        
        const [counterSnap, settingsSnap] = await Promise.all([
            transaction.get(counterRef),
            transaction.get(docSettingsRef)
        ]);

        const settingsData = settingsSnap.exists() ? settingsSnap.data() as DocumentSettings : {};
        const whtPrefix = settingsData.withholdingTaxPrefix || 'WHT';
        let currentCounters = counterSnap.exists() ? counterSnap.data() as any : { year };

        const lastWhtPrefix = currentCounters.withholdingTaxPrefix;
        const lastWhtCount = currentCounters.withholdingTax || 0;
        let newWhtCount: number;
        if (lastWhtPrefix !== whtPrefix) {
            newWhtCount = 1;
        } else {
            newWhtCount = lastWhtCount + 1;
        }

        let whtDocId = '';
        let whtDocNo = '';

        if (data.withholdingEnabled && obligation.sourceDocType === 'PURCHASE' && sourceDoc) {
            const purchase = sourceDoc as PurchaseDoc;
            whtDocNo = `${whtPrefix}${year}-${String(newWhtCount).padStart(4, '0')}`;
            
            const whtRef = doc(collection(db, 'documents'));
            whtDocId = whtRef.id;

            transaction.set(whtRef, sanitizeForFirestore({
                id: whtDocId,
                docType: 'WITHHOLDING_TAX',
                docNo: whtDocNo,
                docDate: data.paymentDate,
                payerSnapshot: storeSettings,
                payeeSnapshot: {
                    name: purchase.vendorSnapshot.companyName,
                    taxId: purchase.vendorSnapshot.taxId,
                    address: purchase.vendorSnapshot.address
                },
                vendorId: purchase.vendorId,
                paidMonth: new Date(data.paymentDate).getMonth() + 1,
                paidYear: year,
                incomeTypeCode: 'ITEM5',
                paidAmountGross: whtInfo.whtBase,
                withholdingPercent: data.withholdingPercent,
                withholdingAmount: whtInfo.whtAmount,
                paidAmountNet: whtInfo.whtBase - whtInfo.whtAmount,
                status: 'ISSUED',
                senderName: profile.displayName,
                receiverName: purchase.vendorSnapshot.companyName,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            }));
            
            transaction.set(counterRef, { 
                ...currentCounters,
                withholdingTax: newWhtCount,
                withholdingTaxPrefix: whtPrefix
            }, { merge: true });
        }

        const entryRef = doc(collection(db, "accountingEntries"));
        transaction.set(entryRef, sanitizeForFirestore({
            entryType: "CASH_OUT",
            entryDate: data.paymentDate,
            amount: cashOutAmount,
            grossAmount: data.amount,
            accountId: data.accountId,
            paymentMethod: paymentMethod,
            description: `จ่ายเจ้าหนี้: ${obligation.vendorShortNameSnapshot || obligation.vendorNameSnapshot} (บิล: ${obligation.invoiceNo || obligation.sourceDocNo})`,
            notes: data.notes,
            vendorId: obligation.vendorId,
            vendorShortNameSnapshot: obligation.vendorShortNameSnapshot,
            vendorNameSnapshot: obligation.vendorNameSnapshot,
            sourceDocNo: obligation.invoiceNo || obligation.sourceDocNo,
            obligationId: obligation.id,
            sourceDocType: obligation.sourceDocType,
            sourceDocId: obligation.sourceDocId,
            withholdingEnabled: data.withholdingEnabled,
            withholdingPercent: data.withholdingPercent,
            withholdingAmount: whtInfo.whtAmount,
            withholdingTaxDocId: whtDocId,
            vatAmount: sourceDoc?.vatAmount || 0,
            netAmount: sourceDoc?.subtotal || data.amount,
            createdAt: serverTimestamp(),
        }));

        const obligationRef = doc(db, 'accountingObligations', obligation.id);
        const newAmountPaid = Math.round(((obligation.amountPaid || 0) + data.amount) * 100) / 100;
        const newBalance = Math.max(0, Math.round((obligation.amountTotal - newAmountPaid) * 100) / 100);
        const newStatus = newBalance <= 0.05 ? 'PAID' : 'PARTIAL';

        transaction.update(obligationRef, {
            amountPaid: newAmountPaid,
            balance: newBalance,
            status: newStatus,
            lastPaymentDate: data.paymentDate,
            paidOffDate: newStatus === 'PAID' ? data.paymentDate : null,
            updatedAt: serverTimestamp(),
        });

        if (obligation.sourceDocId) {
            const col = obligation.sourceDocType === 'PURCHASE' ? 'purchaseDocs' : 'documents';
            transaction.update(doc(db, col, obligation.sourceDocId), {
                status: newStatus,
                updatedAt: serverTimestamp(),
                accountingEntryId: entryRef.id,
            });
        }
      });

      toast({ title: "บันทึกการจ่ายเจ้าหนี้สำเร็จ" });
      onClose();
    } catch (e: any) {
      toast({ variant: 'destructive', title: "เกิดข้อผิดพลาด", description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle>จ่ายเจ้าหนี้</DialogTitle>
          <DialogDescription>สำหรับบิลเลขที่: {obligation.invoiceNo || obligation.sourceDocNo} ({obligation.vendorShortNameSnapshot || obligation.vendorNameSnapshot})</DialogDescription>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <Form {...form}>
            <form id="ap-payment-form" onSubmit={form.handleSubmit(handleSavePayment)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="paymentDate"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>วันที่จ่ายเงิน</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant={"outline"}
                              className={cn(
                                "w-full pl-3 text-left font-normal h-10",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              {field.value ? format(parseISO(field.value), "dd/MM/yyyy") : <span>เลือกวันที่</span>}
                              <CalendarDays className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value ? parseISO(field.value) : undefined}
                            onSelect={(date) => field.onChange(date ? format(date, "yyyy-MM-dd") : "")}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField name="amount" render={({ field }) => (<FormItem><FormLabel>ยอดตัดหนี้ (Gross)</FormLabel><FormControl><Input type="number" {...field}/></FormControl><FormMessage/></FormItem>)} />
              </div>
              <div className="grid grid-cols-1 gap-4">
                <FormField name="accountId" control={form.control} render={({ field }) => (
                    <FormItem>
                        <FormLabel>หักจากบัญชี</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue placeholder="เลือกบัญชีที่ใช้จ่าย..."/></SelectTrigger></FormControl>
                            <SelectContent>
                                {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.type === 'CASH' ? 'เงินสด' : 'โอน'})</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <FormMessage/>
                    </FormItem>
                )} />
              </div>

              <div className="p-4 border rounded-md bg-muted/20 space-y-4">
                  <FormField control={form.control} name="withholdingEnabled" render={({ field }) => (
                      <FormItem className="flex items-center gap-2 space-y-0">
                          <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                          <FormLabel className="font-semibold text-primary cursor-pointer">หักภาษี ณ ที่จ่าย (WHT)</FormLabel>
                      </FormItem>
                  )} />
                  {watchedWhtEnabled && (
                      <div className="space-y-3 pt-2 animate-in slide-in-from-top-1">
                          <FormField control={form.control} name="withholdingPercent" render={({ field }) => (
                              <FormItem>
                                  <FormLabel className="text-xs">อัตราหัก (%)</FormLabel>
                                  <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value?.toString()}>
                                      <FormControl><SelectTrigger className="h-8"><SelectValue /></SelectTrigger></FormControl>
                                      <SelectContent>
                                          <SelectItem value="1">1% (ขนส่ง)</SelectItem>
                                          <SelectItem value="3">3% (บริการ)</SelectItem>
                                      </SelectContent>
                                  </Select>
                              </FormItem>
                          )} />
                          {sourceDoc?.withTax && (
                              <div className="flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 p-1 rounded">
                                  <Info className="h-3 w-3" />
                                  มี VAT: คำนวณ WHT จากยอดก่อนภาษี ({formatCurrency(sourceDoc.subtotal)})
                              </div>
                          )}
                          <div className="flex justify-between text-xs font-medium text-destructive">
                              <span>ยอดหักภาษี:</span>
                              <span>-{formatCurrency(whtInfo.whtAmount)}</span>
                          </div>
                      </div>
                  )}
              </div>

              <div className="p-4 border rounded-md bg-muted/30 space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-2">
                      <Wallet className="h-3 w-3" /> ตรวจสอบยอดเงิน
                  </h4>
                  {isLoadingAccount || isLoadingEntries ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin"/> กำลังคำนวณ...</div>
                  ) : (
                      <div className="space-y-1 text-sm">
                          <div className="flex justify-between">
                              <span>ยอดคงเหลือปัจจุบัน:</span>
                              <span className="font-medium">{formatCurrency(currentBalance)}</span>
                          </div>
                          <div className="flex justify-between text-destructive">
                              <span>เงินออกจริงครั้งนี้:</span>
                              <span className="font-medium">-{formatCurrency(cashOutAmount)}</span>
                          </div>
                          <Separator className="my-1"/>
                          <div className={cn("flex justify-between font-bold", balanceAfter < 0 ? "text-destructive" : "text-green-600")}>
                              <span>คงเหลือประมาณการ:</span>
                              <span>{formatCurrency(balanceAfter)}</span>
                          </div>
                      </div>
                  )}
              </div>

              {isInsufficient && (
                  <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-sm">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <div>
                          <p className="font-bold">ยอดเงินไม่เพียงพอ</p>
                          {isBlocked ? (
                              <p className="text-xs">กรุณาเลือกบัญชีที่มีเงินพอ หรือติดต่อ Admin</p>
                          ) : (
                              <p className="text-xs italic">Admin/Manager: กด "บันทึก" เพื่อยืนยันรายการติดลบ</p>
                          )}
                      </div>
                  </div>
              )}

              <FormField control={form.control} name="notes" render={({ field }) => (<FormItem><FormLabel>หมายเหตุ</FormLabel><FormControl><Textarea {...field}/></FormControl></FormItem>)} />
            </form>
          </Form>
        </div>

        <DialogFooter className="p-6 pt-4 border-t bg-muted/10">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>ยกเลิก</Button>
          <Button 
            type="submit" 
            form="ap-payment-form" 
            disabled={isSubmitting || isBlocked}
          >
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <HandCoins className="mr-2 h-4 w-4"/>}
            บันทึกการจ่าย
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const addCreditorSchema = z.object({
  vendorId: z.string().min(1, "กรุณาเลือก Vendor"),
  invoiceNo: z.string().min(1, "กรุณากรอกเลขที่บิล"),
  docDate: z.string().min(1, "กรุณาเลือกวันที่เอกสาร"),
  dueDate: z.string().optional(),
  amountTotal: z.coerce.number().positive("ยอดเงินต้องมากกว่า 0"),
  notes: z.string().optional(),
});

function AddCreditorDialog({ vendors, isOpen, onClose }: { vendors: WithId<Vendor>[]; isOpen: boolean; onClose: () => void; }) {
    const { db } = useFirebase();
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [vendorSearch, setVendorSearch] = useState("");
    const [isPopoverOpen, setIsPopoverOpen] = useState(false);

    const form = useForm<z.infer<typeof addCreditorSchema>>({
        resolver: zodResolver(addCreditorSchema),
        defaultValues: {
            docDate: new Date().toISOString().split("T")[0],
            amountTotal: 0,
        },
    });

    const filteredVendors = useMemo(() => {
        if (!vendorSearch) return vendors;
        return vendors.filter(v => v.shortName.toLowerCase().includes(vendorSearch.toLowerCase()) || v.companyName.toLowerCase().includes(vendorSearch.toLowerCase()));
    }, [vendors, vendorSearch]);

    const handleSave = async (data: z.infer<typeof addCreditorSchema>) => {
        if (!db) return;
        setIsSubmitting(true);
        const selectedVendor = vendors.find(v => v.id === data.vendorId);
        if (!selectedVendor) {
            toast({ variant: 'destructive', title: 'ไม่พบ Vendor' });
            setIsSubmitting(false);
            return;
        }

        try {
            await addDoc(collection(db, 'accountingObligations'), {
                type: 'AP',
                status: 'UNPAID',
                vendorId: selectedVendor.id,
                vendorShortNameSnapshot: selectedVendor.shortName,
                vendorNameSnapshot: selectedVendor.companyName,
                invoiceNo: data.invoiceNo,
                sourceDocNo: data.invoiceNo,
                sourceDocType: 'PURCHASE_ORDER',
                docDate: data.docDate,
                dueDate: data.dueDate || null,
                amountTotal: data.amountTotal,
                amountPaid: 0,
                balance: data.amountTotal,
                notes: data.notes || '',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            toast({ title: 'บันทึกเจ้าหนี้สำเร็จ' });
            onClose();
            form.reset();
        } catch (e: any) {
            toast({ variant: 'destructive', title: "เกิดข้อผิดพลาด", description: e.message });
        } finally {
            setIsSubmitting(false);
        }
    };
    
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-h-[90vh] flex flex-col p-0 overflow-hidden">
                <DialogHeader className="p-6 pb-0">
                    <DialogTitle>เพิ่มเจ้าหนี้ใหม่</DialogTitle>
                    <DialogDescription>บันทึกบิลที่ได้รับจากร้านค้าภายนอก</DialogDescription>
                </DialogHeader>
                
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <Form {...form}>
                      <form id="add-creditor-form" onSubmit={form.handleSubmit(handleSave)} className="space-y-4">
                          <FormField name="vendorId" control={form.control} render={({ field }) => (
                              <FormItem className="flex flex-col">
                                  <FormLabel>Vendor</FormLabel>
                                  <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
                                  <PopoverTrigger asChild>
                                  <FormControl><Button variant="outline" role="combobox" className="justify-between">
                                      {field.value ? vendors.find(v => v.id === field.value)?.shortName : "เลือก Vendor..."}
                                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                  </Button></FormControl>
                                  </PopoverTrigger><PopoverContent className="w-[--radix-popover-trigger-width] p-0"><Command>
                                  <CommandInput placeholder="ค้นหา..." value={vendorSearch} onValueChange={setVendorSearch} />
                                  <CommandList><CommandEmpty>ไม่พบ Vendor</CommandEmpty><CommandGroup>
                                      {filteredVendors.map((v) => (
                                      <CommandItem value={v.shortName} key={v.id} onSelect={() => { field.onChange(v.id); setIsPopoverOpen(false); }}>
                                          {v.shortName} - {v.companyName}
                                      </CommandItem>
                                      ))}
                                  </CommandGroup></CommandList>
                                  </Command></PopoverContent></Popover>
                                  <FormMessage />
                              </FormItem>
                          )} />
                          <FormField name="invoiceNo" control={form.control} render={({ field }) => (<FormItem><FormLabel>เลขที่บิล (Invoice No.)</FormLabel><FormControl><Input {...field}/></FormControl><FormMessage/></FormItem>)} />
                          <FormField name="amountTotal" control={form.control} render={({ field }) => (<FormItem><FormLabel>ยอดเงินรวม</FormLabel><FormControl><Input type="number" {...field}/></FormControl><FormMessage/></FormItem>)} />
                          <div className="grid grid-cols-2 gap-4">
                              <FormField
                                control={form.control}
                                name="docDate"
                                render={({ field }) => (
                                  <FormItem className="flex flex-col">
                                    <FormLabel>วันที่บนบิล</FormLabel>
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <FormControl>
                                          <Button
                                            variant={"outline"}
                                            className={cn(
                                              "w-full pl-3 text-left font-normal h-10",
                                              !field.value && "text-muted-foreground"
                                            )}
                                          >
                                            {field.value ? format(parseISO(field.value), "dd/MM/yyyy") : <span>เลือกวันที่</span>}
                                            <CalendarDays className="ml-auto h-4 w-4 opacity-50" />
                                          </Button>
                                        </FormControl>
                                      </PopoverTrigger>
                                      <PopoverContent className="w-auto p-0" align="start">
                                        <Calendar
                                          mode="single"
                                          selected={field.value ? parseISO(field.value) : undefined}
                                          onSelect={(date) => field.onChange(date ? format(date, "yyyy-MM-dd") : "")}
                                          initialFocus
                                        />
                                      </PopoverContent>
                                    </Popover>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={form.control}
                                name="dueDate"
                                render={({ field }) => (
                                  <FormItem className="flex flex-col">
                                    <FormLabel>วันครบกำหนดจ่าย</FormLabel>
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <FormControl>
                                          <Button
                                            variant={"outline"}
                                            className={cn(
                                              "w-full pl-3 text-left font-normal h-10",
                                              !field.value && "text-muted-foreground"
                                            )}
                                          >
                                            {field.value ? format(parseISO(field.value), "dd/MM/yyyy") : <span>เลือกวันที่</span>}
                                            <CalendarDays className="ml-auto h-4 w-4 opacity-50" />
                                          </Button>
                                        </FormControl>
                                      </PopoverTrigger>
                                      <PopoverContent className="w-auto p-0" align="start">
                                        <Calendar
                                          mode="single"
                                          selected={field.value ? parseISO(field.value) : undefined}
                                          onSelect={(date) => field.onChange(date ? format(date, "yyyy-MM-dd") : "")}
                                          initialFocus
                                        />
                                      </PopoverContent>
                                    </Popover>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                          </div>
                          <FormField control={form.control} name="notes" render={({ field }) => (<FormItem><FormLabel>หมายเหตุ</FormLabel><FormControl><Textarea {...field}/></FormControl></FormItem>)} />
                      </form>
                  </Form>
                </div>

                 <DialogFooter className="p-6 pt-4 border-t bg-muted/10">
                    <Button variant="outline" onClick={onClose} disabled={isSubmitting}>ยกเลิก</Button>
                    <Button type="submit" form="add-creditor-form" disabled={isSubmitting}>{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}บันทึก</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function ObligationList({ type, searchTerm, accounts, vendors }: { type: 'AR' | 'AP', searchTerm: string, accounts: WithId<AccountingAccount>[], vendors: WithId<Vendor>[] }) {
    const { db } = useFirebase();
    const { toast } = useToast();
    const router = useRouter();
    
    const [obligations, setObligations] = useState<WithId<AccountingObligation>[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<FirestoreError | null>(null);

    const [docDetails, setDocDetails] = useState<Record<string, { receiptStatus?: string, billingNoteNo?: string }>>({});

    const [payingAR, setPayingAR] = useState<WithId<AccountingObligation> | null>(null);
    const [payingAP, setPayingAP] = useState<WithId<AccountingObligation> | null>(null);
    
    const obligationsQuery = useMemo(() => {
        if (!db) return null;
        return query(
            collection(db, "accountingObligations"),
            where("type", "==", type),
            limit(500)
        );
    }, [db, type]);

    useEffect(() => {
        if (!obligationsQuery) return;
        
        setLoading(true);
        setError(null);

        const unsubscribe = onSnapshot(obligationsQuery, (snap) => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<AccountingObligation>));
            let filtered = data.filter(ob => ob.status === 'UNPAID' || ob.status === 'PARTIAL');

            filtered.sort((a, b) => {
                const da = a.dueDate ? parseISO(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
                const db = b.dueDate ? parseISO(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
                return da - db;
            });

            setObligations(filtered);
            setLoading(false);
        }, (err: FirestoreError) => {
            console.error(`Error loading ${type} obligations:`, err);
            setError(err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [obligationsQuery, type]);

    useEffect(() => {
        if (type !== 'AR' || obligations.length === 0 || !db) return;

        const arSourceDocIds = Array.from(new Set(obligations.map(ob => ob.sourceDocId).filter(Boolean)));
        
        const unsubscribes = arSourceDocIds.map(docId => {
            return onSnapshot(doc(db, 'documents', docId!), (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    setDocDetails(prev => ({
                        ...prev,
                        [docId!]: {
                            receiptStatus: data.receiptStatus || 'NONE',
                            billingNoteNo: data.billingNoteNo
                        }
                    }));
                }
            });
        });

        return () => unsubscribes.forEach(unsub => unsub());
    }, [obligations, type, db]);

    const filteredObligations = useMemo(() => {
        if (!searchTerm) return obligations;
        const lowerSearch = searchTerm.toLowerCase();
        return obligations.filter(ob =>
            ob.customerNameSnapshot?.toLowerCase().includes(lowerSearch) ||
            ob.vendorShortNameSnapshot?.toLowerCase().includes(lowerSearch) ||
            ob.vendorNameSnapshot?.toLowerCase().includes(lowerSearch) ||
            ob.sourceDocNo.toLowerCase().includes(lowerSearch) ||
            ob.invoiceNo?.toLowerCase().includes(lowerSearch)
        );
    }, [obligations, searchTerm]);

    if (loading) {
        return <div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>;
    }
    if (error) {
        return <div className="text-center p-8 text-destructive"><AlertCircle className="mx-auto mb-2" />{error.message}</div>;
    }

    const renderTable = () => (
      <Table>
          <TableHeader>
              <TableRow>
                  <TableHead>Due Date</TableHead>
                  <TableHead>{type === 'AR' ? 'Doc No.' : 'Invoice No.'}</TableHead>
                  <TableHead>{type === 'AR' ? 'Customer' : 'Vendor'}</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="text-right">Action</TableHead>
              </TableRow>
          </TableHeader>
          <TableBody>
              {filteredObligations.length > 0 ? filteredObligations.map(ob => {
                  const details = docDetails[ob.sourceDocId || ''];
                  const isReceiptIssued = details?.receiptStatus === 'ISSUED_NOT_CONFIRMED' || details?.receiptStatus === 'CONFIRMED';
                  
                  return (
                    <TableRow key={ob.id}>
                        <TableCell className="text-xs">{ob.dueDate ? safeFormat(parseISO(ob.dueDate), APP_DATE_FORMAT) : '-'}</TableCell>
                        <TableCell>
                            <div className="font-medium">{type === 'AR' ? ob.sourceDocNo : (ob.invoiceNo || ob.sourceDocNo)}</div>
                            {details?.billingNoteNo && (
                                <Badge variant="secondary" className="text-[9px] h-4 mt-1 bg-amber-50 text-amber-700 border-amber-200">
                                    <FileStack className="h-2.5 w-2.5 mr-1" /> วางบิลแล้ว: {details.billingNoteNo}
                                </Badge>
                            )}
                        </TableCell>
                        <TableCell className="text-sm">{type === 'AR' ? ob.customerNameSnapshot : (ob.vendorShortNameSnapshot || ob.vendorNameSnapshot)}</TableCell>
                        <TableCell className="text-right text-xs">{formatCurrency(ob.amountTotal)}</TableCell>
                        <TableCell className="text-right text-xs text-green-600">{formatCurrency(ob.amountPaid)}</TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(ob.balance)}</TableCell>
                        <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                                {type === 'AR' && ob.sourceDocType === 'TAX_INVOICE' && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <span>
                                                    <Button 
                                                        size="sm" 
                                                        variant={isReceiptIssued ? "secondary" : "default"} 
                                                        disabled={isReceiptIssued}
                                                        onClick={() => router.push(`/app/management/accounting/documents/receipt?customerId=${ob.customerId}&sourceDocId=${ob.sourceDocId}`)}
                                                    >
                                                        <Receipt className="mr-2 h-4 w-4" />
                                                        ออกใบเสร็จ
                                                    </Button>
                                                </span>
                                            </TooltipTrigger>
                                            {isReceiptIssued && <TooltipContent>ออกใบเสร็จไปแล้ว ({details?.receiptStatus})</TooltipContent>}
                                        </Tooltip>
                                    </TooltipProvider>
                                )}
                                {type === 'AR' ? (
                                    <Button size="sm" variant="outline" onClick={() => setPayingAR(ob)}>
                                        <HandCoins className="mr-2 h-4 w-4" /> รับชำระ
                                    </Button>
                                ) : (
                                    <Button size="sm" variant="outline" onClick={() => setPayingAP(ob)}>
                                        <HandCoins className="mr-2 h-4 w-4" /> จ่ายบิล
                                    </Button>
                                )}
                            </div>
                        </TableCell>
                    </TableRow>
                  );
              }) : (
                  <TableRow><TableCell colSpan={7} className="h-24 text-center">{type === 'AR' ? 'ไม่พบรายการลูกหนี้คงค้าง' : 'ไม่พบรายการเจ้าหนี้คงค้าง'}</TableCell></TableRow>
              )}
          </TableBody>
      </Table>
    );

    return (
        <>
            {renderTable()}
            {payingAR && (
                <ReceivePaymentDialog isOpen={!!payingAR} onClose={() => setPayingAR(null)} obligation={payingAR} accounts={accounts} />
            )}
            {payingAP && (
                <PayCreditorDialog isOpen={!!payingAP} onClose={() => setPayingAP(null)} obligation={payingAP} accounts={accounts} />
            )}
        </>
    );
}

function ReceivablesPayablesContent({ profile }: { profile: UserProfile }) {
    const searchParams = useSearchParams();
    const defaultTab = searchParams.get('tab') === 'creditors' ? 'creditors' : 'debtors';
    const [activeTab, setActiveTab] = useState(defaultTab);
    const [searchTerm, setSearchTerm] = useState("");
    const [accounts, setAccounts] = useState<WithId<AccountingAccount>[]>([]);
    const [vendors, setVendors] = useState<WithId<Vendor>[]>([]);
    const [isAddingCreditor, setIsAddingCreditor] = useState(false);
    const { db } = useFirebase();

    useEffect(() => {
        if (!db) return;
        const accountsQ = query(collection(db, "accountingAccounts"), where("isActive", "==", true));
        const unsubAccounts = onSnapshot(accountsQ, (snap) => {
            setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<AccountingAccount>)));
        });
        
        const vendorsQ = query(collection(db, "vendors"), where("isActive", "==", true));
        const unsubVendors = onSnapshot(vendorsQ, (snap) => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<Vendor>));
            data.sort((a, b) => String(a.shortName || "").localeCompare(String(b.shortName || ""), 'th'));
            setVendors(data);
        });

        return () => { unsubAccounts(); unsubVendors(); };
    }, [db]);


    return (
        <>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <TabsList>
                    <TabsTrigger value="debtors">ลูกหนี้ (Debtors)</TabsTrigger>
                    <TabsTrigger value="creditors">เจ้าหนี้ (Creditors)</TabsTrigger>
                </TabsList>
                <div className="flex w-full md:w-auto items-center gap-2">
                    {activeTab === 'creditors' && (
                        <Button onClick={() => setIsAddingCreditor(true)}><PlusCircle className="mr-2 h-4 w-4"/> เพิ่มเจ้าหนี้</Button>
                    )}
                    <div className="w-full md:w-80 relative flex-1">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="ค้นหาจากชื่อ, เลขที่เอกสาร..." className="pl-10" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                    </div>
                </div>
            </div>
            <Card>
              <CardContent className="pt-6">
                <TabsContent value="debtors" className="mt-0">
                    <ObligationList type="AR" searchTerm={searchTerm} accounts={accounts} vendors={vendors} />
                </TabsContent>
                <TabsContent value="creditors" className="mt-0">
                    <ObligationList type="AP" searchTerm={searchTerm} accounts={accounts} vendors={vendors} />
                </TabsContent>
              </CardContent>
            </Card>
        </Tabs>
        <AddCreditorDialog vendors={vendors} isOpen={isAddingCreditor} onClose={() => setIsAddingCreditor(false)} />
        </>
    );
}

export default function ReceivablesPayablesPage() {
    const { profile, loading } = useAuth();
    const hasPermission = useMemo(() => profile?.role === 'ADMIN' || profile?.role === 'MANAGER' || profile?.department === 'MANAGEMENT', [profile]);

    if (loading) {
        return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;
    }

    if (!profile || !hasPermission) {
        return (
            <div className="w-full">
                <PageHeader title="ลูกหนี้/เจ้าหนี้" />
                <Card className="text-center py-12">
                    <CardHeader>
                        <CardTitle>ไม่มีสิทธิ์เข้าถึง</CardTitle>
                        <CardDescription>หน้านี้สงวนไว้สำหรับผู้ดูแลระบบหรือฝ่ายบริหารเท่านั้น</CardDescription>
                    </CardHeader>
                </Card>
            </div>
        );
    }

    return (
        <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>}>
            <PageHeader title="ลูกหนี้/เจ้าหนี้" description="จัดการและติดตามข้อมูลลูกหนี้และเจ้าหนี้" />
            <ReceivablesPayablesContent profile={profile} />
        </Suspense>
    );
}
