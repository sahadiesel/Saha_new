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
} from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { addMonths, subMonths, format } from "date-fns";
import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ChevronLeft, ChevronRight, HandCoins } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { PayslipNew, AccountingAccount } from "@/lib/types";
import type { WithId } from "@/firebase/firestore/use-collection";
import { newPayslipStatusLabel } from "@/lib/ui-labels";

const formatCurrency = (value: number) => {
  return (value ?? 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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
  const form = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      paidDate: format(new Date(), "yyyy-MM-dd"),
      accountId: accounts.find(a => a.type === 'BANK')?.id || accounts[0]?.id || "",
      referenceNo: "",
    },
  });

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
            <div className="p-4 border rounded-md font-bold text-center text-xl">
              ยอดจ่ายสุทธิ: {formatCurrency(payslip.snapshot?.netPay ?? 0)} บาท
            </div>
            <FormField control={form.control} name="paidDate" render={({ field }) => (<FormItem><FormLabel>วันที่จ่ายเงิน</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>)} />
            <FormField control={form.control} name="accountId" render={({ field }) => (
              <FormItem>
                <FormLabel>จากบัญชี</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="เลือกบัญชีที่ใช้โอนเงิน..."/></SelectTrigger></FormControl>
                  <SelectContent>{accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name} ({acc.type === 'CASH' ? 'เงินสด' : 'โอน'})</SelectItem>)}</SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="referenceNo" render={({ field }) => (<FormItem><FormLabel>เลขที่อ้างอิง (ถ้ามี)</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>)} />
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

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [period, setPeriod] = useState<1 | 2>(new Date().getDate() <= 15 ? 1 : 2);
  const [payslips, setPayslips] = useState<WithId<PayslipNew>[]>([]);
  const [accounts, setAccounts] = useState<WithId<AccountingAccount>[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [payingPayslip, setPayingPayslip] = useState<WithId<PayslipNew> | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const hasPermission = useMemo(() => profile?.role === 'ADMIN' || profile?.role === 'MANAGER' || profile?.department === 'MANAGEMENT', [profile]);

  useEffect(() => {
    if (!db || !hasPermission) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    const payrollBatchId = `${format(currentMonth, 'yyyy-MM')}-${period}`;
    const payslipsQuery = query(
      collection(db, "payrollBatches", payrollBatchId, "payslips"),
      where("status", "==", "READY_TO_PAY")
    );
    
    const accountsQuery = query(
      collection(db, "accountingAccounts"),
      where("isActive", "==", true),
      orderBy("name", "asc")
    );

    const unsubPayslips = onSnapshot(payslipsQuery, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as WithId<PayslipNew>));
      setPayslips(data);
      setLoading(false);
    }, (err) => {
      setPayslips([]);
      setLoading(false);
      if(err.code !== 'not-found') {
        toast({ variant: 'destructive', title: 'ไม่สามารถโหลดสลิปเงินเดือน', description: err.message });
      }
    });

    const unsubAccounts = onSnapshot(accountsQuery, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WithId<AccountingAccount>));
      setAccounts(data);
    }, (err) => {
      toast({ variant: 'destructive', title: 'ไม่สามารถโหลดบัญชี', description: err.message });
    });
    
    return () => {
      unsubPayslips();
      unsubAccounts();
    }
  }, [db, hasPermission, toast, currentMonth, period]);

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
          amount: payingPayslip.snapshot?.netPay ?? 0,
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
    return (
      <Card>
        <CardHeader>
          <CardTitle>ไม่มีสิทธิ์เข้าถึง</CardTitle>
          <CardDescription>สำหรับฝ่ายบริหาร/บัญชีเท่านั้น</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      <PageHeader title="จ่ายเงินเดือน" description="ตรวจสอบและยืนยันการจ่ายเงินเดือนที่พนักงานอนุมัติแล้ว" />
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <CardTitle>รายการที่พร้อมจ่าย</CardTitle>
            <div className="flex items-center gap-2 self-end sm:self-center">
              <Button variant="outline" size="icon" onClick={() => setCurrentMonth(prev => subMonths(prev, 1))}><ChevronLeft /></Button>
              <span className="font-semibold text-lg text-center w-32">{format(currentMonth, 'MMMM yyyy')}</span>
              <Button variant="outline" size="icon" onClick={() => setCurrentMonth(prev => addMonths(prev, 1))}><ChevronRight /></Button>
              <Select value={period.toString()} onValueChange={(v) => setPeriod(Number(v) as 1 | 2)}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">งวดที่ 1</SelectItem>
                  <SelectItem value="2">งวดที่ 2</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>
          ) : payslips.length === 0 ? (
            <div className="text-center text-muted-foreground p-8">ไม่มีรายการที่พร้อมจ่ายในงวดนี้</div>
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
                    <TableCell>{p.userName}</TableCell>
                    <TableCell>{p.batchId}</TableCell>
                    <TableCell><Badge variant="outline">{newPayslipStatusLabel(p.status)}</Badge></TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(p.snapshot?.netPay ?? 0)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" onClick={() => setPayingPayslip(p)} disabled={p.snapshot.netPay <= 0}>
                        <HandCoins className="mr-2"/> บันทึกการจ่าย
                      </Button>
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
