"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import type { Firestore } from "firebase/firestore";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { format as dfFormat, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import type { WithId } from "@/firebase";
import type {
  AccountingAccount,
  AccountingObligation,
  Document as DocumentType,
  DocType,
} from "@/lib/types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Loader2, CalendarDays } from "lucide-react";
import { cn, sanitizeForFirestore } from "@/lib/utils";
import { isArPaymentSiblingObligation } from "@/lib/accounting-ar-dedupe";
import { validateAccountingEntryDate, validateCheckDueDate } from "@/lib/accounting-entry-date";

/**
 * หลังรับชำระ — อัปเดต obligation/เอกสารซ้ำ (หลาย id ชี้บิลเดียวกัน หรือเลขที่เดียวกันแต่คีย์ลูกค้าไม่ตรง) ให้สอดคล้องกับแถวที่บันทึก
 */
async function syncSiblingArObligationsAfterPayment(
  db: Firestore,
  paid: WithId<AccountingObligation>,
  synced: {
    amountPaid: number;
    balance: number;
    status: "UNPAID" | "PARTIAL" | "PAID";
    paymentDate: string;
    accountId: string;
    paymentMethod: string;
    cashReceived: number;
    withholdingEnabled: boolean;
    withholdingAmount: number;
  }
): Promise<number> {
  const snap = await getDocs(query(collection(db, "accountingObligations"), where("type", "==", "AR"), limit(1000)));
  const batch2 = writeBatch(db);
  let n = 0;
  for (const d of snap.docs) {
    const ob = { id: d.id, ...d.data() } as WithId<AccountingObligation>;
    if (ob.status !== "UNPAID" && ob.status !== "PARTIAL") continue;
    if (!isArPaymentSiblingObligation(paid, ob)) continue;

    batch2.update(doc(db, "accountingObligations", ob.id), {
      amountPaid: synced.amountPaid,
      balance: synced.balance,
      status: synced.status,
      lastPaymentDate: synced.paymentDate,
      paidOffDate: synced.status === "PAID" ? synced.paymentDate : null,
      updatedAt: serverTimestamp(),
    });

    const sid = (ob.sourceDocId || "").trim();
    const paidSid = (paid.sourceDocId || "").trim();
    if (sid && sid !== paidSid) {
      batch2.update(
        doc(db, "documents", sid),
        sanitizeForFirestore({
          status: synced.status,
          arStatus: synced.status,
          paymentSummary: {
            paidTotal: synced.amountPaid,
            balance: synced.balance,
            paymentStatus: synced.status,
          },
          paymentDate: synced.paymentDate,
          paymentMethod: synced.paymentMethod,
          receivedAccountId: synced.accountId,
          cashReceived: synced.cashReceived,
          withholdingEnabled: synced.withholdingEnabled,
          withholdingAmount: synced.withholdingAmount,
          updatedAt: serverTimestamp(),
        })
      );
    }
    n++;
  }
  if (n > 0) await batch2.commit();
  return n;
}

