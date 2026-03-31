"use client";

import { useMemo, Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { useFirebase, useCollection, useDoc, type WithId } from "@/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  writeBatch,
  serverTimestamp,
  getDoc,
  getDocs,
  deleteField,
  type FirestoreError,
  type Firestore,
  type QueryDocumentSnapshot,
  type DocumentData,
  addDoc,
  limit,
  orderBy,
  startAfter,
  runTransaction,
} from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format as dfFormat, parseISO, startOfMonth, endOfMonth, getYear } from "date-fns";

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
import { Loader2, Search, AlertCircle, HandCoins, ExternalLink, PlusCircle, ChevronsUpDown, Receipt, Wallet, ArrowDownCircle, Info, FileStack, CalendarDays, Filter, Calculator } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Calendar } from "@/components/ui/calendar";

import type {
  AccountingObligation,
  AccountingAccount,
  UserProfile,
  Vendor,
  Document as DocumentType,
  AccountingEntry,
  PurchaseDoc,
  StoreSettings,
  DocumentSettings,
} from "@/lib/types";
import { safeFormat, APP_DATE_FORMAT } from "@/lib/date-utils";
import { cn, sanitizeForFirestore } from "@/lib/utils";
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { ReceiveArPaymentDialog } from "@/components/accounting/receive-ar-payment-dialog";

const formatCurrency = (value: number | null | undefined) => {
  return (value ?? 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

/** ดึงใบกำกับ APPROVED ทั้งชุดที่เกี่ยวกับการซ่อมลูกหนี้ — แบ่งหน้า + orderBy ไม่ให้พลาดใบที่ไม่อยู่ใน limit แรก */
async function getApprovedTaxInvoiceSnapshotsPaged(db: Firestore): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  const pageSize = 200;
  const maxPages = 50;
  const out: QueryDocumentSnapshot<DocumentData>[] = [];
  let last: QueryDocumentSnapshot<DocumentData> | undefined;
  for (let p = 0; p < maxPages; p++) {
    const q = last
      ? query(
          collection(db, "documents"),
          where("status", "==", "APPROVED"),
          where("docType", "==", "TAX_INVOICE"),
          orderBy("updatedAt", "desc"),
          startAfter(last),
          limit(pageSize)
        )
      : query(
          collection(db, "documents"),
          where("status", "==", "APPROVED"),
          where("docType", "==", "TAX_INVOICE"),
          orderBy("updatedAt", "desc"),
          limit(pageSize)
        );
    const snap = await getDocs(q);
    if (snap.empty) break;
    out.push(...snap.docs);
    last = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < pageSize) break;
  }
  return out;
}

const apPaymentSchema = z.object({
  paymentDate: z.string().min(1, "กรุณาเลือกวันที่"),
  amount: z.coerce.number().positive("จำนวนเงินต้องมากกว่า 0"),
  accountId: z.string().min(1, "กรุณาเลือกบัญชี"),
  paymentInstrument: z.enum(["CASH", "TRANSFER", "CHECK"]).default("TRANSFER"),
  checkDueDate: z.string().optional(),
  notes: z.string().optional(),
  withholdingEnabled: z.boolean().default(false),
  withholdingPercent: z.coerce.number().min(0).max(100).optional(),
}).superRefine((data, ctx) => {
  if (data.paymentInstrument === "CHECK" && !data.checkDueDate?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "กรุณาระบุวันครบกำหนดเช็ค",
      path: ["checkDueDate"],
    });
  }
});

