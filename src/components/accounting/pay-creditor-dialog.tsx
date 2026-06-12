"use client";

import { useMemo, useState, useEffect } from "react";
import { useAuth } from "@/context/auth-context";
import { useFirebase, useCollection, useDoc, type WithId } from "@/firebase";
import {
  collection,
  query,
  where,
  doc,
  addDoc,
  runTransaction,
  serverTimestamp,
  type DocumentReference,
  type Query,
} from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format as dfFormat, parseISO } from "date-fns";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, HandCoins, AlertCircle, Info, Wallet, CalendarDays } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import type {
  AccountingObligation,
  AccountingAccount,
  AccountingEntry,
  PurchaseDoc,
  StoreSettings,
  DocumentSettings,
} from "@/lib/types";
import { cn, sanitizeForFirestore } from "@/lib/utils";
import { validateAccountingEntryDate, validateCheckDueDate } from "@/lib/accounting-entry-date";
import { purchaseWithholdingBase, purchaseWithholdingAmount } from "@/lib/purchase-withholding";

const formatCurrency = (value: number | null | undefined) => {
  return (value ?? 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const apPaymentSchema = z
  .object({
    paymentDate: z.string().min(1, "กรุณาเลือกวันที่"),
    amount: z.coerce.number().positive("จำนวนเงินต้องมากกว่า 0"),
    accountId: z.string().min(1, "กรุณาเลือกบัญชี"),
    paymentInstrument: z.enum(["CASH", "TRANSFER", "CHECK"]).default("TRANSFER"),
    checkDueDate: z.string().optional(),
    notes: z.string().optional(),
    withholdingEnabled: z.boolean().default(false),
    withholdingPercent: z.coerce.number().min(0).max(100).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.paymentInstrument === "CHECK" && !data.checkDueDate?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "กรุณาระบุวันครบกำหนดเช็ค",
        path: ["checkDueDate"],
      });
    }
  });

