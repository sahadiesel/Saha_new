
"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { collection, getDocs, getDoc, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { useFirebase, useDoc } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle, MessageSquareWarning, Printer } from "lucide-react";
import type { PayslipNew, PayslipSnapshot, StoreSettings } from "@/lib/types";
import type { WithId } from "@/firebase/firestore/use-collection";
import { newPayslipStatusLabel, deptLabel, payTypeLabel } from "@/lib/ui-labels";
import { PayslipSlipDrawer } from "@/components/payroll/PayslipSlipDrawer";
import { PayslipSlipView, calcTotals } from "@/components/payroll/PayslipSlipView";
import { thaiBahtText } from "@/lib/utils";
import { useAppNavLabel } from "@/context/public-site-language-context";
import {
  parsePayrollBatchId,
  siblingPayrollBatchId,
  buildPayslipPrintHtml,
} from "@/lib/payroll/payslip-display";

const formatCurrency = (value: number | undefined) => {
  return (value ?? 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const getStatusBadgeVariant = (status?: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
        case 'DRAFT': return 'secondary';
        case 'SENT_TO_EMPLOYEE': return 'default';
        case 'REVISION_REQUESTED': return 'destructive';
        case 'READY_TO_PAY': return 'outline';
        case 'PAID': return 'default';
        default: return 'outline';
    }
};

function RevisionDialog({
  payslip,
  isOpen,
  onClose,
  onSubmit,
  isSubmitting
}: {
  payslip: WithId<PayslipNew>;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  isSubmitting: boolean;
}) {
  const [reason, setReason] = useState("");
  const { t } = useAppNavLabel();

  const handleSubmit = () => {
    if (!reason.trim()) {
      return;
    }
    onSubmit(reason);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("ร้องขอแก้ไขสลิปเงินเดือน")}</DialogTitle>
          <DialogDescription>
            {payslip.batchId}. {t("กรุณาระบุเหตุผลที่ต้องการแก้ไขให้ชัดเจน")}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Textarea
            placeholder={t("กรุณากรอกเหตุผลที่นี่...")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={5}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            {t("ยกเลิก")}
          </Button>
          <Button onClick={handleSubmit} disabled={!reason.trim() || isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 animate-spin" />}
            {t("ส่งคำร้อง")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function MyPayslipsPage() {
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  const { t } = useAppNavLabel();
  const printFrameRef = useRef<HTMLIFrameElement | null>(null);
  
  const [payslips, setPayslips] = useState<(WithId<PayslipNew> & { refPath: string })[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [revisionPayslip, setRevisionPayslip] = useState<WithId<PayslipNew> & { refPath: string } | null>(null);
  const [viewPayslip, setViewPayslip] = useState<(WithId<PayslipNew> & { refPath: string }) | null>(null);
  const [otherPeriodSnapshot, setOtherPeriodSnapshot] = useState<PayslipSnapshot | null>(null);

  const storeSettingsRef = useMemo(() => (db ? doc(db, "settings", "store") : null), [db]);
  const { data: storeSettings } = useDoc<StoreSettings>(storeSettingsRef);

  useEffect(() => {
    if (!db || !profile?.uid) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadPayslips() {
      try {
        setLoading(true);
        const batchesSnap = await getDocs(collection(db, "payrollBatches"));
        const batchIds = batchesSnap.docs.map(d => d.id);
        batchIds.sort((a,b) => b.localeCompare(a));

        const results: (WithId<PayslipNew> & { refPath: string })[] = [];

        await Promise.all(batchIds.map(async (batchId) => {
          const slipRef = doc(db, "payrollBatches", batchId, "payslips", profile!.uid);
          const slipSnap = await getDoc(slipRef);
          if (slipSnap.exists()) {
            results.push({
              id: slipSnap.id,
              refPath: slipRef.path,
              ...(slipSnap.data() as PayslipNew),
            } as any);
          }
        }));

        results.sort((a, b) => {
          const dateA = a.sentAt?.toDate()?.getTime() || a.updatedAt?.toDate()?.getTime() || 0;
          const dateB = b.sentAt?.toDate()?.getTime() || b.updatedAt?.toDate()?.getTime() || 0;
          return dateB - dateA;
        });

        if (!cancelled) setPayslips(results);
      } catch (error: any) {
        console.error("Error fetching payslips:", error);
        toast({ variant: "destructive", title: "ไม่สามารถโหลดข้อมูลได้", description: error.message });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPayslips();
    return () => { cancelled = true; };
  }, [db, profile?.uid, toast]);

  useEffect(() => {
    if (!db || !profile?.uid || !viewPayslip?.batchId) {
      setOtherPeriodSnapshot(null);
      return;
    }
    const siblingId = siblingPayrollBatchId(viewPayslip.batchId);
    if (!siblingId) {
      setOtherPeriodSnapshot(null);
      return;
    }
    let cancelled = false;
    void getDoc(doc(db, "payrollBatches", siblingId, "payslips", profile.uid)).then((snap) => {
      if (cancelled) return;
      setOtherPeriodSnapshot(snap.exists() ? (snap.data().snapshot as PayslipSnapshot) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [db, profile?.uid, viewPayslip?.batchId]);


  const handleAccept = async (payslip: WithId<PayslipNew> & { refPath: string }) => {
    if (!db) return;
    setActioningId(payslip.id);
    try {
      const payslipRef = doc(db, payslip.refPath);
      await updateDoc(payslipRef, {
        status: 'READY_TO_PAY',
        employeeAcceptedAt: serverTimestamp(),
        employeeNote: null,
      });
      toast({ title: 'ยืนยันสลิปเรียบร้อย' });
      setPayslips(prev => prev.map(p => p.id === payslip.id ? {...p, status: 'READY_TO_PAY'} : p));
      setViewPayslip(prev => prev ? {...prev, status: 'READY_TO_PAY'} : null);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'ทำรายการไม่สำเร็จ', description: error.message });
    } finally {
      setActioningId(null);
    }
  };
  
  const handleRequestRevision = async (reason: string) => {
    if (!db || !revisionPayslip) return;
    setActioningId(revisionPayslip.id);
    try {
      const payslipRef = doc(db, revisionPayslip.refPath);
      await updateDoc(payslipRef, {
        status: 'REVISION_REQUESTED',
        employeeNote: reason,
      });
      toast({ title: 'ส่งคำร้องแก้ไขเรียบร้อย' });
      setPayslips(prev => prev.map(p => p.id === revisionPayslip.id ? {...p, status: 'REVISION_REQUESTED'} : p));
      setViewPayslip(null);
      setRevisionPayslip(null);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'ทำรายการไม่สำเร็จ', description: error.message });
    } finally {
      setActioningId(null);
    }
  };

  const handleView = (payslip: WithId<PayslipNew> & { refPath: string }) => {
    setViewPayslip(payslip);
  };

  const handlePrintInDrawer = () => {
    if (!viewPayslip || !storeSettings || !profile) return;
    
    try {
      const frame = printFrameRef.current;
      if (!frame) return;
      const totals = calcTotals(viewPayslip.snapshot);
      const parsed = parsePayrollBatchId(viewPayslip.batchId);
      const html = buildPayslipPrintHtml({
        store: storeSettings,
        employeeName: viewPayslip.userName,
        departmentLabel: deptLabel(profile.department),
        payTypeLabelText: payTypeLabel(profile.hr?.payType),
        periodLabel: viewPayslip.batchId,
        currentPeriodNo: parsed?.periodNo || 1,
        snapshot: viewPayslip.snapshot,
        otherSnapshot: otherPeriodSnapshot,
        salaryMonthly: profile.hr?.salaryMonthly,
        bahtText: thaiBahtText(totals.netPay),
      });
  
      frame.onload = () => {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      };
      frame.srcdoc = html;
    } catch (e) {
      toast({ variant: 'destructive', title: 'ไม่สามารถพิมพ์ได้' });
    }
  };


  const getPaymentStatus = (status: string) => {
    if (status === 'READY_TO_PAY') return t('รอโอน');
    if (status === 'PAID') return t('จ่ายแล้ว');
    return '-';
  };

  return (
    <>
      <PageHeader title={t("ใบเงินเดือนของฉัน")} description={t("ตรวจสอบสลิปเงินเดือนและกดยืนยัน")} />
      <Card>
        <CardHeader>
          <CardTitle>{t("ประวัติสลิปเงินเดือน")}</CardTitle>
          <CardDescription>
            {t("แสดงรายการสลิปเงินเดือนล่าสุดของคุณ")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("งวด")}</TableHead>
                <TableHead>{t("เงินสุทธิ")}</TableHead>
                <TableHead>{t("สถานะสลิป")}</TableHead>
                <TableHead>{t("สถานะการจ่าย")}</TableHead>
                <TableHead className="text-right">{t("การดำเนินการ")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">
                    <Loader2 className="mx-auto animate-spin" />
                  </TableCell>
                </TableRow>
              ) : payslips.length > 0 ? (
                payslips.map(p => (
                  <TableRow key={p.id + p.batchId}>
                    <TableCell>{p.batchId}</TableCell>
                    <TableCell>{formatCurrency(p.snapshot?.netPay)} {t("บาท")}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(p.status)}>{newPayslipStatusLabel(p.status, t)}</Badge>
                    </TableCell>
                    <TableCell>{getPaymentStatus(p.status)}</TableCell>
                    <TableCell className="text-right">
                       <Button size="sm" variant="outline" onClick={() => handleView(p)}>
                          {t("ดู")}
                        </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">
                    {t("ยังไม่มีข้อมูลสลิปเงินเดือน")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      {revisionPayslip && (
        <RevisionDialog
          payslip={revisionPayslip}
          isOpen={!!revisionPayslip}
          onClose={() => setRevisionPayslip(null)}
          onSubmit={handleRequestRevision}
          isSubmitting={actioningId === revisionPayslip.id}
        />
      )}

      {viewPayslip && (
        <PayslipSlipDrawer
          open={!!viewPayslip}
          onOpenChange={(open) => !open && setViewPayslip(null)}
          title={t("ดูสลิปเงินเดือน")}
          description={`${t("งวด")}: ${viewPayslip.batchId}`}
          onPrint={handlePrintInDrawer}
          footerActions={
            <div className="flex gap-2 justify-end w-full">
              <Button
                onClick={() => handleAccept(viewPayslip)}
                disabled={actioningId !== null || viewPayslip.status !== 'SENT_TO_EMPLOYEE'}
              >
                <CheckCircle/>
                {t("ยอมรับ")}
              </Button>

              <Button
                variant="destructive"
                onClick={() => {
                    setViewPayslip(null);
                    setRevisionPayslip(viewPayslip);
                }}
                disabled={actioningId !== null || viewPayslip.status !== 'SENT_TO_EMPLOYEE'}
              >
                <MessageSquareWarning/>
                {t("ร้องขอแก้ไข")}
              </Button>
            </div>
          }
        >
          <PayslipSlipView
            userName={viewPayslip.userName}
            periodLabel={viewPayslip.batchId}
            snapshot={viewPayslip.snapshot}
            otherPeriodSnapshot={otherPeriodSnapshot}
            currentPeriodNo={parsePayrollBatchId(viewPayslip.batchId)?.periodNo || 1}
            userProfile={profile}
            mode="read"
            payType={profile.hr?.payType}
          />
        </PayslipSlipDrawer>
      )}
      <iframe ref={printFrameRef} className="hidden" title="Print Frame" />
    </>
  );
}