function PayCreditorDialog({ obligation, accounts, isOpen, onClose }: { obligation: WithId<AccountingObligation>; accounts: WithId<AccountingAccount>[]; isOpen: boolean; onClose: () => void; }) {
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<z.infer<typeof apPaymentSchema>>({
    resolver: zodResolver(apPaymentSchema),
    defaultValues: {
      paymentDate: "",
      amount: obligation.balance,
      notes: "",
      accountId: accounts[0]?.id || "",
      paymentInstrument: "TRANSFER",
      checkDueDate: "",
      withholdingEnabled: false,
      withholdingPercent: 3,
    },
  });
  
  const watchedAccountId = form.watch("accountId");
  const watchedAmount = form.watch("amount") || 0;
  const watchedWhtEnabled = form.watch("withholdingEnabled");
  const watchedWhtPercent = form.watch("withholdingPercent") || 0;
  const watchedInstrument = form.watch("paymentInstrument");

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
      return { whtBase, whtAmount: whtBase * (watchedWhtPercent / 100) };
  }, [sourceDoc, watchedWhtEnabled, watchedWhtPercent, watchedAmount, obligation.sourceDocType]);

  const cashOutAmount = watchedAmount - whtInfo.whtAmount;
  const balanceAfter = currentBalance - cashOutAmount;
  const isInsufficient = currentBalance < cashOutAmount;
  const canOverride = profile?.role === 'ADMIN' || profile?.role === 'MANAGER';
  const isBlocked = isInsufficient && !canOverride;

  useEffect(() => {
    if (isOpen) {
        form.reset({ paymentDate: dfFormat(new Date(), "yyyy-MM-dd"), amount: obligation.balance, notes: "", accountId: accounts[0]?.id || "", paymentInstrument: "TRANSFER", checkDueDate: "", withholdingEnabled: false, withholdingPercent: 3 });
    }
  }, [obligation, accounts, form, isOpen]);

  const handleSavePayment = async (data: z.infer<typeof apPaymentSchema>) => {
    if (!db || !profile || !storeSettings) return;
    const account = accounts.find(a => a.id === data.accountId);
    if (!account) return;
    if (data.withholdingEnabled) {
        if (!storeSettings.taxId) { toast({ variant: 'destructive', title: 'ข้อมูลร้านไม่ครบถ้วน', description: 'กรุณาตั้งค่าเลขผู้เสียภาษีของร้านก่อนออกใบหัก ณ ที่จ่าย'}); return; }
        if (obligation.sourceDocType === 'PURCHASE' && sourceDoc) {
            const purchase = sourceDoc as PurchaseDoc;
            if (!purchase.vendorSnapshot.taxId || !purchase.vendorSnapshot.address) { toast({ variant: 'destructive', title: 'ข้อมูลร้านค้าไม่ครบถ้วน', description: 'ร้านค้าต้องมีเลขผู้เสียภาษีและที่อยู่เพื่อออกใบหัก ณ ที่จ่าย'}); return; }
        }
    }
    setIsSubmitting(true);
    if (data.paymentInstrument === "CASH" && account.type !== "CASH") {
      toast({ variant: "destructive", title: "บัญชีไม่ตรงกับวิธีจ่าย", description: "เลือกบัญชีเงินสดเมื่อจ่ายเงินสด" });
      return;
    }
    if ((data.paymentInstrument === "TRANSFER" || data.paymentInstrument === "CHECK") && account.type === "CASH") {
      toast({ variant: "destructive", title: "บัญชีไม่ตรงกับวิธีจ่าย", description: "เลือกบัญชีธนาคารเมื่อจ่ายโอนหรือจ่ายเช็ค" });
      return;
    }

    const paymentMethod = data.paymentInstrument === "CASH" ? "CASH" : "TRANSFER";
    try {
      if (data.paymentInstrument === "CHECK") {
        const checkDue = data.checkDueDate?.trim();
        if (!checkDue) {
          toast({ variant: "destructive", title: "กรุณาระบุวันครบกำหนดเช็ค" });
          return;
        }

        await addDoc(collection(db, "accountingCheckItems"), sanitizeForFirestore({
          direction: "PAY",
          status: "PENDING",
          amount: data.amount,
          dueDate: checkDue,
          accountId: data.accountId,
          obligationId: obligation.id,
          purchaseDocId: obligation.sourceDocType === "PURCHASE" ? obligation.sourceDocId : undefined,
          sourceDocType: obligation.sourceDocType,
          sourceDocId: obligation.sourceDocId,
          sourceDocNo: obligation.invoiceNo || obligation.sourceDocNo,
          vendorId: obligation.vendorId,
          vendorNameSnapshot: obligation.vendorNameSnapshot || obligation.vendorShortNameSnapshot,
          withholdingEnabled: data.withholdingEnabled,
          withholdingPercent: data.withholdingEnabled ? data.withholdingPercent : null,
          notes: data.notes || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdByUid: profile.uid,
          createdByName: profile.displayName ?? "",
        }));
        toast({ title: "บันทึกเช็คจ่ายแล้ว", description: "จะตัดบัญชีและตัดเจ้าหนี้เมื่อกดยืนยันในแท็บเช็ค" });
        onClose();
        return;
      }

      await runTransaction(db, async (transaction) => {
        const year = new Date(data.paymentDate).getFullYear();
        const counterRef = doc(db, 'documentCounters', String(year));
        const docSettingsRef = doc(db, 'settings', 'documents');
        const [counterSnap, settingsSnap] = await Promise.all([ transaction.get(counterRef), transaction.get(docSettingsRef) ]);
        const settingsData = settingsSnap.exists() ? settingsSnap.data() as DocumentSettings : {};
        const whtPrefix = settingsData.withholdingTaxPrefix || 'WHT';
        let currentCounters = counterSnap.exists() ? counterSnap.data() as any : { year };
        const lastWhtPrefix = currentCounters.withholdingTaxPrefix;
        const lastWhtCount = currentCounters.withholdingTax || 0;
        let newWhtCount = (lastWhtPrefix !== whtPrefix) ? 1 : lastWhtCount + 1;
        let whtDocId = '';
        if (data.withholdingEnabled && obligation.sourceDocType === 'PURCHASE' && sourceDoc) {
            const purchase = sourceDoc as PurchaseDoc;
            const whtDocNo = `${whtPrefix}${year}-${String(newWhtCount).padStart(4, '0')}`;
            const whtRef = doc(collection(db, 'documents'));
            whtDocId = whtRef.id;
            transaction.set(whtRef, sanitizeForFirestore({ id: whtDocId, docType: 'WITHHOLDING_TAX', docNo: whtDocNo, docDate: data.paymentDate, payerSnapshot: storeSettings, payeeSnapshot: { name: purchase.vendorSnapshot.companyName, taxId: purchase.vendorSnapshot.taxId, address: purchase.vendorSnapshot.address }, vendorId: purchase.vendorId, paidMonth: new Date(data.paymentDate).getMonth() + 1, paidYear: year, incomeTypeCode: 'ITEM5', paidAmountGross: whtInfo.whtBase, withholdingPercent: data.withholdingPercent, withholdingAmount: whtInfo.whtAmount, paidAmountNet: whtInfo.whtBase - whtInfo.whtAmount, status: 'ISSUED', senderName: profile.displayName, receiverName: purchase.vendorSnapshot.companyName, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
            transaction.set(counterRef, { ...currentCounters, withholdingTax: newWhtCount, withholdingTaxPrefix: whtPrefix }, { merge: true });
        }
        const entryRef = doc(collection(db, "accountingEntries"));
        transaction.set(entryRef, sanitizeForFirestore({ entryType: "CASH_OUT", entryDate: data.paymentDate, amount: cashOutAmount, grossAmount: data.amount, accountId: data.accountId, paymentMethod: paymentMethod, description: `จ่ายเจ้าหนี้: ${obligation.vendorShortNameSnapshot || obligation.vendorNameSnapshot} (บิล: ${obligation.invoiceNo || obligation.sourceDocNo})`, notes: data.notes, vendorId: obligation.vendorId, vendorShortNameSnapshot: obligation.vendorShortNameSnapshot, vendorNameSnapshot: obligation.vendorNameSnapshot, sourceDocNo: obligation.invoiceNo || obligation.sourceDocNo, obligationId: obligation.id, sourceDocType: obligation.sourceDocType, sourceDocId: obligation.sourceDocId, withholdingEnabled: data.withholdingEnabled, withholdingPercent: data.withholdingPercent, withholdingAmount: whtInfo.whtAmount, withholdingTaxDocId: whtDocId, vatAmount: sourceDoc?.vatAmount || 0, netAmount: sourceDoc?.subtotal || data.amount, createdAt: serverTimestamp() }));
        const obligationRef = doc(db, 'accountingObligations', obligation.id);
        const newAmountPaid = Math.round(((obligation.amountPaid || 0) + data.amount) * 100) / 100;
        const newBalance = Math.max(0, Math.round((obligation.amountTotal - newAmountPaid) * 100) / 100);
        const newStatus = newBalance <= 0.05 ? 'PAID' : 'PARTIAL';
        transaction.update(obligationRef, { amountPaid: newAmountPaid, balance: newBalance, status: newStatus, lastPaymentDate: data.paymentDate, paidOffDate: newStatus === 'PAID' ? data.paymentDate : null, updatedAt: serverTimestamp() });
        if (obligation.sourceDocId) {
            const col = obligation.sourceDocType === 'PURCHASE' ? 'purchaseDocs' : 'documents';
            transaction.update(doc(db, col, obligation.sourceDocId), { status: newStatus, updatedAt: serverTimestamp(), accountingEntryId: entryRef.id });
        }
      });
      toast({ title: "บันทึกการจ่ายเจ้าหนี้สำเร็จ" });
      onClose();
    } catch (e: any) { toast({ variant: 'destructive', title: "เกิดข้อผิดพลาด", description: e.message }); } finally { setIsSubmitting(false); }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-0"><DialogTitle>จ่ายเจ้าหนี้</DialogTitle><DialogDescription>สำหรับบิลเลขที่: {obligation.invoiceNo || obligation.sourceDocNo} ({obligation.vendorShortNameSnapshot || obligation.vendorNameSnapshot})</DialogDescription></DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <Form {...form}>
            <form id="ap-payment-form" onSubmit={form.handleSubmit(handleSavePayment)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="paymentDate" render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>วันที่จ่ายเงิน</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal h-10", !field.value && "text-muted-foreground")}>{field.value ? dfFormat(parseISO(field.value), "dd/MM/yyyy") : <span>เลือกวันที่</span>}<CalendarDays className="ml-auto h-4 w-4 opacity-50"/></Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value ? parseISO(field.value) : undefined} onSelect={(date) => field.onChange(date ? dfFormat(date, "yyyy-MM-dd") : "")} initialFocus/></PopoverContent></Popover><FormMessage/></FormItem>)} />
                <FormField name="amount" render={({ field }) => (<FormItem><FormLabel>ยอดตัดหนี้ (Gross)</FormLabel><FormControl><Input type="number" {...field}/></FormControl><FormMessage/></FormItem>)} />
              </div>
              <div className="grid grid-cols-1 gap-4">
                <FormField name="accountId" control={form.control} render={({ field }) => (<FormItem><FormLabel>หักจากบัญชี</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="เลือกบัญชีที่ใช้จ่าย..."/></SelectTrigger></FormControl><SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.type === 'CASH' ? 'เงินสด' : 'โอน'})</SelectItem>)}</SelectContent></Select><FormMessage/></FormItem>)} />
              </div>
              <FormField control={form.control} name="paymentInstrument" render={({ field }) => (
                <FormItem>
                  <FormLabel>วิธีจ่ายจริง</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="TRANSFER">โอนเงิน (ตัดบัญชีทันที)</SelectItem>
                      <SelectItem value="CASH">เงินสด (ตัดบัญชีทันที)</SelectItem>
                      <SelectItem value="CHECK">เช็คจ่าย (รอยืนยันในแท็บเช็ค)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              {watchedInstrument === "CHECK" ? (
                <FormField control={form.control} name="checkDueDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>วันครบกำหนดเช็ค</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              ) : null}
              <div className="p-4 border rounded-md bg-muted/20 space-y-4">
                  <FormField control={form.control} name="withholdingEnabled" render={({ field }) => (<FormItem className="flex items-center gap-2 space-y-0"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel className="font-semibold text-primary cursor-pointer">หักภาษี ณ ที่จ่าย (WHT)</FormLabel></FormItem>)} />
                  {watchedWhtEnabled && (<div className="space-y-3 pt-2 animate-in slide-in-from-top-1"><FormField control={form.control} name="withholdingPercent" render={({ field }) => (<FormItem><FormLabel>อัตราหัก (%)</FormLabel><Select onValueChange={(v) => field.onChange(Number(v))} value={field.value?.toString()}><FormControl><SelectTrigger className="h-8"><SelectValue/></SelectTrigger></FormControl><SelectContent><SelectItem value="1">1% (ขนส่ง)</SelectItem><SelectItem value="3">3% (บริการ)</SelectItem></SelectContent></Select></FormItem>)} />{sourceDoc?.withTax && (<div className="flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 p-1 rounded"><Info className="h-3 w-3" />มี VAT: คำนวณ WHT จากยอดก่อนภาษี ({formatCurrency(sourceDoc.subtotal)})</div>)}<div className="flex justify-between text-xs font-medium text-destructive"><span>ยอดหักภาษี:</span><span>-{formatCurrency(whtInfo.whtAmount)}</span></div></div>)}
              </div>
              <div className="p-4 border rounded-md bg-muted/30 space-y-2"><h4 className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-2"><Wallet className="h-3 w-3" /> ตรวจสอบยอดเงิน</h4>{isLoadingAccount || isLoadingEntries ? (<div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin"/> กำลังคำนวณ...</div>) : (<div className="space-y-1 text-sm"><div className="flex justify-between"><span>ยอดคงเหลือปัจจุบัน:</span><span className="font-medium">{formatCurrency(currentBalance)}</span></div><div className="flex justify-between text-destructive"><span>เงินออกจริงครั้งนี้:</span><span className="font-medium">-{formatCurrency(cashOutAmount)}</span></div><Separator className="my-1"/><div className={cn("flex justify-between font-bold", balanceAfter < 0 ? "text-destructive" : "text-green-600")}><span>คงเหลือประมาณการ:</span><span>{formatCurrency(balanceAfter)}</span></div></div>)}</div>
              {isInsufficient && (<div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-sm"><AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /><div><p className="font-bold">ยอดเงินไม่เพียงพอ</p>{isBlocked ? (<p className="text-xs">กรุณาเลือกบัญชีที่มีเงินพอ หรือติดต่อ Admin</p>) : (<p className="text-xs italic">Admin/Manager: กด "บันทึก" เพื่อยืนยันรายการติดลบ</p>)}</div></div>)}
              <FormField control={form.control} name="notes" render={({ field }) => (<FormItem><FormLabel>หมายเหตุ</FormLabel><FormControl><Textarea {...field}/></FormControl></FormItem>)} />
            </form>
          </Form>
        </div>
        <DialogFooter className="p-6 pt-4 border-t bg-muted/10"><Button variant="outline" onClick={onClose} disabled={isSubmitting}>ยกเลิก</Button><Button type="submit" form="ap-payment-form" disabled={isSubmitting || isBlocked}>{isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <HandCoins className="mr-2 h-4 w-4"/>}บันทึกการจ่าย</Button></DialogFooter>
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
    const form = useForm<z.infer<typeof addCreditorSchema>>({ resolver: zodResolver(addCreditorSchema), defaultValues: { docDate: "", amountTotal: 0 } });
    useEffect(() => { if (isOpen) { form.reset({ docDate: dfFormat(new Date(), "yyyy-MM-dd"), amountTotal: 0 }); } }, [isOpen, form]);
    const filteredVendors = useMemo(() => { if (!vendorSearch) return vendors; return vendors.filter(v => v.shortName.toLowerCase().includes(vendorSearch.toLowerCase()) || v.companyName.toLowerCase().includes(vendorSearch.toLowerCase())); }, [vendors, vendorSearch]);
    const handleSave = async (data: z.infer<typeof addCreditorSchema>) => {
        if (!db) return;
        setIsSubmitting(true);
        const selectedVendor = vendors.find(v => v.id === data.vendorId);
        if (!selectedVendor) { toast({ variant: 'destructive', title: 'ไม่พบ Vendor' }); setIsSubmitting(false); return; }
        try {
            await addDoc(collection(db, 'accountingObligations'), { type: 'AP', status: 'UNPAID', vendorId: selectedVendor.id, vendorShortNameSnapshot: selectedVendor.shortName, vendorNameSnapshot: selectedVendor.companyName, invoiceNo: data.invoiceNo, sourceDocNo: data.invoiceNo, sourceDocType: 'PURCHASE_ORDER', docDate: data.docDate, dueDate: data.dueDate || null, amountTotal: data.amountTotal, amountPaid: 0, balance: data.amountTotal, notes: data.notes || '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
            toast({ title: 'บันทึกเจ้าหนี้สำเร็จ' }); onClose(); form.reset();
        } catch (e: any) { toast({ variant: 'destructive', title: "เกิดข้อผิดพลาด", description: e.message }); } finally { setIsSubmitting(false); }
    };
    return (<Dialog open={isOpen} onOpenChange={onClose}><DialogContent className="max-h-[90vh] flex flex-col p-0 overflow-hidden"><DialogHeader className="p-6 pb-0"><DialogTitle>เพิ่มเจ้าหนี้ใหม่</DialogTitle><DialogDescription>บันทึกบิลที่ได้รับจากร้านค้าภายนอก</DialogDescription></DialogHeader><div className="flex-1 overflow-y-auto px-6 py-4"><Form {...form}><form id="add-creditor-form" onSubmit={form.handleSubmit(handleSave)} className="space-y-4"><FormField name="vendorId" control={form.control} render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>Vendor</FormLabel><Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}><PopoverTrigger asChild><FormControl><Button variant="outline" role="combobox" className="justify-between">{field.value ? vendors.find(v => v.id === field.value)?.shortName : "เลือก Vendor..."}<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50"/></Button></FormControl></PopoverTrigger><PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start"><Command><CommandInput placeholder="ค้นหา..." value={vendorSearch} onValueChange={setVendorSearch}/><CommandList><CommandEmpty>ไม่พบ Vendor</CommandEmpty><CommandGroup>{filteredVendors.map((v) => (<CommandItem value={v.shortName} key={v.id} onSelect={() => { field.onChange(v.id); setIsPopoverOpen(false); }}>{v.shortName} - {v.companyName}</CommandItem>))}</CommandGroup></CommandList></Command></PopoverContent></Popover><FormMessage/></FormItem>)}/><FormField name="invoiceNo" render={({ field }) => (<FormItem><FormLabel>เลขที่บิล (Invoice No.)</FormLabel><FormControl><Input {...field}/></FormControl><FormMessage/></FormItem>)}/><FormField name="amountTotal" render={({ field }) => (<FormItem><FormLabel>ยอดเงินรวม</FormLabel><FormControl><Input type="number" {...field}/></FormControl><FormMessage/></FormItem>)}/><div className="grid grid-cols-2 gap-4"><FormField control={form.control} name="docDate" render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>วันที่บนบิล</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal h-10", !field.value && "text-muted-foreground")}>{field.value ? dfFormat(parseISO(field.value), "dd/MM/yyyy") : <span>เลือกวันที่</span>}<CalendarDays className="ml-auto h-4 w-4 opacity-50"/></Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value ? parseISO(field.value) : undefined} onSelect={(date) => field.onChange(date ? dfFormat(date, "yyyy-MM-dd") : "")} initialFocus/></PopoverContent></Popover><FormMessage/></FormItem>)}/><FormField control={form.control} name="dueDate" render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>วันครบกำหนดจ่าย</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal h-10", !field.value && "text-muted-foreground")}>{field.value ? dfFormat(parseISO(field.value), "dd/MM/yyyy") : <span>เลือกวันที่</span>}<CalendarDays className="ml-auto h-4 w-4 opacity-50"/></Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value ? parseISO(field.value) : undefined} onSelect={(date) => field.onChange(date ? dfFormat(date, "yyyy-MM-dd") : "")} initialFocus/></PopoverContent></Popover><FormMessage/></FormItem>)} /></div><FormField control={form.control} name="notes" render={({ field }) => (<FormItem><FormLabel>หมายเหตุ</FormLabel><FormControl><Textarea {...field}/></FormControl></FormItem>)}/></form></Form></div><DialogFooter className="p-6 pt-4 border-t bg-muted/10"><Button variant="outline" onClick={onClose} disabled={isSubmitting}>ยกเลิก</Button><Button type="submit" form="add-creditor-form" disabled={isSubmitting}>{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}บันทึก</Button></DialogFooter></DialogContent></Dialog>)
}