export function PayCreditorDialog({
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
    const col = obligation.sourceDocType === "PURCHASE" ? "purchaseDocs" : "documents";
    return doc(db, col, obligation.sourceDocId);
  }, [db, obligation.sourceDocId, obligation.sourceDocType]);
  const { data: sourceDoc } = useDoc<any>(sourceDocRef);

  const accountRef = useMemo((): DocumentReference<AccountingAccount> | null => {
    if (!db || !watchedAccountId) return null;
    return doc(db, "accountingAccounts", watchedAccountId) as DocumentReference<AccountingAccount>;
  }, [db, watchedAccountId]);
  const { data: accountData, isLoading: isLoadingAccount } = useDoc<AccountingAccount>(accountRef);

  const entriesQuery = useMemo((): Query<AccountingEntry> | null => {
    if (!db || !watchedAccountId) return null;
    return query(collection(db, "accountingEntries"), where("accountId", "==", watchedAccountId)) as Query<AccountingEntry>;
  }, [db, watchedAccountId]);
  const { data: accountEntries, isLoading: isLoadingEntries } = useCollection<AccountingEntry>(entriesQuery);

  const storeSettingsRef = useMemo((): DocumentReference<StoreSettings> | null => {
    if (!db) return null;
    return doc(db, "settings", "store") as DocumentReference<StoreSettings>;
  }, [db]);
  const { data: storeSettings } = useDoc<StoreSettings>(storeSettingsRef);

  const currentBalance = useMemo(() => {
    if (!accountData) return 0;
    let balance = accountData.openingBalance || 0;
    if (accountEntries) {
      accountEntries.forEach((e) => {
        if (e.entryType === "RECEIPT" || e.entryType === "CASH_IN") balance += e.amount;
        else if (e.entryType === "CASH_OUT") balance -= e.amount;
      });
    }
    return balance;
  }, [accountData, accountEntries]);

  const whtInfo = useMemo(() => {
    if (!sourceDoc || !watchedWhtEnabled) return { whtBase: 0, whtAmount: 0 };
    const isPurchase = obligation.sourceDocType === "PURCHASE";
    if (!isPurchase) return { whtBase: watchedAmount, whtAmount: watchedAmount * (watchedWhtPercent / 100) };
    const purchase = sourceDoc as PurchaseDoc;
    const whtBase = purchaseWithholdingBase(purchase);
    const whtAmount =
      purchase.withholdingEnabled && purchase.withholdingAmount != null && purchase.withholdingAmount > 0
        ? purchase.withholdingAmount
        : whtBase * (watchedWhtPercent / 100);
    return { whtBase, whtAmount: Math.round(whtAmount * 100) / 100 };
  }, [sourceDoc, watchedWhtEnabled, watchedWhtPercent, watchedAmount, obligation.sourceDocType]);

  const cashOutAmount = watchedAmount - whtInfo.whtAmount;
  const balanceAfter = currentBalance - cashOutAmount;
  const isInsufficient = currentBalance < cashOutAmount;
  const canOverride = profile?.role === "ADMIN" || profile?.role === "MANAGER";
  const isBlocked = isInsufficient && !canOverride;

  useEffect(() => {
    if (isOpen) {
      const preferred =
        obligation.expectedPaymentAccountId && accounts.some((a) => a.id === obligation.expectedPaymentAccountId)
          ? obligation.expectedPaymentAccountId
          : accounts[0]?.id || "";
      form.reset({
        paymentDate: dfFormat(new Date(), "yyyy-MM-dd"),
        amount: obligation.balance,
        notes: "",
        accountId: preferred,
        paymentInstrument: "TRANSFER",
        checkDueDate: "",
        withholdingEnabled:
          obligation.sourceDocType === "PURCHASE" && sourceDoc
            ? !!(sourceDoc as PurchaseDoc).withholdingEnabled
            : false,
        withholdingPercent:
          obligation.sourceDocType === "PURCHASE" && sourceDoc
            ? (sourceDoc as PurchaseDoc).withholdingPercent || 3
            : 3,
      });
    }
  }, [obligation, accounts, form, isOpen, sourceDoc]);

  const handleSavePayment = async (data: z.infer<typeof apPaymentSchema>) => {
    if (!db || !profile || !storeSettings) return;
    const account = accounts.find((a) => a.id === data.accountId);
    if (!account) return;
    if (data.withholdingEnabled) {
      if (!storeSettings.taxId) {
        toast({
          variant: "destructive",
          title: "ข้อมูลร้านไม่ครบถ้วน",
          description: "กรุณาตั้งค่าเลขผู้เสียภาษีของร้านก่อนออกใบหัก ณ ที่จ่าย",
        });
        return;
      }
      if (obligation.sourceDocType === "PURCHASE" && sourceDoc) {
        const purchase = sourceDoc as PurchaseDoc;
        if (!purchase.vendorSnapshot.taxId || !purchase.vendorSnapshot.address) {
          toast({
            variant: "destructive",
            title: "ข้อมูลร้านค้าไม่ครบถ้วน",
            description: "ร้านค้าต้องมีเลขผู้เสียภาษีและที่อยู่เพื่อออกใบหัก ณ ที่จ่าย",
          });
          return;
        }
      }
    }
    if (data.paymentInstrument === "CASH" && account.type !== "CASH") {
      toast({ variant: "destructive", title: "บัญชีไม่ตรงกับวิธีจ่าย", description: "เลือกบัญชีเงินสดเมื่อจ่ายเงินสด" });
      return;
    }
    if ((data.paymentInstrument === "TRANSFER" || data.paymentInstrument === "CHECK") && account.type === "CASH") {
      toast({
        variant: "destructive",
        title: "บัญชีไม่ตรงกับวิธีจ่าย",
        description: "เลือกบัญชีธนาคารเมื่อจ่ายโอนหรือจ่ายเช็ค",
      });
      return;
    }

    let payYmd = data.paymentDate;
    let checkDueNormalized = "";
    if (data.paymentInstrument === "CHECK") {
      const checkDue = data.checkDueDate?.trim();
      if (!checkDue) {
        toast({ variant: "destructive", title: "กรุณาระบุวันครบกำหนดเช็ค" });
        return;
      }
      const vc = validateCheckDueDate(checkDue);
      if (!vc.ok) {
        toast({ variant: "destructive", title: "วันครบกำหนดเช็คไม่ถูกต้อง", description: vc.message });
        return;
      }
      checkDueNormalized = vc.normalized;
    } else {
      const vd = validateAccountingEntryDate(data.paymentDate);
      if (!vd.ok) {
        toast({ variant: "destructive", title: "วันที่จ่ายไม่ถูกต้อง", description: vd.message });
        return;
      }
      payYmd = vd.normalized;
    }

    setIsSubmitting(true);
    const paymentMethod = data.paymentInstrument === "CASH" ? "CASH" : "TRANSFER";
    try {
      if (data.paymentInstrument === "CHECK") {
        await addDoc(
          collection(db, "accountingCheckItems"),
          sanitizeForFirestore({
            direction: "PAY",
            status: "PENDING",
            amount: data.amount,
            dueDate: checkDueNormalized,
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
          })
        );
        toast({ title: "บันทึกเช็คจ่ายแล้ว", description: "จะตัดบัญชีและตัดเจ้าหนี้เมื่อกดยืนยันในแท็บเช็ค" });
        onClose();
        return;
      }

      await runTransaction(db, async (transaction) => {
        const year = Number(payYmd.slice(0, 4));
        const counterRef = doc(db, "documentCounters", String(year));
        const docSettingsRef = doc(db, "settings", "documents");
        const [counterSnap, settingsSnap] = await Promise.all([transaction.get(counterRef), transaction.get(docSettingsRef)]);
        const settingsData = settingsSnap.exists() ? (settingsSnap.data() as DocumentSettings) : {};
        const whtPrefix = settingsData.withholdingTaxPrefix || "WHT";
        let currentCounters = counterSnap.exists() ? (counterSnap.data() as any) : { year };
        const lastWhtPrefix = currentCounters.withholdingTaxPrefix;
        const lastWhtCount = currentCounters.withholdingTax || 0;
        let newWhtCount = lastWhtPrefix !== whtPrefix ? 1 : lastWhtCount + 1;
        let whtDocId = "";
        if (data.withholdingEnabled && obligation.sourceDocType === "PURCHASE" && sourceDoc) {
          const purchase = sourceDoc as PurchaseDoc;
          if (purchase.withholdingTaxDocId) {
            whtDocId = purchase.withholdingTaxDocId;
          } else {
            const whtDocNo = `${whtPrefix}${year}-${String(newWhtCount).padStart(4, "0")}`;
            const whtRef = doc(collection(db, "documents"));
            whtDocId = whtRef.id;
            transaction.set(
              whtRef,
              sanitizeForFirestore({
                id: whtDocId,
                docType: "WITHHOLDING_TAX",
                docNo: whtDocNo,
                docDate: payYmd,
                payerSnapshot: storeSettings,
                payeeSnapshot: {
                  name: purchase.vendorSnapshot.companyName,
                  taxId: purchase.vendorSnapshot.taxId,
                  address: purchase.vendorSnapshot.address,
                },
                vendorId: purchase.vendorId,
                paidMonth: Number(payYmd.slice(5, 7)),
                paidYear: year,
                incomeTypeCode: "ITEM5",
                paidAmountGross: whtInfo.whtBase,
                withholdingPercent: data.withholdingPercent,
                withholdingAmount: whtInfo.whtAmount,
                paidAmountNet: whtInfo.whtBase - whtInfo.whtAmount,
                status: "ISSUED",
                senderName: profile.displayName,
                receiverName: purchase.vendorSnapshot.companyName,
                sourcePurchaseDocId: purchase.id,
                sourcePurchaseDocNo: purchase.docNo,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              })
            );
            transaction.set(counterRef, { ...currentCounters, withholdingTax: newWhtCount, withholdingTaxPrefix: whtPrefix }, { merge: true });
            transaction.update(doc(db, "purchaseDocs", purchase.id), {
              withholdingTaxDocId: whtDocId,
              updatedAt: serverTimestamp(),
            });
          }
        }
        const entryRef = doc(collection(db, "accountingEntries"));
        transaction.set(
          entryRef,
          sanitizeForFirestore({
            entryType: "CASH_OUT",
            entryDate: payYmd,
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
          })
        );
        const obligationRef = doc(db, "accountingObligations", obligation.id);
        const newAmountPaid = Math.round(((obligation.amountPaid || 0) + data.amount) * 100) / 100;
        const newBalance = Math.max(0, Math.round((obligation.amountTotal - newAmountPaid) * 100) / 100);
        const newStatus = newBalance <= 0.05 ? "PAID" : "PARTIAL";
        transaction.update(obligationRef, {
          amountPaid: newAmountPaid,
          balance: newBalance,
          status: newStatus,
          lastPaymentDate: payYmd,
          paidOffDate: newStatus === "PAID" ? payYmd : null,
          updatedAt: serverTimestamp(),
        });
        if (obligation.sourceDocId) {
          const col = obligation.sourceDocType === "PURCHASE" ? "purchaseDocs" : "documents";
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
      toast({ variant: "destructive", title: "เกิดข้อผิดพลาด", description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle>จ่ายเจ้าหนี้</DialogTitle>
          <DialogDescription>
            สำหรับบิลเลขที่: {obligation.invoiceNo || obligation.sourceDocNo} ({obligation.vendorShortNameSnapshot || obligation.vendorNameSnapshot})
          </DialogDescription>
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
                              className={cn("w-full pl-3 text-left font-normal h-10", !field.value && "text-muted-foreground")}
                            >
                              {field.value ? dfFormat(parseISO(field.value), "dd/MM/yyyy") : <span>เลือกวันที่</span>}
                              <CalendarDays className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value ? parseISO(field.value) : undefined}
                            onSelect={(date) => field.onChange(date ? dfFormat(date, "yyyy-MM-dd") : "")}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ยอดตัดหนี้ (Gross)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-1 gap-4">
                <FormField
                  name="accountId"
                  control={form.control}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>หักจากบัญชี</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="เลือกบัญชีที่ใช้จ่าย..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {accounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.name} ({a.type === "CASH" ? "เงินสด" : "โอน"})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="paymentInstrument"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>วิธีจ่ายจริง</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="TRANSFER">โอนเงิน (ตัดบัญชีทันที)</SelectItem>
                        <SelectItem value="CASH">เงินสด (ตัดบัญชีทันที)</SelectItem>
                        <SelectItem value="CHECK">เช็คจ่าย (รอยืนยันในแท็บเช็ค)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {watchedInstrument === "CHECK" ? (
                <FormField
                  control={form.control}
                  name="checkDueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>วันครบกำหนดเช็ค</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}
              <div className="p-4 border rounded-md bg-muted/20 space-y-4">
                <FormField
                  control={form.control}
                  name="withholdingEnabled"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 space-y-0">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <FormLabel className="font-semibold text-primary cursor-pointer">หักภาษี ณ ที่จ่าย (WHT)</FormLabel>
                    </FormItem>
                  )}
                />
                {watchedWhtEnabled && (
                  <div className="space-y-3 pt-2 animate-in slide-in-from-top-1">
                    <FormField
                      control={form.control}
                      name="withholdingPercent"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>อัตราหัก (%)</FormLabel>
                          <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value?.toString()}>
                            <FormControl>
                              <SelectTrigger className="h-8">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="1">1% (ขนส่ง)</SelectItem>
                              <SelectItem value="3">3% (บริการ)</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    {sourceDoc?.withTax && (
                      <div className="flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 p-1 rounded">
                        <Info className="h-3 w-3" />
                        มี VAT: คำนวณ WHT จากยอดก่อนภาษี ({formatCurrency((sourceDoc as PurchaseDoc).net ?? sourceDoc.subtotal)})
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
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> กำลังคำนวณ...
                  </div>
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
                    <Separator className="my-1" />
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
                      <p className="text-xs italic">Admin/Manager: กด &quot;บันทึก&quot; เพื่อยืนยันรายการติดลบ</p>
                    )}
                  </div>
                </div>
              )}
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>หมายเหตุ</FormLabel>
                    <FormControl>
                      <Textarea {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </div>
        <DialogFooter className="p-6 pt-4 border-t bg-muted/10">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            ยกเลิก
          </Button>
          <Button type="submit" form="ap-payment-form" disabled={isSubmitting || isBlocked}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <HandCoins className="mr-2 h-4 w-4" />}
            บันทึกการจ่าย
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