const formatCurrency = (value: number | null | undefined) =>
  (value ?? 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const arPaymentSchema = z
  .object({
    paymentDate: z.string().min(1, "กรุณาเลือกวันที่"),
    amount: z.coerce.number().positive("จำนวนเงินต้องมากกว่า 0"),
    accountId: z.string().min(1, "กรุณาเลือกบัญชี"),
    notes: z.string().optional(),
    withholdingEnabled: z.boolean().default(false),
    withholdingAmount: z.coerce.number().min(0).optional(),
    paymentInstrument: z.enum(["CASH", "TRANSFER", "CHECK"]),
    checkDueDate: z.string().optional(),
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

export function ReceiveArPaymentDialog({
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

  const form = useForm<z.infer<typeof arPaymentSchema>>({
    resolver: zodResolver(arPaymentSchema),
    defaultValues: {
      paymentDate: "",
      amount: obligation.balance,
      withholdingEnabled: false,
      withholdingAmount: 0,
      notes: "",
      accountId: accounts[0]?.id || "",
      paymentInstrument: "TRANSFER",
      checkDueDate: "",
    },
  });

  useEffect(() => {
    if (isOpen) {
      form.reset({
        paymentDate: dfFormat(new Date(), "yyyy-MM-dd"),
        amount: obligation.balance,
        withholdingEnabled: false,
        withholdingAmount: 0,
        notes: "",
        accountId: accounts[0]?.id || "",
        paymentInstrument: "TRANSFER",
        checkDueDate: "",
      });
    }
  }, [obligation, accounts, form, isOpen]);

  const watchedAmount = form.watch("amount");
  const watchedWhtEnabled = form.watch("withholdingEnabled");
  const watchedWhtAmount = form.watch("withholdingAmount") || 0;
  const watchedInstrument = form.watch("paymentInstrument");
  const cashReceived = watchedAmount - (watchedWhtEnabled ? watchedWhtAmount : 0);

  const handleSavePayment = async (data: z.infer<typeof arPaymentSchema>) => {
    if (!db || !profile) return;
    const account = accounts.find((a) => a.id === data.accountId);
    if (!account) return;

    if (data.paymentInstrument === "CASH" && account.type !== "CASH") {
      toast({ variant: "destructive", title: "บัญชีไม่ตรงกับวิธีรับ", description: "เลือกบัญชีเงินสดเมื่อรับเงินสด" });
      return;
    }
    if (data.paymentInstrument === "TRANSFER" && account.type === "CASH") {
      toast({ variant: "destructive", title: "บัญชีไม่ตรงกับวิธีรับ", description: "เลือกบัญชีธนาคารเมื่อรับโอน" });
      return;
    }

    let paymentDateYmd = data.paymentDate;
    let checkDueYmd = (data.checkDueDate || "").trim();
    if (data.paymentInstrument === "CHECK") {
      const vc = validateCheckDueDate(data.checkDueDate || "");
      if (!vc.ok) {
        toast({ variant: "destructive", title: "วันครบกำหนดเช็คไม่ถูกต้อง", description: vc.message });
        return;
      }
      checkDueYmd = vc.normalized;
    } else {
      const vd = validateAccountingEntryDate(data.paymentDate);
      if (!vd.ok) {
        toast({ variant: "destructive", title: "วันที่รับชำระไม่ถูกต้อง", description: vd.message });
        return;
      }
      paymentDateYmd = vd.normalized;
    }

    setIsSubmitting(true);
    const paymentMethod = data.paymentInstrument === "CASH" ? "CASH" : "TRANSFER";

    try {
      const batch = writeBatch(db);
      const obligationRef = doc(db, "accountingObligations", obligation.id);
      const newAmountPaid = Math.round(((obligation.amountPaid || 0) + data.amount) * 100) / 100;
      const newBalance = Math.max(0, Math.round((obligation.amountTotal - newAmountPaid) * 100) / 100);
      const newStatus = newBalance <= 0.05 ? "PAID" : "PARTIAL";

      const anchorTypes = ["DELIVERY_NOTE", "TAX_INVOICE", "BILLING_NOTE"] as const;
      const canAnchorCheck = anchorTypes.includes(obligation.sourceDocType as (typeof anchorTypes)[number]);

      if (data.paymentInstrument === "CHECK") {
        if (!canAnchorCheck) {
          toast({ variant: "destructive", title: "ไม่รองรับเช็คสำหรับเอกสารนี้", description: "ใช้รับเงินสดหรือโอนสำหรับรายการลูกหนี้ประเภทนี้" });
          setIsSubmitting(false);
          return;
        }
        const checkRef = doc(collection(db, "accountingCheckItems"));
        batch.set(
          checkRef,
          sanitizeForFirestore({
            direction: "RECEIVE",
            status: "PENDING",
            amount: data.amount,
            dueDate: checkDueYmd,
            accountId: data.accountId,
            obligationId: obligation.id,
            receiveAnchorDocType: obligation.sourceDocType as "DELIVERY_NOTE" | "TAX_INVOICE" | "BILLING_NOTE",
            receiveAnchorDocId: obligation.sourceDocId,
            receiveAnchorDocNo: obligation.sourceDocNo,
            customerNameSnapshot: obligation.customerNameSnapshot,
            jobId: obligation.jobId,
            notes: data.notes?.trim() || null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            createdByUid: profile.uid,
            createdByName: profile.displayName ?? "",
          })
        );

        if (obligation.sourceDocId) {
          const sourceDocRef = doc(db, "documents", obligation.sourceDocId);
          batch.update(
            sourceDocRef,
            sanitizeForFirestore({
              paymentInstrument: "CHECK",
              checkDueDate: checkDueYmd || null,
              receivedAccountId: data.accountId,
              withholdingEnabled: data.withholdingEnabled,
              withholdingAmount: data.withholdingAmount,
              updatedAt: serverTimestamp(),
            })
          );
        }
      } else {
        batch.update(obligationRef, {
          amountPaid: newAmountPaid,
          balance: newBalance,
          status: newStatus,
          lastPaymentDate: paymentDateYmd,
          paidOffDate: newStatus === "PAID" ? paymentDateYmd : null,
          updatedAt: serverTimestamp(),
        });

        const entryRef = doc(collection(db, "accountingEntries"));
        batch.set(entryRef, {
          entryType: "CASH_IN",
          entryDate: paymentDateYmd,
          amount: cashReceived,
          accountId: data.accountId,
          paymentMethod,
          description: `รับชำระหนี้จาก ${obligation.customerNameSnapshot} (อ้างอิง: ${obligation.sourceDocNo})`,
          sourceDocType: obligation.sourceDocType as DocType,
          sourceDocId: obligation.sourceDocId,
          sourceDocNo: obligation.sourceDocNo,
          customerNameSnapshot: obligation.customerNameSnapshot,
          jobId: obligation.jobId,
          createdAt: serverTimestamp(),
        });
      }

      if (obligation.sourceDocId && data.paymentInstrument !== "CHECK") {
        const sourceDocRef = doc(db, "documents", obligation.sourceDocId);
        const sourceDocSnap = await getDoc(sourceDocRef);
        if (sourceDocSnap.exists()) {
          const sourceDoc = sourceDocSnap.data() as DocumentType;
          const currentPaidTotal = sourceDoc.paymentSummary?.paidTotal || 0;
          const updatedPaidTotal = Math.round((currentPaidTotal + data.amount) * 100) / 100;
          const updatedBalance = Math.max(0, Math.round((sourceDoc.grandTotal - updatedPaidTotal) * 100) / 100);
          const updatedStatus = updatedBalance <= 0.05 ? "PAID" : "PARTIAL";
          batch.update(sourceDocRef, {
            status: updatedStatus,
            arStatus: updatedStatus,
            paymentSummary: {
              paidTotal: updatedPaidTotal,
              balance: updatedBalance,
              paymentStatus: updatedStatus,
            },
            paymentDate: paymentDateYmd,
            paymentMethod: data.paymentInstrument === "CHECK" ? "CHECK" : paymentMethod,
            receivedAccountId: data.accountId,
            cashReceived,
            withholdingEnabled: data.withholdingEnabled,
            withholdingAmount: data.withholdingAmount,
            updatedAt: serverTimestamp(),
          });
        }
      }

      if (data.paymentInstrument !== "CHECK" && newStatus === "PAID" && obligation.jobId) {
        const jobRef = doc(db, "jobs", obligation.jobId);
        const jobSnap = await getDoc(jobRef);
        if (jobSnap.exists())
          batch.update(jobRef, { status: "CLOSED", updatedAt: serverTimestamp(), lastActivityAt: serverTimestamp() });
      }
      await batch.commit();

      let siblingSynced = 0;
      let siblingSyncErr: string | null = null;
      if (data.paymentInstrument !== "CHECK") {
        try {
          siblingSynced = await syncSiblingArObligationsAfterPayment(db, obligation, {
            amountPaid: newAmountPaid,
            balance: newBalance,
            status: newStatus,
            paymentDate: paymentDateYmd,
            accountId: data.accountId,
            paymentMethod,
            cashReceived,
            withholdingEnabled: data.withholdingEnabled,
            withholdingAmount: data.withholdingAmount || 0,
          });
        } catch (e: unknown) {
          siblingSyncErr = e instanceof Error ? e.message : String(e);
        }
      }

      const okDesc =
        data.paymentInstrument === "CHECK"
          ? "สร้างรายการเช็ครับแล้ว — ยืนยันเมื่อเช็คขึ้นเงินในแท็บเช็ค"
          : newStatus === "PAID"
            ? siblingSynced > 0
              ? `ปิดงานซ่อมเรียบร้อย — อัปเดตรายการลูกหนี้ซ้ำอีก ${siblingSynced} รายการให้ตรงกัน`
              : "ปิดงานซ่อมเรียบร้อยแล้วค่ะ"
            : siblingSynced > 0
              ? `อัปเดตรายการลูกหนี้ซ้ำอีก ${siblingSynced} รายการให้ตรงกัน`
              : "";

      toast({
        variant: siblingSyncErr ? "destructive" : "default",
        title: siblingSyncErr ? "รับชำระแล้ว แต่ซิงค์รายการลูกหนี้ซ้ำไม่สำเร็จ" : "บันทึกการรับชำระสำเร็จ",
        description: siblingSyncErr ?? okDesc,
      });
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast({ variant: "destructive", title: "เกิดข้อผิดพลาด", description: msg });
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
            <form id="ar-payment-form-shared" onSubmit={form.handleSubmit(handleSavePayment)} className="space-y-4">
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
                  control={form.control}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>จำนวนเงินที่รับ</FormLabel>
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
                      <FormLabel>เข้าบัญชี / รับเข้าบัญชีเช็ค</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="เลือกบัญชี..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {accounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.name} ({a.type === "CASH" ? "เงินสด" : "ธนาคาร"})
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
                    <FormLabel>วิธีรับชำระจริง</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="TRANSFER">โอนเงิน (ตัดบัญชีทันที)</SelectItem>
                        <SelectItem value="CASH">เงินสด (ตัดบัญชีทันที)</SelectItem>
                        <SelectItem value="CHECK">เช็ค (ยังไม่ตัดบัญชี — ไปยืนยันในแท็บเช็ค)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      ใบเสร็จออกแยกต่างหาก — หน้านี้บันทึกตอนรับเงินจริง ไม่ผูกเช็คกับใบเสร็จโดยตรง
                    </p>
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
                      <FormLabel className="font-bold cursor-pointer text-primary">มีหัก ณ ที่จ่าย (WHT)</FormLabel>
                    </FormItem>
                  )}
                />
                {watchedWhtEnabled && (
                  <FormField
                    control={form.control}
                    name="withholdingAmount"
                    render={({ field }) => (
                      <FormItem className="animate-in slide-in-from-top-1 duration-200">
                        <FormLabel>ยอดเงินที่ถูกหัก (WHT)</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} value={field.value || 0} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
              <div className="text-right space-y-1 p-2">
                <p className="text-sm">ยอดรับชำระ: {formatCurrency(watchedAmount)}</p>
                {watchedWhtEnabled && (
                  <p className="text-xs text-destructive">หัก ณ ที่จ่าย: -{formatCurrency(watchedWhtAmount || 0)}</p>
                )}
                <p className="font-bold text-xl text-primary">ยอดเงินเข้าจริง: {formatCurrency(cashReceived)}</p>
              </div>
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
          <Button type="submit" form="ar-payment-form-shared" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            บันทึกการรับชำระ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