function ObligationList({ type, searchTerm, monthFilter, accounts, vendors, onSummaryChange }: { type: 'AR' | 'AP', searchTerm: string, monthFilter?: string, accounts: WithId<AccountingAccount>[], vendors: WithId<Vendor>[], onSummaryChange: (total: number, count: number) => void }) {
    const { db } = useFirebase();
    const router = useRouter();
    const [obligations, setObligations] = useState<WithId<AccountingObligation>[]>([]);
    const [loading, setLoading] = useState(true);
    const [docDetails, setDocDetails] = useState<
      Record<
        string,
        {
          receiptStatus?: string;
          billingNoteNo?: string;
          customerId?: string;
          customerNameFromDoc?: string;
          customerTaxNameFromDoc?: string;
        }
      >
    >({});
    const [payingAR, setPayingAR] = useState<WithId<AccountingObligation> | null>(null);
    const [payingAP, setPayingAP] = useState<WithId<AccountingObligation> | null>(null);
    const { toast } = useToast();

    /**
     * ซ่อมความไม่สอดคล้องระหว่าง Inbox (documents) กับหน้าลูกหนี้ (accountingObligations):
     * 1) obligation PAID แต่ใบกำกับกลับเป็น APPROVED รอใบเสร็จ → รีเซ็ต UNPAID
     * 2) ใบกำกับ APPROVED รอใบเสร็จ แต่ไม่มี AR_<docId> → สร้าง obligation (ดึงแบบแบ่งหน้า + orderBy ไม่ให้พลาดใบนอก limit แรก)
     */
    useEffect(() => {
        if (!db || type !== 'AR') return;
        let cancelled = false;
        (async () => {
            try {
                const obSnap = await getDocs(query(collection(db, 'accountingObligations'), where('type', '==', 'AR'), limit(500)));
                if (cancelled) return;
                const batchPaid = writeBatch(db);
                let nPaid = 0;
                for (const d of obSnap.docs) {
                    const ob = { id: d.id, ...d.data() } as WithId<AccountingObligation>;
                    if (ob.status !== 'PAID' || ob.sourceDocType !== 'TAX_INVOICE' || !ob.sourceDocId) continue;
                    const src = await getDoc(doc(db, 'documents', ob.sourceDocId));
                    if (!src.exists()) continue;
                    const docData = src.data() as DocumentType;
                    if (docData.status === 'APPROVED' && !docData.receiptDocId) {
                        const total = typeof ob.amountTotal === 'number' ? ob.amountTotal : docData.grandTotal;
                        batchPaid.update(doc(db, 'accountingObligations', ob.id), {
                            status: 'UNPAID',
                            amountPaid: 0,
                            balance: total,
                            lastPaymentDate: deleteField(),
                            paidOffDate: deleteField(),
                            updatedAt: serverTimestamp(),
                        });
                        nPaid++;
                    }
                }
                if (nPaid > 0 && !cancelled) await batchPaid.commit();

                let invDocs: QueryDocumentSnapshot<DocumentData>[] = [];
                try {
                    invDocs = await getApprovedTaxInvoiceSnapshotsPaged(db);
                } catch (e: unknown) {
                    const msg = e instanceof Error ? e.message : String(e);
                    const urlMatch = msg.match(/https?:\/\/[^\s]+/);
                    if (urlMatch) {
                        toast({
                            variant: 'destructive',
                            title: 'ต้องสร้าง Firestore index',
                            description: `เปิดลิงก์นี้ในเบราว์เซอร์แล้วกดสร้างดัชนี จากนั้นรีเฟรชหน้าลูกหนี้: ${urlMatch[0]}`,
                        });
                    }
                    const snap = await getDocs(
                        query(collection(db, 'documents'), where('status', '==', 'APPROVED'), where('docType', '==', 'TAX_INVOICE'), limit(500))
                    );
                    invDocs = snap.docs;
                }
                if (cancelled) return;

                const batchMissing = writeBatch(db);
                let nMissing = 0;
                for (const d of invDocs) {
                    const docData = { id: d.id, ...d.data() } as DocumentType;
                    if (docData.receiptDocId) continue;
                    const arId = `AR_${d.id}`;
                    const arRef = doc(db, 'accountingObligations', arId);
                    const arExisting = await getDoc(arRef);
                    if (arExisting.exists()) continue;
                    const balance = docData.paymentSummary?.balance ?? docData.grandTotal;
                    const customerName = docData.customerSnapshot?.name || 'Unknown';
                    batchMissing.set(
                        arRef,
                        sanitizeForFirestore({
                            id: arId,
                            type: 'AR',
                            status: 'UNPAID',
                            sourceDocType: 'TAX_INVOICE',
                            sourceDocId: d.id,
                            sourceDocNo: docData.docNo,
                            amountTotal: docData.grandTotal,
                            amountPaid: 0,
                            balance,
                            createdAt: serverTimestamp(),
                            updatedAt: serverTimestamp(),
                            customerId: docData.customerId || docData.customerSnapshot?.id || null,
                            customerNameSnapshot: customerName,
                            jobId: docData.jobId || null,
                            dueDate: docData.dueDate || null,
                            docDate: docData.docDate,
                        })
                    );
                    batchMissing.update(doc(db, 'documents', d.id), {
                        arObligationId: arId,
                        arStatus: docData.arStatus || 'UNPAID',
                        updatedAt: serverTimestamp(),
                    });
                    nMissing++;
                }
                if (nMissing > 0 && !cancelled) {
                    await batchMissing.commit();
                    toast({ title: 'ซ่อมข้อมูลลูกหนี้', description: `สร้างรายการลูกหนี้ที่ขาด ${nMissing} รายการแล้ว` });
                }

                // ชื่อลูกค้าว่างบน obligation → ค้นหาตามชื่อไม่เจอ; ดึงจากเอกสารต้นทางแล้วอัปเดต
                const arAll = await getDocs(query(collection(db, 'accountingObligations'), where('type', '==', 'AR'), limit(1000)));
                if (cancelled) return;
                const batchNames = writeBatch(db);
                let nNames = 0;
                for (const d of arAll.docs) {
                    const ob = { id: d.id, ...d.data() } as WithId<AccountingObligation>;
                    if (!ob.sourceDocId) continue;
                    if (String(ob.customerNameSnapshot || '').trim().length > 0) continue;
                    const src = await getDoc(doc(db, 'documents', ob.sourceDocId));
                    if (!src.exists()) continue;
                    const dd = src.data() as DocumentType;
                    const nm = dd.customerSnapshot?.name || dd.customerSnapshot?.taxName;
                    if (!nm) continue;
                    batchNames.update(doc(db, 'accountingObligations', ob.id), {
                        customerNameSnapshot: dd.customerSnapshot?.name || nm,
                        customerId: dd.customerId || dd.customerSnapshot?.id || ob.customerId || null,
                        updatedAt: serverTimestamp(),
                    });
                    nNames++;
                    if (nNames >= 400) break;
                }
                if (nNames > 0 && !cancelled) {
                    await batchNames.commit();
                    toast({ title: 'อัปเดตชื่อลูกค้าในลูกหนี้', description: `เติมชื่อจากเอกสารต้นทาง ${nNames} รายการ (ให้ค้นหาตามชื่อตรงกับรายการจริง)` });
                }
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                toast({ variant: 'destructive', title: 'ซ่อมข้อมูลลูกหนี้ไม่สำเร็จ', description: msg });
            }
        })();
        return () => { cancelled = true; };
    }, [db, type, toast]);

    const obligationsQuery = useMemo(() => {
        if (!db) return null;
        // ไม่ใช้ orderBy(updatedAt) — เอกสารเก่าอาจไม่มีฟิลด์นี้แล้วหลุดจาก query ทั้งก้อน
        return query(collection(db, "accountingObligations"), where("type", "==", type), limit(1000));
    }, [db, type]);

    useEffect(() => {
        if (!obligationsQuery) return;
        setLoading(true);
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
            if (err.code === 'permission-denied') {
                errorEmitter.emit('permission-error', new FirestorePermissionError({ path: 'accountingObligations', operation: 'list' }));
            }
            setLoading(false);
        });
        return () => unsubscribe();
    }, [obligationsQuery, type]);

    useEffect(() => {
        if (type !== 'AR' || obligations.length === 0 || !db) return;
        const arSourceDocIds = Array.from(new Set(obligations.map(ob => ob.sourceDocId).filter(Boolean)));
        const unsubscribes = arSourceDocIds.map(docId => onSnapshot(doc(db, 'documents', docId!), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                const snap = data.customerSnapshot as { name?: string; taxName?: string } | undefined;
                setDocDetails((prev) => ({
                  ...prev,
                  [docId!]: {
                    receiptStatus: data.receiptStatus || "NONE",
                    billingNoteNo: data.billingNoteNo,
                    customerId: data.customerId || data.customerSnapshot?.id,
                    customerNameFromDoc: snap?.name,
                    customerTaxNameFromDoc: snap?.taxName,
                  },
                }));
            }
        }, () => {}));
        return () => unsubscribes.forEach(unsub => unsub());
    }, [obligations, type, db]);

    const filteredObligations = useMemo(() => {
        let result = [...obligations];
        if (monthFilter && monthFilter !== 'ALL') {
            result = result.filter(ob => {
                const docDate = ob.docDate || (ob as any).createdAt?.toDate?.()?.toISOString()?.split('T')[0];
                return docDate?.startsWith(monthFilter);
            });
        }
        if (searchTerm) {
            const lowerSearch = searchTerm.toLowerCase();
            result = result.filter((ob) => {
                const det = docDetails[ob.sourceDocId || ""];
                const names = [
                    ob.customerNameSnapshot,
                    ob.vendorShortNameSnapshot,
                    ob.vendorNameSnapshot,
                    det?.customerNameFromDoc,
                    det?.customerTaxNameFromDoc,
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();
                const nums = [ob.sourceDocNo, ob.invoiceNo]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();
                return names.includes(lowerSearch) || nums.includes(lowerSearch);
            });
        }
        return result;
    }, [obligations, searchTerm, monthFilter, docDetails]);

    useEffect(() => {
        const total = filteredObligations.reduce((sum, ob) => sum + (ob.balance || 0), 0);
        onSummaryChange(total, filteredObligations.length);
    }, [filteredObligations, onSummaryChange]);

    if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>;

    return (
        <>
            <div className="border rounded-md overflow-x-auto">
                <Table><TableHeader><TableRow className="bg-muted/50"><TableHead>Bill Date</TableHead><TableHead>Due Date</TableHead><TableHead>{type === 'AR' ? 'Doc No.' : 'Invoice No.'}</TableHead><TableHead>{type === 'AR' ? 'Customer' : 'Vendor'}</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Balance</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
                    <TableBody>{filteredObligations.length > 0 ? filteredObligations.map(ob => {
                            const details = docDetails[ob.sourceDocId || ''];
                            const isReceiptIssued = details?.receiptStatus === 'ISSUED_NOT_CONFIRMED' || details?.receiptStatus === 'CONFIRMED';
                            const billDateRaw = ob.docDate || (ob as any).createdAt?.toDate?.();
                            const customerIdForReceipt = ob.customerId || details?.customerId || '';
                            const canIssueReceipt = type === "AR" && (ob.sourceDocType === "TAX_INVOICE" || ob.sourceDocType === "DEBIT_NOTE");
                            const requireReceiptBeforeReceive = ob.sourceDocType === "TAX_INVOICE" || ob.sourceDocType === "DEBIT_NOTE";
                            const receiptHref = (() => {
                              const q = new URLSearchParams();
                              q.set('tab', 'new');
                              if (customerIdForReceipt) q.set('customerId', customerIdForReceipt);
                              q.set('sourceDocId', ob.sourceDocId);
                              q.set('presetAmount', String(ob.balance ?? ''));
                              return `/app/management/accounting/documents/receipt?${q.toString()}`;
                            })();
                            return (
                              <TableRow key={ob.id} className="hover:bg-muted/30">
                                <TableCell className="text-xs">{billDateRaw ? safeFormat(new Date(billDateRaw), APP_DATE_FORMAT) : '-'}</TableCell>
                                <TableCell className="text-xs">{ob.dueDate ? safeFormat(parseISO(ob.dueDate), APP_DATE_FORMAT) : '-'}</TableCell>
                                <TableCell>
                                  <div className="font-medium">{type === 'AR' ? ob.sourceDocNo : (ob.invoiceNo || ob.sourceDocNo)}</div>
                                  {details?.billingNoteNo && (
                                    <Badge variant="secondary" className="text-[9px] h-4 mt-1 bg-amber-50 text-amber-700 border-amber-200">
                                      <FileStack className="h-2.5 w-2.5 mr-1" /> วางบิลแล้ว: {details.billingNoteNo}
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-sm">
                                  {type === 'AR'
                                    ? ob.customerNameSnapshot || details?.customerNameFromDoc || details?.customerTaxNameFromDoc || '—'
                                    : ob.vendorShortNameSnapshot || ob.vendorNameSnapshot}
                                </TableCell>
                                <TableCell className="text-right text-xs">{formatCurrency(ob.amountTotal)}</TableCell>
                                <TableCell className="text-right text-xs text-green-600">{formatCurrency(ob.amountPaid)}</TableCell>
                                <TableCell className="text-right font-bold">{formatCurrency(ob.balance)}</TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-2 flex-wrap">
                                    {canIssueReceipt && (
                                      <TooltipProvider>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span>
                                              <Button
                                                size="sm"
                                                variant={isReceiptIssued ? 'secondary' : 'default'}
                                                className={isReceiptIssued ? '' : 'bg-green-600 hover:bg-green-700'}
                                                disabled={isReceiptIssued}
                                                onClick={() => router.push(receiptHref)}
                                              >
                                                <Receipt className="mr-2 h-4 w-4" />
                                                ออกใบเสร็จ
                                              </Button>
                                            </span>
                                          </TooltipTrigger>
                                          {isReceiptIssued && (
                                            <TooltipContent>ออกใบเสร็จไปแล้ว ({details?.receiptStatus})</TooltipContent>
                                          )}
                                        </Tooltip>
                                      </TooltipProvider>
                                    )}
                                    {type === 'AR' ? (
                                      <TooltipProvider>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span className="inline-block">
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={requireReceiptBeforeReceive && !isReceiptIssued}
                                                onClick={() => setPayingAR(ob)}
                                              >
                                                <HandCoins className="mr-2 h-4 w-4" /> รับ
                                              </Button>
                                            </span>
                                          </TooltipTrigger>
                                          {requireReceiptBeforeReceive && !isReceiptIssued && (
                                            <TooltipContent>
                                              เอกสารขายที่ต้องมีใบเสร็จ (ใบกำกับภาษี/ใบเพิ่มหนี้): ต้องออกใบเสร็จก่อน จึงจะบันทึกรับเงินจริงได้
                                            </TooltipContent>
                                          )}
                                        </Tooltip>
                                      </TooltipProvider>
                                    ) : (
                                      <Button size="sm" variant="outline" onClick={() => setPayingAP(ob)}>
                                        <HandCoins className="mr-2 h-4 w-4" /> จ่ายบิล
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                        }) : (<TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground italic">ไม่พบรายการ{type === 'AR' ? 'ลูกหนี้' : 'เจ้าหนี้'}ค้างชำระ</TableCell></TableRow>)}
                    </TableBody>
                </Table>
            </div>
            {payingAR && (<ReceiveArPaymentDialog isOpen={!!payingAR} onClose={() => setPayingAR(null)} obligation={payingAR} accounts={accounts} />)}
            {payingAP && (<PayCreditorDialog isOpen={!!payingAP} onClose={() => setPayingAP(null)} obligation={payingAP} accounts={accounts} />)}
        </>
    );
}

function ReceivablesPayablesContent({ profile }: { profile: UserProfile }) {
    const searchParams = useSearchParams();
    const defaultTab = searchParams.get('tab') === 'creditors' ? 'creditors' : 'debtors';
    const [activeTab, setActiveTab] = useState(defaultTab);
    const [searchTerm, setSearchTerm] = useState("");
    const [monthFilter, setMonthFilter] = useState<string>("ALL");
    const [accounts, setAccounts] = useState<WithId<AccountingAccount>[]>([]);
    const [vendors, setVendors] = useState<WithId<Vendor>[]>([]);
    const [isAddingCreditor, setIsAddingCreditor] = useState(false);
    const [summary, setSummary] = useState({ total: 0, count: 0 });
    const { db } = useFirebase();

    useEffect(() => {
        if (!db) return;
        const accountsQ = query(collection(db, "accountingAccounts"), where("isActive", "==", true));
        const unsubAccounts = onSnapshot(accountsQ, (snap) => {
            setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<AccountingAccount>)));
        }, (err) => {
            if (err.code === 'permission-denied') errorEmitter.emit('permission-error', new FirestorePermissionError({ path: 'accountingAccounts', operation: 'list' }));
        });
        const vendorsQ = query(collection(db, "vendors"), where("isActive", "==", true));
        const unsubVendors = onSnapshot(vendorsQ, (snap) => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<Vendor>));
            data.sort((a, b) => String(a.shortName || "").localeCompare(String(b.shortName || ""), 'th'));
            setVendors(data);
        });
        return () => { unsubAccounts(); unsubVendors(); };
    }, [db]);

    const handleSummaryChange = useCallback((total: number, count: number) => {
        setSummary(prev => {
            if (prev.total === total && prev.count === count) return prev;
            return { total, count };
        });
    }, []);

    useEffect(() => { setSummary({ total: 0, count: 0 }); }, [activeTab]);

    const monthOptions = useMemo(() => {
        const options = [{ value: 'ALL', label: 'ทุกเดือน' }];
        const now = new Date();
        const year = now.getFullYear();
        const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
        for (let i = 0; i < 12; i++) { options.push({ value: `${year}-${String(i + 1).padStart(2, '0')}`, label: `${months[i]} ${year}` }); }
        const prevYear = year - 1;
        for (let i = 11; i >= 0; i--) { options.push({ value: `${prevYear}-${String(i + 1).padStart(2, '0')}`, label: `${months[i]} ${prevYear}` }); }
        return options;
    }, []);

    return (
        <>
        <PageHeader title="ลูกหนี้/เจ้าหนี้" description="จัดการและติดตามข้อมูลลูกหนี้และเจ้าหนี้">
            <div className="bg-primary/5 border border-primary/20 rounded-xl px-6 py-2 flex items-center gap-4 shadow-sm animate-in fade-in zoom-in-95 duration-500">
                <div className="flex flex-col items-end">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">ยอดเงินค้างรวม ({summary.count} รายการ)</span>
                    <span className="text-xl font-black text-primary leading-none">฿{formatCurrency(summary.total)}</span>
                </div>
            </div>
        </PageHeader>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="space-y-4">
            <div className="flex flex-col md:flex-row justify-between items-center md:items-center gap-4">
                <TabsList><TabsTrigger value="debtors">ลูกหนี้ (Debtors)</TabsTrigger><TabsTrigger value="creditors">เจ้าหนี้ (Creditors)</TabsTrigger></TabsList>
                <div className="flex flex-wrap w-full md:w-auto items-center gap-2">
                    {activeTab === 'creditors' && (<Button onClick={() => setIsAddingCreditor(true)}><PlusCircle className="mr-2 h-4 w-4"/> เพิ่มเจ้าหนี้</Button>)}
                    <Select value={monthFilter} onValueChange={setMonthFilter}><SelectTrigger className="w-full sm:w-[180px] bg-background"><div className="flex items-center gap-2"><Filter className="h-4 w-4 text-muted-foreground"/><SelectValue placeholder="กรองตามเดือนบิล"/></div></SelectTrigger><SelectContent>{monthOptions.map(opt => (<SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>))}</SelectContent></Select>
                    <div className="w-full md:w-64 relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"/><Input placeholder="ค้นหาชื่อ, เลขที่บิล..." className="pl-10" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/></div>
                </div>
            </div>
            <Card>
              <CardContent className="pt-6">
                <TabsContent value="debtors" className="mt-0">{activeTab === 'debtors' && (<ObligationList type="AR" searchTerm={searchTerm} monthFilter={monthFilter} accounts={accounts} vendors={vendors} onSummaryChange={handleSummaryChange} />)}</TabsContent>
                <TabsContent value="creditors" className="mt-0">{activeTab === 'creditors' && (<ObligationList type="AP" searchTerm={searchTerm} monthFilter={monthFilter} accounts={accounts} vendors={vendors} onSummaryChange={handleSummaryChange} />)}</TabsContent>
              </CardContent>
            </Card>
        </Tabs>
        <AddCreditorDialog vendors={vendors} isOpen={isAddingCreditor} onClose={() => setIsAddingCreditor(false)} />
        </>
    );
}

export default function ReceivablesPayablesPage() {
    const { profile, loading } = useAuth();
    const hasPermission = useMemo(() => profile?.role === 'ADMIN' || profile?.role === 'MANAGER' || profile?.department === 'MANAGEMENT' || profile?.department === 'ACCOUNTING_HR', [profile]);
    if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;
    if (!profile || !hasPermission) return (<div className="w-full"><PageHeader title="ลูกหนี้/เจ้าหนี้" /><Card className="text-center py-12"><CardHeader><CardTitle>ไม่มีสิทธิ์เข้าถึง</CardTitle><CardDescription>หน้านี้สงวนไว้สำหรับผู้ดูแลระบบหรือฝ่ายบริหารเท่านั้น</CardDescription></CardHeader></Card></div>);
    return (<Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>}><ReceivablesPayablesContent profile={profile} /></Suspense>);
}