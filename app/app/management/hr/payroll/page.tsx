"use client";

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { doc, collection, query, where, orderBy, getDocs, getDoc, Timestamp, setDoc, serverTimestamp, updateDoc, addDoc } from "firebase/firestore";
import { useFirebase, useDoc, type WithId } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { addMonths, subMonths, format, startOfMonth, endOfMonth, isAfter, startOfToday, set, startOfYear, eachDayOfInterval, isSaturday, isSunday, parseISO, differenceInCalendarDays, getYear } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ChevronLeft, ChevronRight, FilePlus, Send, CalendarDays, MoreVertical, Save, AlertCircle, Eye, CalendarCheck, RefreshCw } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import type { HRSettings, UserProfile, LeaveRequest, PayslipNew, Attendance, HRHoliday, AttendanceAdjustment, PayslipStatusNew, PayslipSnapshot, StoreSettings } from "@/lib/types";
import { deptLabel, payTypeLabel, newPayslipStatusLabel, leaveTypeLabel } from "@/lib/ui-labels";
import { PayslipSlipDrawer } from "@/components/payroll/PayslipSlipDrawer";
import { PayslipSlipView, calcTotals } from "@/components/payroll/PayslipSlipView";
import { computePeriodMetrics, PeriodMetrics } from "@/lib/payroll/payslip-period-metrics";
import { SsoDecisionDialog } from "@/components/payroll/SsoDecisionDialog";
import { round2, calcSsoMonthly, splitSsoHalf } from "@/lib/payroll/sso";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AttendanceAdjustmentDialog } from "@/components/attendance-adjustment-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { LEAVE_TYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";

