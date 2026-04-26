"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import {
  doc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  Timestamp,
  runTransaction,
  increment,
  onSnapshot,
  serverTimestamp,
  type DocumentReference,
} from "firebase/firestore";
import { useFirebase, useDoc } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { format as dfFormat, parseISO } from "date-fns";
import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, HandCoins, AlertCircle, ExternalLink, CheckCircle2, CalendarDays, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import type { PayslipNew, AccountingAccount, UserProfile } from "@/lib/types";
import type { WithId } from "@/firebase/firestore/use-collection";
import { newPayslipStatusLabel } from "@/lib/ui-labels";
import { safeFormat } from "@/lib/date-utils";

const formatCurrency = (value: number | undefined) => {
  return (value ?? 0).toLocaleString("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
};

const paymentSchema = z.object({
  paidDate: z.string().min(1, "กรุณาเลือกวันที่จ่ายเงิน"),
  accountId: z.string().min(1, "กรุณาเลือกบัญชี"),
  referenceNo: z.string().optional(),
});

type PaymentFormData = z.infer<typeof paymentSchema>;

function PayDialog({
  payslip,
  accounts,
  onClose,
  onConfirm,
  isSubmitting,
}: {
  payslip: WithId<PayslipNew>;
  accounts: WithId<AccountingAccount>[];
  onClose: () => void;
  onConfirm: (data: PaymentFormData) => Promise<void>;
  isSubmitting: boolean;
}) {
  const { db } = useFirebase();
  const userRef = useMemo((): DocumentReference<UserProfile> | null => {
    if (!db) return null;
    return doc(db, "users", payslip.userId) as DocumentReference<UserProfile>;
  }, [db, payslip.userId]);
  const { data: userProfile, isLoading: isLoadingProfile } = useDoc<UserProfile>(userRef);

  const form = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      paidDate: "",
      accountId: accounts.find(a => a.type === 'BANK')?.id || accounts[0]?.id || "",
      referenceNo: "",
    },
  });

  useEffect(() => {
    form.setValue("paidDate", dfFormat(new Date(), "yyyy-MM-dd"));
  }, [form]);

  const bankInfo = userProfile?.personal?.bank;
  const bankDisplay = bankInfo?.bankName && bankInfo?.accountNo 
    ? `${bankInfo.bankName} - ${bankInfo.accountNo}` 
    : "ไม่ได้ระบุข้อมูลบัญชีในโปรไฟล์";

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>บันทึกการจ่ายเงินเดือน</DialogTitle>
          <DialogDescription>
            พนักงาน: {payslip.userName} | งวด: {payslip.batchId}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form id="payment-form" onSubmit={form.handleSubmit(onConfirm)} className="space-y-4 py-4">
            <div className="p-4 border rounded-md font-bold text-center text-xl bg-primary/5 border-primary/20">
              ยอดจ่ายสุทธิ: {formatCurrency(payslip.snapshot?.netPay ?? 0)} บาท
            </div>
            
            <FormField
              control={form.control}
              name="paidDate"
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

            <FormField control={form.control} name="accountId" render={({ field }) => (
              <FormItem>
                <FormLabel>จากบัญชี (ต้นทาง)</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="เลือกบัญชีที่ใช้โอนเงิน..."/></SelectTrigger></FormControl>
                  <SelectContent>{accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name} ({acc.type === 'CASH' ? 'เงินสด' : 'โอน'})</SelectItem>)}</SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <div className="space-y-2">
              <Label className="text-muted-foreground">เข้าบัญชี (ข้อมูลพนักงาน)</Label>
              <div className="p-3 bg-muted/50 rounded-md border text-sm font-medium">
                {isLoadingProfile ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    กำลังโหลดข้อมูลโปรไฟล์...
                  </div>
                ) : bankDisplay}
              </div>
            </div>

            <FormField control={form.control} name="referenceNo" render={({ field }) => (
              <FormItem>
                <FormLabel>เลขที่อ้างอิง (ถ้ามี)</FormLabel>
                <FormControl><Input {...field} value={field.value ?? ''} /></FormControl>
              </FormItem>
            )} />
          </form>
        </Form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>ยกเลิก</Button>
          <Button type="submit" form="payment-form" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 animate-spin"/>}
            ยืนยันการจ่ายเงิน
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PayrollPayoutsPage() {
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();

  const [monthFilter, setMonthFilter] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [period, setPeriod] = useState<"1" | "2" | "ALL">(() => {
    const day = new Date().getDate();
    return day <= 15 ? "1" : "2";
  });

  const monthOptions = useMemo(() => {
    const now = new Date();
    const months: string[] = [];
    for (let i = 0; i < 24; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return months;
  }, []);

  const [payslips, setPayslips] = useState<WithId<PayslipNew>[]>([]);
  const [accounts, setAccounts] = useState<WithId<AccountingAccount>[]>([]);
  const [loading, setLoading] = useState(true);
  const [indexErrorUrl, setIndexErrorUrl] = useState<string | null>(null);
  
  const [payingPayslip, setPayingPayslip] = useState<WithId<PayslipNew> | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const hasPermission = useMemo(() => 
    profile?.role === 'ADMIN' || 
    profile?.role === 'MANAGER' || 
    profile?.department === 'MANAGEMENT' ||
    profile?.department === 'ACCOUNTING_HR'
  , [profile]);

  useEffect(() => {
    if (!db || !hasPermission || !monthFilter) {
      if (!db || !hasPermission) setLoading(false);
      return;
    }
    
    setLoading(true);
    setIndexErrorUrl(null);
    const periods = period === "ALL" ? [1, 2] : [Number(period)];
    const periodData = new Map<number, WithId<PayslipNew>[]>();
    
    const accountsQuery = query(
      collection(db, "accountingAccounts"),
      where("isActive", "==", true),
      orderBy("name", "asc")
    );

    const buildAndSetPayslips = () => {
      const merged = Array.from(periodData.values()).flat();
      merged.sort((a, b) => {
        if (a.status === b.status) return a.userName.localeCompare(b.userName, "th");
        return a.status === "READY_TO_PAY" ? -1 : 1;
      });
      setPayslips(merged);
      setLoading(false);
    };

    const unsubPayslips = periods.map((p) => {
      const payrollBatchId = `${monthFilter}-${p}`;
      const payslipsQuery = query(
        collection(db, "payrollBatches", payrollBatchId, "payslips"),
        where("status", "in", ["READY_TO_PAY", "PAID"])
      );
      return onSnapshot(
        payslipsQuery,
        (snapshot) => {
          periodData.set(
            p,
            snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as WithId<PayslipNew>))
          );
          buildAndSetPayslips();
        },
        (err) => {
          periodData.set(p, []);
          buildAndSetPayslips();
          if (err.code !== "not-found") {
            toast({ variant: "destructive", title: "ไม่สามารถโหลดสลิปเงินเดือน", description: err.message });
          }
        }
      );
    });

    const unsubAccounts = onSnapshot(accountsQuery, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WithId<AccountingAccount>));
      setAccounts(data);
    }, (err: any) => {
      if (err.message?.includes('requires an index')) {
        const urlMatch = err.message.match(/https?:\/\/[^\s]+/);
        if (urlMatch) setIndexErrorUrl(urlMatch[0]);
      }
      toast({ variant: 'destructive', title: 'ไม่สามารถโหลดบัญชี', description: err.message });
    });
    
    return () => {
      unsubPayslips.forEach((unsub) => unsub());
      unsubAccounts();
    }
  }, [db, hasPermission, toast, monthFilter, period]);

  const payoutSummary = useMemo(() => {
    return payslips.reduce(
      (acc, p) => {
        acc.total += Number(p.snapshot?.netPay ?? 0);
        acc.count += 1;
        return acc;
      },
      { total: 0, count: 0 }
    );
  }, [payslips]);

  const handleConfirmPayment = async (formData: PaymentFormData) => {
    if (!db || !profile || !payingPayslip) return;
    
    const account = accounts.find(a => a.id === formData.accountId);
    if (!account) return;

    setIsSubmitting(true);
    const paymentMethod = account.type === 'CASH' ? 'CASH' : 'TRANSFER';

    try {
      const payrollBatchId = payingPayslip.batchId;
      const payslipRef = doc(db, 'payrollBatches', payrollBatchId, 'payslips', payingPayslip.id);
      const payrollBatchRef = doc(db, 'payrollBatches', payrollBatchId);

      await runTransaction(db, async (transaction) => {
        const entryRef = doc(collection(db, 'accountingEntries'));
        
        transaction.set(entryRef, {
          entryType: 'CASH_OUT',
          entryDate: formData.paidDate,
          amount: Math.round(payingPayslip.snapshot?.netPay ?? 0),
          accountId: formData.accountId,
          paymentMethod: paymentMethod,
          description: `จ่ายเงินเดือน: ${payingPayslip.userName} งวด ${payingPayslip.batchId}`,
          sourceDocType: 'PAYSLIP',
          sourceDocId: payingPayslip.id,
          sourceDocNo: `PAYSLIP-${payingPayslip.batchId}-${payingPayslip.userId.slice(0, 5)}`,
          categoryMain: 'ค่าแรง/เงินเดือน',
          categorySub: 'เงินเดือน',
          referenceNo: formData.referenceNo,
          createdAt: serverTimestamp(),
        });

        transaction.update(payslipRef, {
          status: 'PAID',
          paidAt: serverTimestamp(),
          paidByUid: profile.uid,
          paidByName: profile.displayName,
          paymentMethod: paymentMethod,
          accountId: formData.accountId,
          accountingEntryId: entryRef.id,
        });

        transaction.update(payrollBatchRef, {
          'statusSummary.readyCount': increment(-1),
          'statusSummary.paidCount': increment(1),
        });
      });

      toast({ title: 'บันทึกการจ่ายเงินเดือนสำเร็จ' });
      setPayingPayslip(null);

    } catch (e: any) {
      toast({ variant: 'destructive', title: 'เกิดข้อผิดพลาด', description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!hasPermission) {
    return <Card><CardHeader><CardTitle>ไม่มีสิทธิ์เข้าถึง</CardTitle></CardHeader></Card>;
  }

  return (
    <>
      <PageHeader title="จ่ายเงินเดือน" description="ตรวจสอบและยืนยันการจ่ายเงินเดือนที่พนักงานอนุมัติแล้ว">
        <div className="rounded-md border bg-background px-4 py-2 min-w-[220px] text-right">
          <div className="text-[11px] text-muted-foreground">ยอดรวมสุทธิ ({payoutSummary.count} รายการ)</div>
          <div className="text-2xl font-black text-primary leading-none">{formatCurrency(payoutSummary.total)}</div>
        </div>
      </PageHeader>
      
      {indexErrorUrl && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>ต้องสร้างดัชนี (Index) สำหรับรายการบัญชี</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>ฐานข้อมูลต้องการดัชนีเพื่อจัดเรียงรายชื่อบัญชีธนาคาร กรุณากดปุ่มด้านล่างเพื่อสร้าง Index</span>
            <Button asChild variant="outline" size="sm" className="w-fit bg-white text-destructive">
              <a href={indexErrorUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" />สร้าง Index (Firebase Console)</a>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <CardTitle>รายการสลิปในงวดนี้</CardTitle>
            <div className="flex items-center gap-2 self-end sm:self-center">
              <Select value={monthFilter} onValueChange={setMonthFilter}>
                <SelectTrigger className="w-[140px] bg-background">
                  <div className="flex items-center gap-2">
                    <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                    <SelectValue placeholder="เดือน..." />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={period} onValueChange={(v) => setPeriod(v as "1" | "2" | "ALL")}>
                <SelectTrigger className="w-[140px] bg-background"><SelectValue placeholder="งวด..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">งวดที่ 1</SelectItem>
                  <SelectItem value="2">งวดที่ 2</SelectItem>
                  <SelectItem value="ALL">งวด 1+2</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>
          ) : payslips.length === 0 ? (
            <div className="text-center text-muted-foreground p-8">ไม่มีรายการที่พร้อมจ่ายหรือจ่ายแล้วในงวดนี้</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>พนักงาน</TableHead>
                  <TableHead>งวด</TableHead>
                  <TableHead>สถานะ</TableHead>
                  <TableHead className="text-right">ยอดสุทธิ</TableHead>
                  <TableHead className="text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payslips.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.userName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">{p.batchId}</TableCell>
                    <TableCell>
                        <Badge variant={p.status === 'PAID' ? 'default' : 'outline'} className={p.status === 'PAID' ? 'bg-green-600' : ''}>
                            {newPayslipStatusLabel(p.status)}
                        </Badge>
                    </TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(p.snapshot?.netPay ?? 0)}</TableCell>
                    <TableCell className="text-right">
                      {p.status === 'READY_TO_PAY' ? (
                        <Button size="sm" onClick={() => setPayingPayslip(p)} disabled={p.snapshot.netPay <= 0} className="bg-green-700 hover:bg-green-800">
                          <HandCoins className="mr-2 h-4 w-4"/> บันทึกการจ่าย
                        </Button>
                      ) : (
                        <div className="flex flex-col items-end gap-0.5">
                            <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 text-[10px]">
                                <CheckCircle2 className="mr-1 h-3 w-3" /> จ่ายเรียบร้อย
                            </Badge>
                            {p.paidAt && <p className="text-[9px] text-muted-foreground">{safeFormat(p.paidAt, 'dd/MM/yy HH:mm')}</p>}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      
      {payingPayslip && (
        <PayDialog
          payslip={payingPayslip}
          accounts={accounts}
          onClose={() => setPayingPayslip(null)}
          onConfirm={handleConfirmPayment}
          isSubmitting={isSubmitting}
        />
      )}
    </>
  );
}