const formatCurrency = (value: number | undefined) => {
  return (value ?? 0).toLocaleString("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
};

const getStatusBadgeVariant = (status?: PayslipStatusNew | string) => {
    switch (status) {
        case 'DRAFT': return 'secondary';
        case 'SENT_TO_EMPLOYEE': return 'default';
        case 'REVISION_REQUESTED': return 'destructive';
        case 'READY_TO_PAY': return 'outline';
        case 'PAID': return 'default';
        default: return 'outline';
    }
}

interface EmployeeRowData extends WithId<UserProfile> {
    periodMetrics: PeriodMetrics | null;
    periodMetricsYtd: PeriodMetrics | null;
    payslipStatus?: PayslipStatusNew | 'ไม่มีสลิป';
    snapshot: PayslipSnapshot | null;
    revisionNo?: number;
}

const leaveSchema = z.object({
  leaveType: z.enum(LEAVE_TYPES),
  startDate: z.string().min(1, "กรุณาเลือกวันเริ่ม"),
  endDate: z.string().min(1, "กรุณาเลือกวันสิ้นสุด"),
  reason: z.string().min(1, "กรุณาระบุเหตุผล"),
}).refine(data => !isAfter(new Date(data.startDate), new Date(data.endDate)), {
    message: 'วันที่สิ้นสุดต้องไม่มาก่อนวันเริ่มต้น',
    path: ['endDate'],
});

type LeaveFormData = z.infer<typeof leaveSchema>;

function LeaveManageDialog({ 
  targetUser,
  isOpen, 
  onClose, 
  onConfirm, 
  isSubmitting 
}: { 
  targetUser: WithId<UserProfile>,
  isOpen: boolean, 
  onClose: () => void, 
  onConfirm: (data: LeaveFormData) => Promise<void>, 
  isSubmitting: boolean 
}) {
  const form = useForm<LeaveFormData>({
    resolver: zodResolver(leaveSchema),
    defaultValues: {
      leaveType: 'SICK',
      startDate: format(new Date(), 'yyyy-MM-dd'),
      endDate: format(new Date(), 'yyyy-MM-dd'),
      reason: 'บันทึกด่วนจากหน้าสลิปเงินเดือน',
    }
  });

  useEffect(() => {
    if (isOpen) {
        form.reset({
          leaveType: 'SICK',
          startDate: format(new Date(), 'yyyy-MM-dd'),
          endDate: format(new Date(), 'yyyy-MM-dd'),
          reason: 'บันทึกด่วนจากหน้าสลิปเงินเดือน',
        });
    }
  }, [form, isOpen]);
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>สร้างรายการลาใหม่ (โดย Admin)</DialogTitle>
            <DialogDescription>
              พนักงาน: {targetUser?.displayName}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form id="payroll-leave-form" onSubmit={form.handleSubmit(onConfirm)} className="space-y-4 py-4">
               <FormField control={form.control} name="leaveType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>ประเภทการลา</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                      <SelectContent>{LEAVE_TYPES.map(t => <SelectItem key={t} value={t}>{leaveTypeLabel(t)}</SelectItem>)}</SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="startDate" render={({ field }) => (<FormItem><FormLabel>วันเริ่มลา</FormLabel><FormControl><Input type="date" {...field}/></FormControl></FormItem>)} />
                    <FormField control={form.control} name="endDate" render={({ field }) => (<FormItem><FormLabel>วันสิ้นสุด</FormLabel><FormControl><Input type="date" {...field}/></FormControl></FormItem>)} />
                </div>
                <FormField control={form.control} name="reason" render={({ field }) => (
                  <FormItem>
                    <FormLabel>เหตุผล/หมายเหตุ</FormLabel>
                    <FormControl><Textarea {...field}/></FormControl>
                  </FormItem>
                )} />
            </form>
          </Form>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={isSubmitting}>ยกเลิก</Button>
            <Button type="submit" form="payroll-leave-form" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="mr-2 animate-spin"/> : 'สร้างและอนุมัติทันที'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}

export default function HRGeneratePayslipsPage() {
    const { db, firebaseApp } = useFirebase();
    const { toast } = useToast();
    const { profile: adminProfile } = useAuth();
    const printFrameRef = useRef<HTMLIFrameElement | null>(null);

    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [period, setPeriod] = useState<1 | 2>(new Date().getDate() <= 15 ? 1 : 2);
    
    const [isLoading, setIsLoading] = useState(false);
    const [isActing, setIsActing] = useState<string | null>(null);
    const [error, setError] = useState<Error | null>(null);

    const [employeeData, setEmployeeData] = useState<EmployeeRowData[]>([]);
    const [ssoDecision, setSsoDecision] = useState<any>(null);
    const [isSsoDecisionDialogOpen, setIsSsoDecisionDialogOpen] = useState(false);
    
    const [editingPayslip, setEditingPayslip] = useState<EmployeeRowData | null>(null);
    const [drawerSnapshot, setDrawerSnapshot] = useState<PayslipSnapshot | null>(null);
    const [otherPeriodSnapshot, setOtherPeriodSnapshot] = useState<PayslipSnapshot | null>(null);

    // Day selection states for adjustment
    const [isDaySelectOpen, setIsDaySelectOpen] = useState(false);
    const [selectedDayToAdjust, setSelectedDayToAdjust] = useState<any>(null);
    const [isLeaveManageOpen, setIsLeaveManageOpen] = useState(false);
    
    const settingsDocRef = useMemo(() => db ? doc(db, 'settings', 'hr') : null, [db]);
    const { data: hrSettings } = useDoc<HRSettings>(settingsDocRef);

    const storeSettingsRef = useMemo(() => (db ? doc(db, "settings", "store") : null), [db]);
    const { data: storeSettings, isLoading: isLoadingStore } = useDoc<StoreSettings>(storeSettingsRef);
    
    const hasPermission = useMemo(() => adminProfile?.role === 'ADMIN' || adminProfile?.role === 'MANAGER' || adminProfile?.department === 'MANAGEMENT', [adminProfile]);

    const handleFetchEmployees = useCallback(async (autoOpenUid?: string) => {
        if (!db || !hrSettings || !adminProfile) {
            return;
        }
        setIsLoading(true);
        setError(null);
        setEmployeeData([]);
        setSsoDecision(null);

        try {
            const period1StartDay = hrSettings.payroll?.period1Start || 1;
            const period1EndDay = hrSettings.payroll?.period1End || 15;
            const period2StartDay = hrSettings.payroll?.period2Start || 16;
            
            const periodStartDate = period === 1 
              ? set(currentMonth, { date: period1StartDay })
              : set(currentMonth, { date: period2StartDay });
            const periodEndDate = period === 1 
              ? set(currentMonth, { date: period1EndDay })
              : endOfMonth(currentMonth);
            
            const payPeriod = { start: periodStartDate, end: periodEndDate };
            const year = currentMonth.getFullYear();
            
            const ytdStart = startOfYear(currentMonth);
            const ytdStartStr = format(ytdStart, 'yyyy-MM-dd');
            const periodEndStr = format(payPeriod.end, 'yyyy-MM-dd');
            
            const payrollBatchId = `${format(currentMonth, 'yyyy-MM')}-${period}`;
            
            const monthBatchId = `${format(currentMonth, 'yyyy-MM')}`;
            const batchDocRef = doc(db, 'payrollBatches', monthBatchId);
            const batchDocSnap = await getDoc(batchDocRef);
            let finalSsoDecision = batchDocSnap.exists() ? batchDocSnap.data().ssoDecision : null;
            
            if (!finalSsoDecision && period === 1) {
                finalSsoDecision = { 
                    employeePercent: Number(hrSettings.sso?.employeePercent ?? 0),
                    employerPercent: Number(hrSettings.sso?.employerPercent ?? 0),
                    monthlyMinBase: Number(hrSettings.sso?.monthlyMinBase ?? 0),
                    monthlyCap: Number(hrSettings.sso?.monthlyCap ?? 0),
                    source: 'AUTO_LOCK',
                    decidedAt: Timestamp.now(),
                    decidedByUid: adminProfile.uid,
                    decidedByName: adminProfile.displayName
                };
                await setDoc(batchDocRef, { ssoDecision: finalSsoDecision }, { merge: true });
            } else if (period === 2 && finalSsoDecision) {
                const checkDiff = (v1: any, v2: any) => Math.abs(Number(v1 || 0) - Number(v2 || 0)) > 0.01;
                const hasChanged = 
                    checkDiff(finalSsoDecision.employeePercent, hrSettings.sso?.employeePercent) ||
                    checkDiff(finalSsoDecision.employerPercent, hrSettings.sso?.employerPercent) ||
                    checkDiff(finalSsoDecision.monthlyMinBase, hrSettings.sso?.monthlyMinBase) ||
                    checkDiff(finalSsoDecision.monthlyCap, hrSettings.sso?.monthlyCap);
                
                if (hasChanged) {
                    setIsSsoDecisionDialogOpen(true);
                }
            }
            setSsoDecision(finalSsoDecision);

            const usersQuery = query(collection(db, 'users'), where('status', '==', 'ACTIVE'));
            const holidaysQuery = query(collection(db, 'hrHolidays'));
            const leavesQuery = query(collection(db, 'hrLeaves'), where('year', '==', year), where('status', '==', 'APPROVED'));
            const attendancePeriodQuery = query(collection(db, 'attendance'), where('timestamp', '>=', payPeriod.start), where('timestamp', '<=', payPeriod.end));
            const adjustmentsPeriodQuery = query(collection(db, 'hrAttendanceAdjustments'), where('date', '>=', format(payPeriod.start, 'yyyy-MM-dd')), where('date', '<=', format(payPeriod.end, 'yyyy-MM-dd')));
            const attendanceYtdQuery = query(collection(db, 'attendance'), where('timestamp', '>=', ytdStart), where('timestamp', '<=', payPeriod.end));
            const adjustmentsYtdQuery = query(collection(db, 'hrAttendanceAdjustments'), where('date', '>=', ytdStartStr), where('date', '<=', periodEndStr));
            const payslipsQuery = query(collection(db, 'payrollBatches', payrollBatchId, 'payslips'));

            const [
                usersSnap, holidaysSnap, leavesSnap, 
                attendancePeriodSnap, adjustmentsPeriodSnap,
                attendanceYtdSnap, adjustmentsYtdSnap,
                payslipsSnap
            ] = await Promise.all([
                getDocs(usersQuery),
                getDocs(holidaysQuery),
                getDocs(leavesQuery),
                getDocs(attendancePeriodQuery),
                getDocs(adjustmentsPeriodQuery),
                getDocs(attendanceYtdQuery),
                getDocs(adjustmentsYtdQuery),
                getDocs(payslipsQuery),
            ]);

            const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<UserProfile>));
            const activeUsers = allUsers.filter(u => u?.hr?.payType === 'MONTHLY' || u?.hr?.payType === 'DAILY' || u?.hr?.payType === 'MONTHLY_NOSCAN');

            const allHolidays = new Map(
              holidaysSnap.docs.map(d => {
                const raw = d.data().date;
                const key = typeof raw === "string" ? raw.trim().slice(0, 10) : (raw?.toDate ? format(raw.toDate(), "yyyy-MM-dd") : "");
                return [key, d.data().name];
              }).filter(([k]) => !!k)
            );
            
            const allLeavesYear = leavesSnap.docs.map(d => d.data() as LeaveRequest);
            const allAttendancePeriod = attendancePeriodSnap.docs.map(d => d.data() as Attendance);
            const allAdjustmentsPeriod = adjustmentsPeriodSnap.docs.map(d => ({id: d.id, ...d.data()} as WithId<AttendanceAdjustment>));
            const allAttendanceYtd = attendanceYtdSnap.docs.map(d => d.data() as Attendance);
            const allAdjustmentsYtd = adjustmentsYtdSnap.docs.map(d => ({id: d.id, ...d.data()} as WithId<AttendanceAdjustment>));
            const existingPayslips = new Map(payslipsSnap.docs.map(d => [d.id, d.data() as PayslipNew]));

            const data = activeUsers.map(user => {
                const userLeaves = allLeavesYear.filter(l => l.userId === user.id);
                const userAttendanceThisPeriod = allAttendancePeriod.filter(a => a.userId === user.id);
                const userAdjustmentsThisPeriod = allAdjustmentsPeriod.filter(a => a.userId === user.id);
                const userAttendanceYtd = allAttendanceYtd.filter(a => a.userId === user.id);
                const userAdjustmentsYtd = allAdjustmentsYtd.filter(a => a.userId === user.id);

                const periodMetrics = computePeriodMetrics({ user, payType: user.hr!.payType!, period: payPeriod, hrSettings, holidays: allHolidays, userLeavesApprovedYear: userLeaves, userAttendance: userAttendanceThisPeriod, userAdjustments: userAdjustmentsThisPeriod, today: new Date() });
                const periodMetricsYtd = computePeriodMetrics({ user, payType: user.hr!.payType!, period: {start: ytdStart, end: payPeriod.end }, hrSettings, holidays: allHolidays, userLeavesApprovedYear: userLeaves, userAttendance: userAttendanceYtd, userAdjustments: userAdjustmentsYtd, today: new Date() });
                const existingSlip = existingPayslips.get(user.id);
                
                return { ...user, periodMetrics, periodMetricsYtd, payslipStatus: existingSlip?.status ?? 'ไม่มีสลิป', snapshot: existingSlip?.snapshot ?? null, revisionNo: existingSlip?.revisionNo };
            });
            setEmployeeData(data);

            if (autoOpenUid) {
                const target = data.find(e => e.id === autoOpenUid);
                if (target) handleOpenDrawer(target);
            }
        } catch (e: any) {
            setError(e);
            toast({ variant: 'destructive', title: 'เกิดข้อผิดพลาด', description: e.message });
        } finally {
            setIsLoading(false);
        }
    }, [db, hrSettings, currentMonth, period, adminProfile, toast]);

    // Automatic fetch on dependencies change
    useEffect(() => {
        if (hasPermission && hrSettings && adminProfile && db) {
            handleFetchEmployees();
        }
    }, [currentMonth, period, hrSettings, adminProfile, db, hasPermission, handleFetchEmployees]);
    
    const handleSsoDecisionConfirm = async (decision: any) => {
        if (!db || !adminProfile) return;
        const monthBatchId = `${format(currentMonth, 'yyyy-MM')}`;
        const batchRef = doc(db, 'payrollBatches', monthBatchId);
        const finalDecision = { ...decision, decidedAt: serverTimestamp(), decidedByUid: adminProfile.uid, decidedByName: adminProfile.displayName };
        await setDoc(batchRef, { ssoDecision: finalDecision }, { merge: true });
        setSsoDecision(decision);
        setIsSsoDecisionDialogOpen(false);
        toast({ title: 'อัปเดตการตั้งค่า SSO สำหรับเดือนนี้แล้ว', description: 'กรุณากดดึงข้อมูลอีกครั้งเพื่อใช้ค่าใหม่นี้ค่ะ' });
    };

    const handleOpenDrawer = async (user: EmployeeRowData, forceRecalculate: boolean = false) => {
        if (!db) return;
        setEditingPayslip(user);
        const { periodMetrics, periodMetricsYtd, snapshot: existingSnapshot, hr } = user;

        if (!hr?.payType || hr.payType === 'NOPAY') return;
        if (!periodMetrics || !periodMetricsYtd) { toast({variant: 'destructive', title: 'คำนวณไม่สำเร็จ'}); setEditingPayslip(null); return; }
        
        // Fetch Other Period Data for SSO Cross-period analysis
        const otherPeriodNo = period === 1 ? 2 : 1;
        const otherBatchId = `${format(currentMonth, 'yyyy-MM')}-${otherPeriodNo}`;
        const otherPayslipRef = doc(db, 'payrollBatches', otherBatchId, 'payslips', user.id);
        const otherPayslipSnap = await getDoc(otherPayslipRef);
        const otherSnapshot = otherPayslipSnap.exists() ? (otherPayslipSnap.data().snapshot as PayslipSnapshot) : null;
        setOtherPeriodSnapshot(otherSnapshot);

        // STRATEGY: If snapshot exists and not forcing recalculate, use the frozen snapshot values
        if (existingSnapshot && !forceRecalculate) {
            setDrawerSnapshot(existingSnapshot);
            return;
        }

        // RECALCULATE LOGIC (Used for new slips or when admin clicks 'recalculate')
        let basePay = 0;
        if (hr.payType === 'DAILY') {
            basePay = Math.round((hr.salaryDaily || 0) * periodMetrics.attendanceSummary.payableUnits);
        } else {
            basePay = Math.round((hr?.salaryMonthly ?? 0) / 2);
        }

        const manualAdditions = existingSnapshot?.additions?.filter(a => !a.name.startsWith('[AUTO]')) ?? [];
        const manualDeductions = existingSnapshot?.deductions?.filter(d => !d.name.startsWith('[AUTO]')) ?? [];
        
        let initialSnapshot: PayslipSnapshot = {
            basePay: Math.round(basePay),
            netPay: 0,
            additions: manualAdditions,
            deductions: [...manualDeductions, ...periodMetrics.autoDeductions],
            attendanceSummary: periodMetrics.attendanceSummary,
            leaveSummary: periodMetrics.leaveSummary,
            attendanceSummaryYtd: periodMetricsYtd.attendanceSummary,
            leaveSummaryYtd: periodMetricsYtd.leaveSummary,
            calcNotes: periodMetrics.calcNotes,
        };
        
        if (user.hr?.ssoRegistered !== false && ssoDecision && (hr.payType === 'MONTHLY' || hr.payType === 'DAILY' || hr.payType === 'MONTHLY_NOSCAN')) {
            const { employeePercent = 0, monthlyMinBase = 0, monthlyCap = Infinity } = ssoDecision;
            let ssoAmountThisPeriod = 0;

            if ((hr.payType === 'MONTHLY' || hr.payType === 'MONTHLY_NOSCAN') && hr.salaryMonthly) {
                const ssoMonthly = calcSsoMonthly(hr.salaryMonthly, employeePercent, monthlyMinBase, monthlyCap);
                const { p1, p2 } = splitSsoHalf(ssoMonthly);
                if (period === 1) ssoAmountThisPeriod = p1;
                else { 
                    const p1Deducted = otherSnapshot?.deductions?.find((d:any) => d.name === '[AUTO] ประกันสังคม')?.amount ?? 0;
                    ssoAmountThisPeriod = Math.max(0, ssoMonthly - p1Deducted);
                }
            } else if (hr.payType === 'DAILY' && hr.salaryDaily) {
                if (period === 1) ssoAmountThisPeriod = Math.round((hr.salaryDaily * periodMetrics.attendanceSummary.payableUnits) * (employeePercent / 100));
                else {
                    const totalMonthlyIncome = (hr.salaryDaily * (otherSnapshot?.attendanceSummary?.payableUnits || 0)) + (hr.salaryDaily * periodMetrics.attendanceSummary.payableUnits);
                    const totalSsoMonthly = calcSsoMonthly(totalMonthlyIncome, employeePercent, monthlyMinBase, monthlyCap);
                    const p1Deducted = otherSnapshot?.deductions?.find((d:any) => d.name === '[AUTO] ประกันสังคม')?.amount ?? 0;
                    ssoAmountThisPeriod = Math.max(0, totalSsoMonthly - p1Deducted);
                }
            }
            
            initialSnapshot.deductions = initialSnapshot.deductions.filter(d => d.name !== '[AUTO] ประกันสังคม');
            if (ssoAmountThisPeriod > 0) {
                initialSnapshot.deductions.push({ 
                    name: '[AUTO] ประกันสังคม', 
                    amount: Math.round(ssoAmountThisPeriod), 
                    notes: `เรท ${employeePercent}%` 
                });
            }
        }

        const totals = calcTotals(initialSnapshot);
        setDrawerSnapshot({ ...initialSnapshot, netPay: Math.round(totals.netPay) });
    };
    
    const handleSaveDraft = async () => {
        if (!db || !adminProfile || !editingPayslip || !drawerSnapshot) return;
        setIsActing(editingPayslip.id);
        const payrollBatchId = `${format(currentMonth, 'yyyy-MM')}-${period}`;
        const batchRef = doc(db, 'payrollBatches', payrollBatchId);
        const payslipRef = doc(db, 'payrollBatches', payrollBatchId, 'payslips', editingPayslip.id);
        try {
            await setDoc(batchRef, { year: currentMonth.getFullYear(), month: currentMonth.getMonth() + 1, periodNo: period, createdAt: serverTimestamp(), createdByUid: adminProfile.uid, createdByName: adminProfile.displayName }, { merge: true });
            const totals = calcTotals(drawerSnapshot);
            const finalSnapshot = { ...drawerSnapshot, netPay: Math.round(totals.netPay) };
            await setDoc(payslipRef, { status: 'DRAFT', snapshot: finalSnapshot, userId: editingPayslip.id, userName: editingPayslip.displayName, batchId: payrollBatchId, revisionNo: editingPayslip.revisionNo || 0, updatedAt: serverTimestamp() }, { merge: true });
            setEmployeeData(prev => prev.map(e => e.id === editingPayslip.id ? { ...e, payslipStatus: 'DRAFT', snapshot: finalSnapshot } : e));
            toast({ title: `บันทึกร่างสลิปเรียบร้อย` });
            setEditingPayslip(null); setDrawerSnapshot(null);
        } catch (e: any) { toast({ variant: 'destructive', title: 'Error', description: e.message }); } finally { setIsActing(null); }
    };
    
    const handleSaveAndSend = async () => {
        if (!db || !adminProfile || !editingPayslip || !drawerSnapshot) return;
        setIsActing(editingPayslip.id);
        const payrollBatchId = `${format(currentMonth, 'yyyy-MM')}-${period}`;
        const batchRef = doc(db, 'payrollBatches', payrollBatchId);
        const payslipRef = doc(db, 'payrollBatches', payrollBatchId, 'payslips', editingPayslip.id);
        try {
            await setDoc(batchRef, { year: currentMonth.getFullYear(), month: currentMonth.getMonth() + 1, periodNo: period, createdAt: serverTimestamp(), createdByUid: adminProfile.uid, createdByName: adminProfile.displayName }, { merge: true });
            const totals = calcTotals(drawerSnapshot);
            const finalSnapshot = { ...drawerSnapshot, netPay: Math.round(totals.netPay) };
            const nextRevisionNo = (editingPayslip.revisionNo || 0) + 1;
            await setDoc(payslipRef, { status: 'SENT_TO_EMPLOYEE', snapshot: finalSnapshot, userId: editingPayslip.id, userName: editingPayslip.displayName, batchId: payrollBatchId, revisionNo: nextRevisionNo, updatedAt: serverTimestamp(), sentAt: serverTimestamp(), lockedAt: serverTimestamp() }, { merge: true });
            setEmployeeData(prev => prev.map(e => e.id === editingPayslip.id ? { ...e, payslipStatus: 'SENT_TO_EMPLOYEE', snapshot: finalSnapshot, revisionNo: nextRevisionNo } : e));
            toast({ title: `ส่งสลิปให้พนักงานแล้ว` });
            setEditingPayslip(null); setDrawerSnapshot(null);
        } catch (e: any) { toast({ variant: 'destructive', title: 'Error', description: e.message }); } finally { setIsActing(null); }
    };

    const handlePrintInDrawer = () => {
        if (!editingPayslip || !drawerSnapshot || !storeSettings) return;
        try {
          const frame = printFrameRef.current;
          if (!frame) return;
          const totals = calcTotals(drawerSnapshot);
          const periodLabelText = `งวด ${period} (${format(currentMonth, 'MMMM yyyy')})`;
          const html = `
          <html><head><meta charset="utf-8" /><style>@page { size: A4; margin: 15mm; } body { font-family: sans-serif; font-size: 14px; } .header { text-align: center; border-bottom: 2px solid #333; margin-bottom: 20px; } table { width: 100%; border-collapse: collapse; margin-bottom: 15px; } th, td { border: 1px solid #ddd; padding: 8px; } .text-right { text-align: right; } .total { font-weight: bold; background: #eee; }</style></head>
          <body>
            <div class="header"><h1>${storeSettings.taxName || 'Sahadiesel Service'}</h1><p>ใบแจ้งยอดเงินเดือน / PAY SLIP</p></div>
            <p><strong>พนักงาน:</strong> ${editingPayslip.displayName} | <strong>งวด:</strong> ${periodLabelText}</p>
            <table><thead><tr><th>รายการ</th><th class="text-right">จำนวนเงิน</th></tr></thead>
              <tbody>
                <tr><td>เงินเดือน/ค่าแรงงวดนี้</td><td class="text-right">${formatCurrency(totals.basePay)}</td></tr>
                ${(drawerSnapshot.additions || []).map(a => `<tr><td>${a.name}</td><td class="text-right">${formatCurrency(a.amount)}</td></tr>`).join('')}
                ${(drawerSnapshot.deductions || []).map(d => `<tr><td>${d.name}</td><td class="text-right">-${formatCurrency(d.amount)}</td></tr>`).join('')}
                <tr class="total"><td>สุทธิได้รับจริง</td><td class="text-right">${formatCurrency(totals.netPay)} บาท</td></tr>
              </tbody>
            </table>
          </body></html>`;
          frame.onload = () => { frame.contentWindow?.focus(); frame.contentWindow?.print(); };
          frame.srcdoc = html;
        } catch (e) { toast({ variant: 'destructive', title: 'พิมพ์ไม่สำเร็จ' }); }
    };

    const periodDaysList = useMemo(() => {
        if (!hrSettings) return [];
        const p1EndDay = hrSettings.payroll?.period1End || 15;
        const p2StartDay = hrSettings.payroll?.period2Start || 16;
        const start = period === 1 ? startOfMonth(currentMonth) : set(currentMonth, { date: p2StartDay });
        const end = period === 1 ? set(currentMonth, { date: p1EndDay }) : endOfMonth(currentMonth);
        return eachDayOfInterval({ start, end });
    }, [currentMonth, period, hrSettings]);

    const handleAdminLeaveSave = async (data: LeaveFormData) => {
        if (!db || !adminProfile || !editingPayslip) return;
        setIsActing(editingPayslip.id);
        try {
            const days = differenceInCalendarDays(new Date(data.endDate), new Date(data.startDate)) + 1;
            await addDoc(collection(db, 'hrLeaves'), { userId: editingPayslip.id, userName: editingPayslip.displayName, ...data, days, year: getYear(parseISO(data.startDate)), status: 'APPROVED', approvedByName: adminProfile.displayName, approvedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
            toast({ title: "บันทึกใบลาสำเร็จ" });
            setIsLeaveManageOpen(false);
            handleFetchEmployees(editingPayslip.id);
        } catch (e: any) { toast({ variant: 'destructive', title: "Error", description: e.message }); } finally { setIsActing(null); }
    };

    if (!hasPermission) return <Card><CardHeader><CardTitle>ไม่มีสิทธิ์เข้าถึง</CardTitle></CardHeader></Card>;

    return (
        <>
            <PageHeader title="สร้างสลิปเงินเดือน" description="คำนวณ สรุป สาย ขาด ลา และสร้างสลิปเงินเดือนประจำงวด" />
            <Card>
                <CardHeader>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <CardTitle className="text-lg">เลือกช่วงเวลางวดบัญชี</CardTitle>
                            {isLoading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                        </div>
                        <div className="flex items-center gap-2 self-end sm:self-center">
                            <Button variant="outline" size="icon" onClick={() => setCurrentMonth(prev => subMonths(prev, 1))}><ChevronLeft /></Button>
                            <span className="font-semibold text-lg text-center w-32">{format(currentMonth, 'MMMM yyyy')}</span>
                            <Button variant="outline" size="icon" onClick={() => setCurrentMonth(prev => addMonths(prev, 1))}><ChevronRight /></Button>
                            <Select value={period.toString()} onValueChange={(v) => setPeriod(Number(v) as 1 | 2)}>
                                <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                                <SelectContent><SelectItem value="1">งวดที่ 1</SelectItem><SelectItem value="2">งวดที่ 2</SelectItem></SelectContent>
                            </Select>
                            <Button variant="ghost" size="icon" onClick={() => handleFetchEmployees()} disabled={isLoading} title="รีเฟรชข้อมูล">
                                <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                            </Button>
                        </div>
                    </div>
                </CardHeader>
            </Card>

            {isLoading && employeeData.length === 0 && (
                <div className="flex justify-center p-12">
                    <div className="flex flex-col items-center gap-4">
                        <Loader2 className="animate-spin h-10 w-10 text-primary" />
                        <p className="text-sm text-muted-foreground animate-pulse">กำลังคำนวณและสรุปข้อมูลพนักงาน...</p>
                    </div>
                </div>
            )}
            
            {employeeData.length > 0 && (
                <Card className="mt-6">
                    <CardHeader>
                        <div className="flex justify-between items-center">
                            <CardTitle>รายชื่อพนักงาน ({employeeData.length} ท่าน)</CardTitle>
                            <Badge variant="outline" className="bg-primary/5 text-primary">Auto-Updated</Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader><TableRow><TableHead className="pl-6">ชื่อพนักงาน</TableHead><TableHead>แผนก</TableHead><TableHead>ประเภท</TableHead><TableHead className="text-right">วันทำงาน</TableHead><TableHead>สถานะสลิป</TableHead><TableHead className="text-right pr-6">จัดการ</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {employeeData.map(user => (
                                    <TableRow key={user.id} className="hover:bg-muted/30">
                                        <TableCell className="pl-6 font-medium">{user.displayName}</TableCell>
                                        <TableCell className="text-xs text-muted-foreground">{deptLabel(user.department)}</TableCell>
                                        <TableCell><Badge variant="outline" className="text-[10px]">{payTypeLabel(user.hr?.payType)}</Badge></TableCell>
                                        <TableCell className="text-right font-bold text-primary">{user.periodMetrics?.attendanceSummary.payableUnits ?? '-'}</TableCell>
                                        <TableCell><Badge variant={getStatusBadgeVariant(user.payslipStatus)}>{newPayslipStatusLabel(user.payslipStatus) || user.payslipStatus}</Badge></TableCell>
                                        <TableCell className="text-right pr-6">
                                            <Button variant="ghost" size="icon" onClick={() => handleOpenDrawer(user)} disabled={isActing !== null || user.payslipStatus === 'PAID'}>
                                                {user.snapshot ? <Eye className="h-4 w-4" /> : <FilePlus className="h-4 w-4" />}
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            {editingPayslip && drawerSnapshot && (
                <PayslipSlipDrawer
                    open={!!editingPayslip} onOpenChange={(open) => !open && setEditingPayslip(null)}
                    title="แบบฟอร์มสลิปเงินเดือน" description={`${editingPayslip.displayName} - งวด ${period}`}
                    onPrint={handlePrintInDrawer}
                    footerActions={ (editingPayslip.payslipStatus !== 'PAID') && (
                        <>
                          <Button variant="ghost" onClick={() => handleOpenDrawer(editingPayslip, true)} disabled={isActing === editingPayslip.id} className="text-amber-600"><RefreshCw className="mr-2 h-4 w-4"/>คำนวณใหม่ตามโปรไฟล์</Button>
                          <Button variant="outline" onClick={() => setEditingPayslip(null)} disabled={isActing === editingPayslip.id}>ยกเลิก</Button>
                          <Button onClick={handleSaveDraft} disabled={isActing === editingPayslip.id} variant="secondary">บันทึกร่าง</Button>
                          <Button onClick={handleSaveAndSend} disabled={isActing === editingPayslip.id} className="bg-primary">{isActing === editingPayslip.id ? <Loader2 className="mr-2 animate-spin h-4 w-4"/> : <Send className="mr-2 h-4 w-4"/>}ส่งให้พนักงาน</Button>
                        </>
                      )
                    }
                >
                    <PayslipSlipView 
                        userName={editingPayslip.displayName} 
                        periodLabel={`งวด ${period} (${format(currentMonth, 'MMMM yyyy')})`} 
                        snapshot={drawerSnapshot} 
                        otherPeriodSnapshot={otherPeriodSnapshot}
                        currentPeriodNo={period}
                        userProfile={editingPayslip}
                        mode="edit" 
                        payType={editingPayslip.hr?.payType} 
                        onChange={setDrawerSnapshot}
                        onAdjustAttendance={() => setIsDaySelectOpen(true)}
                        onAdjustLeave={() => setIsLeaveManageOpen(true)}
                    />
                </PayslipSlipDrawer>
            )}

            <Dialog open={isDaySelectOpen} onOpenChange={setIsDaySelectOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader><DialogTitle>เลือกวันที่ต้องการปรับปรุงเวลา</DialogTitle></DialogHeader>
                    <ScrollArea className="h-80 pr-4"><div className="space-y-1">{periodDaysList.map(day => (<Button key={day.toISOString()} variant="ghost" className="w-full justify-between" onClick={() => { setSelectedDayToAdjust({ date: day }); setIsDaySelectOpen(false); }}><span>{format(day, 'dd/MM/yyyy')}</span><span className="text-[10px] text-muted-foreground">{format(day, 'EEEE')}</span></Button>))}</div></ScrollArea>
                </DialogContent>
            </Dialog>

            {selectedDayToAdjust && editingPayslip && (
                <AttendanceAdjustmentDialog isOpen={!!selectedDayToAdjust} onOpenChange={(open) => !open && setSelectedDayToAdjust(null)} dayInfo={{ date: selectedDayToAdjust.date, status: 'NO_DATA' }} user={editingPayslip} onSaved={() => handleFetchEmployees(editingPayslip.id)} />
            )}

            {editingPayslip && (
                <LeaveManageDialog targetUser={editingPayslip} isOpen={isLeaveManageOpen} onClose={() => setIsLeaveManageOpen(false)} onConfirm={handleAdminLeaveSave} isSubmitting={isActing === editingPayslip.id} />
            )}

             {isSsoDecisionDialogOpen && ssoDecision && hrSettings?.sso && (
                <SsoDecisionDialog isOpen={isSsoDecisionDialogOpen} onClose={() => setIsSsoDecisionDialogOpen(false)} onConfirm={handleSsoDecisionConfirm} batchDecision={ssoDecision} currentSettings={hrSettings.sso} />
             )}
             <iframe ref={printFrameRef} className="hidden" title="Print Frame" />
        </>
    );
}
