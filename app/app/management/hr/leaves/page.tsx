"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { collection, query, orderBy, updateDoc, doc, serverTimestamp, where, deleteDoc, getDocs, addDoc, Timestamp } from "firebase/firestore";
import { useFirebase, useCollection, useDoc } from "@/firebase";
import type { WithId } from "@/firebase/firestore/use-collection";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { getYear, parseISO, differenceInCalendarDays, isBefore, startOfYear, endOfYear, eachDayOfInterval, isSaturday, isSunday, format as dfFormat, isWithinInterval, startOfMonth, endOfMonth, isAfter, startOfToday, set } from 'date-fns';
import { safeFormat } from '@/lib/date-utils';
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Loader2, CheckCircle, XCircle, ShieldAlert, MoreHorizontal, Trash2, Edit, PlusCircle, FileText, Search, ExternalLink, AlertCircle, CalendarDays } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

import { LEAVE_STATUSES, LEAVE_TYPES } from "@/lib/constants";
import type { UserProfile, LeaveRequest, HRSettings, LeaveStatus, Attendance, HRHoliday, AttendanceAdjustment } from "@/lib/types";
import { leaveStatusLabel, leaveTypeLabel, deptLabel } from "@/lib/ui-labels";

const leaveSchema = z.object({
  leaveType: z.enum(LEAVE_TYPES),
  startDate: z.string().min(1, "กรุณาเลือกวันเริ่ม"),
  endDate: z.string().min(1, "กรุณาเลือกวันสิ้นสุด"),
  reason: z.string().min(1, "กรุณาระบุเหตุผล"),
  isHalfDay: z.boolean().default(false),
  halfDaySession: z.enum(['MORNING', 'AFTERNOON']).optional(),
}).refine(data => !isBefore(new Date(data.endDate), new Date(data.startDate)), {
    message: 'วันที่สิ้นสุดต้องไม่มาก่อนวันเริ่มต้น',
    path: ['endDate'],
});

type LeaveFormData = z.infer<typeof leaveSchema>;

const monthOptions = [
  { value: "ALL", label: "ทั้งหมด (ทั้งปี)" },
  { value: "1", label: "มกราคม" },
  { value: "2", label: "กุมภาพันธ์" },
  { value: "3", label: "มีนาคม" },
  { value: "4", label: "เมษายน" },
  { value: "5", label: "พฤษภาคม" },
  { value: "6", label: "มิถุนายน" },
  { value: "7", label: "กุมภาพันธ์" },
  { value: "8", label: "สิงหาคม" },
  { value: "9", label: "กันยายน" },
  { value: "10", label: "ตุลาคม" },
  { value: "11", label: "พฤศจิกายน" },
  { value: "12", label: "ธันวาคม" },
];

function LeaveManageDialog({ 
  leave, 
  targetUser,
  isOpen, 
  onClose, 
  onConfirm, 
  isSubmitting 
}: { 
  leave?: WithId<LeaveRequest> | null, 
  targetUser?: WithId<UserProfile> | null,
  isOpen: boolean, 
  onClose: () => void, 
  onConfirm: (data: LeaveFormData) => Promise<void>, 
  isSubmitting: boolean 
}) {
  const form = useForm<LeaveFormData>({
    resolver: zodResolver(leaveSchema),
    defaultValues: {
      leaveType: 'SICK',
      startDate: "",
      endDate: "",
      reason: '',
      isHalfDay: false,
      halfDaySession: 'MORNING',
    }
  });

  const watchedIsHalfDay = form.watch('isHalfDay');
  const watchedStartDate = form.watch('startDate');

  useEffect(() => {
    if (watchedIsHalfDay && watchedStartDate) {
        form.setValue('endDate', watchedStartDate);
    }
  }, [watchedIsHalfDay, watchedStartDate, form]);

  useEffect(() => {
    if (isOpen) {
      if (leave) {
        form.reset({
          leaveType: leave.leaveType,
          startDate: leave.startDate,
          endDate: leave.endDate,
          reason: leave.reason,
          isHalfDay: leave.isHalfDay || false,
          halfDaySession: leave.halfDaySession || 'MORNING',
        });
      } else {
        const todayStr = dfFormat(new Date(), 'yyyy-MM-dd');
        form.reset({
          leaveType: 'SICK',
          startDate: todayStr,
          endDate: todayStr,
          reason: 'Admin บันทึกให้',
          isHalfDay: false,
          halfDaySession: 'MORNING',
        });
      }
    }
  }, [leave, form, isOpen]);
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{leave ? 'แก้ไขข้อมูลการลา' : 'สร้างรายการลาใหม่ (โดย Admin)'}</DialogTitle>
            <DialogDescription>
              พนักงาน: {leave?.userName || targetUser?.displayName || 'ไม่ระบุ'}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form id="manage-leave-form" onSubmit={form.handleSubmit(onConfirm)} className="space-y-4 py-4">
               <FormField control={form.control} name="leaveType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>ประเภทการลา</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                      <SelectContent>{LEAVE_TYPES.map(t => <SelectItem key={t} value={t}>{leaveTypeLabel(t)}</SelectItem>)}</SelectContent>
                    </Select>
                  </FormItem>
                )} />

                <div className="flex items-center space-x-2 border p-3 rounded-md bg-muted/20">
                    <FormField control={form.control} name="isHalfDay" render={({ field }) => (
                        <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                            <FormControl>
                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                            <FormLabel className="font-bold cursor-pointer">ลาครึ่งวัน (0.5 วัน)</FormLabel>
                        </FormItem>
                    )} />
                </div>

                {watchedIsHalfDay && (
                    <FormField control={form.control} name="halfDaySession" render={({ field }) => (
                        <FormItem>
                            <FormLabel>ช่วงเวลาที่ลา</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                                <SelectContent>
                                    <SelectItem value="MORNING">ครึ่งเช้า</SelectItem>
                                    <SelectItem value="AFTERNOON">ครึ่งบ่าย</SelectItem>
                                </SelectContent>
                            </Select>
                        </FormItem>
                    )} />
                )}

                <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="startDate" render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>วันเริ่มลา</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant={"outline"}
                                  className={cn(
                                    "w-full pl-3 text-left font-normal",
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
                        </FormItem>
                    )} />
                    <FormField control={form.control} name="endDate" render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>วันสิ้นสุด</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant={"outline"}
                                  className={cn(
                                    "w-full pl-3 text-left font-normal",
                                    !field.value && "text-muted-foreground"
                                  )}
                                  disabled={watchedIsHalfDay}
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
                                disabled={(date) => isBefore(date, parseISO(watchedStartDate))}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                        </FormItem>
                    )} />
                </div>
                <FormField control={form.control} name="reason" render={({ field }) => (<FormItem><FormLabel>เหตุผล/หมายเหตุ</FormLabel><FormControl><Textarea {...field}/></FormControl></FormItem>)} />
            </form>
          </Form>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={isSubmitting}>ยกเลิก</Button>
            <Button type="submit" form="manage-leave-form" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="mr-2 animate-spin"/> : (leave ? 'บันทึกการแก้ไข' : 'สร้างและอนุมัติทันที')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}

export default function ManagementHRLeavesPage() {
  const { db } = useFirebase();
  const { profile: adminProfile } = useAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState('summary');
  
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [filters, setFilters] = useState({ status: 'ALL', userId: 'ALL' });

  useEffect(() => {
    const today = new Date();
    setSelectedYear(today.getFullYear());
    setSelectedMonth(String(today.getMonth() + 1));
  }, []);
  
  const [rejectingLeave, setRejectingLeave] = useState<WithId<LeaveRequest> | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [approvingLeave, setApprovingLeave] = useState<WithId<LeaveRequest> | null>(null);
  const [deletingLeave, setDeletingLeave] = useState<WithId<LeaveRequest> | null>(null);
  const [editingLeave, setEditingLeave] = useState<WithId<LeaveRequest> | null>(null);
  const [creatingForUser, setCreatingForUser] = useState<WithId<UserProfile> | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [periodAttendance, setPeriodAttendance] = useState<Attendance[]>([]);
  const [periodAdjustments, setPeriodAdjustments] = useState<WithId<AttendanceAdjustment>[]>([]);
  const [periodHolidays, setPeriodHolidays] = useState<Map<string, string>>(new Map());
  const [isLoadingExtras, setIsLoadingExtras] = useState(false);
  const [indexCreationUrl, setIndexCreationUrl] = useState<string | null>(null);

  const usersQuery = useMemo(() => db ? query(collection(db, 'users'), orderBy('displayName', 'asc')) : null, [db]);
  const leavesQuery = useMemo(() => db ? query(collection(db, 'hrLeaves'), orderBy('createdAt', 'desc')) : null, [db]);
  const settingsDocRef = useMemo(() => db ? doc(db, 'settings', 'hr') : null, [db]);

  const { data: users, isLoading: isLoadingUsers } = useCollection<UserProfile>(usersQuery);
  const { data: allLeaves, isLoading: isLoadingLeaves } = useCollection<LeaveRequest>(leavesQuery);
  const { data: hrSettings, isLoading: isLoadingSettings } = useDoc<HRSettings>(settingsDocRef);

  const pendingSubmittedCount = useMemo(
    () => (allLeaves ?? []).filter((l) => l.status === "SUBMITTED").length,
    [allLeaves]
  );

  useEffect(() => {
    if (!db || !selectedYear || !selectedMonth) return;
    
    const fetchPeriodData = async () => {
        setIsLoadingExtras(true);
        setIndexCreationUrl(null);
        try {
            let start: Date;
            let end: Date;

            if (selectedMonth === "ALL") {
                start = startOfYear(new Date(selectedYear, 0, 1));
                end = endOfYear(new Date(selectedYear, 0, 1));
            } else {
                const monthIndex = parseInt(selectedMonth) - 1;
                start = startOfMonth(new Date(selectedYear, monthIndex, 1));
                end = endOfMonth(new Date(selectedYear, monthIndex, 1));
            }
            
            const [attSnap, holSnap, adjSnap] = await Promise.all([
                getDocs(query(collection(db, 'attendance'), where('timestamp', '>=', start), where('timestamp', '<=', end))),
                getDocs(query(collection(db, 'hrHolidays'), where('date', '>=', dfFormat(start, 'yyyy-MM-dd')), where('date', '<=', dfFormat(end, 'yyyy-MM-dd')))),
                getDocs(query(collection(db, 'hrAttendanceAdjustments'), where('date', '>=', dfFormat(start, 'yyyy-MM-dd')), where('date', '<=', dfFormat(end, 'yyyy-MM-dd'))))
            ]);

            setPeriodAttendance(attSnap.docs.map(d => ({ id: d.id, ...d.data() } as Attendance)));
            setPeriodHolidays(new Map(holSnap.docs.map(d => [d.data().date, d.data().name])));
            setPeriodAdjustments(adjSnap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<AttendanceAdjustment>)));
        } catch (e: any) {
            if (e.message?.includes('requires an index')) {
                const urlMatch = e.message.match(/https?:\/\/[^\s]+/);
                if (urlMatch) setIndexCreationUrl(urlMatch[0]);
            }
        } finally {
            setIsLoadingExtras(false);
        }
    };

    fetchPeriodData();
  }, [db, selectedYear, selectedMonth]);

  const { leaveSummary, filteredLeaves, yearOptions } = useMemo(() => {
    const years = new Set<number>();
    const currentYear = getYear(new Date());
    years.add(currentYear);

    if (allLeaves) {
      allLeaves.forEach(leave => {
        const year = leave.year || (leave.startDate ? getYear(parseISO(leave.startDate)) : null);
        if (year) years.add(year);
      });
    }
    
    const sortedYears = Array.from(years).sort((a, b) => b - a);

    if (!allLeaves || !users || !selectedYear || !selectedMonth) {
      return { leaveSummary: [], filteredLeaves: [], yearOptions: sortedYears };
    }

    const today = startOfToday();
    let dateRangeForSummary: { start: Date; end: Date };

    if (selectedMonth === "ALL") {
      dateRangeForSummary = {
        start: startOfYear(new Date(selectedYear, 0, 1)),
        end: selectedYear === getYear(today) ? today : endOfYear(new Date(selectedYear, 0, 1)),
      };
    } else {
      const monthIndex = parseInt(selectedMonth) - 1;
      const start = startOfMonth(new Date(selectedYear, monthIndex, 1));
      const end = endOfMonth(new Date(selectedYear, monthIndex, 1));
      
      dateRangeForSummary = { start, end };
    }

    const daysInterval = eachDayOfInterval({ start: dateRangeForSummary.start, end: dateRangeForSummary.end });
    const weekendMode = hrSettings?.weekendPolicy?.mode || 'SAT_SUN';

    const summary = users
      .filter(u => u.hr?.payType === 'MONTHLY' || u.hr?.payType === 'DAILY')
      .map(user => {
        const userApprovedLeaves = allLeaves.filter(l => l.userId === user.id && l.status === 'APPROVED');
        const userAttendance = periodAttendance.filter(a => a.userId === user.id);
        const userAdjustments = periodAdjustments.filter(a => a.userId === user.id);

        const attendanceDates = new Set([
            ...userAttendance.map(a => dfFormat(a.timestamp.toDate(), 'yyyy-MM-dd')),
            ...userAdjustments.filter(a => a.type === 'ADD_RECORD').map(a => a.date)
        ]);

        let sickDays = 0;
        let businessDays = 0;
        let totalLeaveCount = 0;
        let absentDays = 0;

        daysInterval.forEach(day => {
            const dayStr = dfFormat(day, 'yyyy-MM-dd');
            const isToday = dayStr === dfFormat(today, 'yyyy-MM-dd');
            
            if (isAfter(day, today)) return;
            
            if (isToday) {
                const now = new Date();
                const cutoff = set(now, { hours: 23, minutes: 50, seconds: 0 });
                if (isBefore(now, cutoff) && !attendanceDates.has(dayStr)) return;
            }

            if (user.hr?.startDate && isBefore(day, parseISO(user.hr.startDate))) return;
            if (user.hr?.endDate && isBefore(parseISO(user.hr.endDate), day)) return;
            if (periodHolidays.has(dayStr)) return;
            const isWeekendDay = (weekendMode === 'SAT_SUN' && (isSaturday(day) || isSunday(day))) || (weekendMode === 'SUN_ONLY' && isSunday(day));
            if (isWeekendDay) return;
            
            const onLeaveOnThisDay = userApprovedLeaves.find(l => dayStr >= l.startDate && dayStr <= l.endDate);
            
            let leaveUnits = 0;
            if (onLeaveOnThisDay) {
                if (onLeaveOnThisDay.isHalfDay && onLeaveOnThisDay.startDate === onLeaveOnThisDay.endDate && dayStr === onLeaveOnThisDay.startDate) {
                    leaveUnits = 0.5;
                } else {
                    leaveUnits = 1;
                }
                
                if (onLeaveOnThisDay.leaveType === 'SICK') sickDays += leaveUnits;
                else if (onLeaveOnThisDay.leaveType === 'BUSINESS') businessDays += leaveUnits;
                totalLeaveCount += leaveUnits;

                if (leaveUnits === 1) return;
            }

            if (!attendanceDates.has(dayStr)) {
                absentDays += (1 - leaveUnits);
            }
        });

        return {
            userId: user.id,
            userName: user.displayName,
            user,
            SICK: sickDays,
            BUSINESS: businessDays,
            TOTAL: totalLeaveCount,
            ABSENT: absentDays
        };
    }).filter(s => filters.userId === 'ALL' || filters.userId === s.userId);
    
    const filtered = allLeaves.filter(leave => {
      const leaveYear = leave.year || (leave.startDate ? getYear(parseISO(leave.startDate)) : null);
      return (
        leaveYear === selectedYear &&
        (filters.status === 'ALL' || leave.status === filters.status) &&
        (filters.userId === 'ALL' || leave.userId === filters.userId)
      );
    });

    return { leaveSummary: summary, filteredLeaves: filtered, yearOptions: sortedYears };
  }, [allLeaves, users, selectedYear, selectedMonth, filters, periodAttendance, periodAdjustments, periodHolidays, hrSettings]);

  const handleApprove = async () => {
    if (!db || !adminProfile || !approvingLeave) return;
    setIsSubmitting(true);
    try {
      const leaveRef = doc(db, 'hrLeaves', approvingLeave.id);
      await updateDoc(leaveRef, {
        status: 'APPROVED',
        approvedByName: adminProfile.displayName,
        approvedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toast({ title: 'อนุมัติใบลาสำเร็จ' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'การอนุมัติล้มเหลว', description: error.message });
    } finally {
      setIsSubmitting(false);
      setApprovingLeave(null);
    }
  };

  const handleReject = async () => {
    if (!db || !adminProfile || !rejectingLeave || !rejectReason) return;
    setIsSubmitting(true);
    try {
      const leaveRef = doc(db, 'hrLeaves', rejectingLeave.id);
      await updateDoc(leaveRef, {
        status: 'REJECTED',
        rejectedByName: adminProfile.displayName,
        rejectedAt: serverTimestamp(),
        rejectReason,
        updatedAt: serverTimestamp(),
      });
      toast({ title: 'ปฏิเสธใบลาสำเร็จ' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'การปฏิเสธล้มเหลว', description: error.message });
    } finally {
      setIsSubmitting(false);
      setRejectingLeave(null);
      setRejectReason('');
    }
  };

  const handleAdminManageSave = async (data: LeaveFormData) => {
    if (!db || !adminProfile) return;
    setIsSubmitting(true);
    try {
        let days = differenceInCalendarDays(new Date(data.endDate), new Date(data.startDate)) + 1;
        if (data.isHalfDay) days = 0.5;
        const year = getYear(new Date(data.startDate));

        if (editingLeave) {
            await updateDoc(doc(db, 'hrLeaves', editingLeave.id), { ...data, days, year, updatedAt: serverTimestamp() });
            toast({ title: "แก้ไขใบลาสำเร็จ" });
            setEditingLeave(null);
        } else if (creatingForUser) {
            await addDoc(collection(db, 'hrLeaves'), {
                userId: creatingForUser.id,
                userName: creatingForUser.displayName,
                ...data,
                days,
                year,
                status: 'APPROVED', 
                approvedByName: adminProfile.displayName,
                approvedAt: serverTimestamp(),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            toast({ title: "สร้างและอนุมัติใบลาเรียบร้อย" });
            setCreatingForUser(null);
        }
    } catch (e: any) {
        toast({ variant: 'destructive', title: "ทำรายการไม่สำเร็จ", description: e.message });
    } finally { setIsSubmitting(false); }
  };

  const confirmDelete = async () => {
    if (!db || !deletingLeave) return;
    setIsSubmitting(true);
    try {
      await deleteDoc(doc(db, 'hrLeaves', deletingLeave.id));
      toast({ title: 'ลบรายการลาเรียบร้อย' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'ลบไม่สำเร็จ', description: error.message });
    } finally {
      setIsSubmitting(false);
      setDeletingLeave(null);
    }
  };

  if (isLoadingUsers || isLoadingSettings || isLoadingLeaves || !selectedYear || !selectedMonth) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="animate-spin h-8 w-8" /></div>;
  }

  return (
    <>
        <PageHeader title="จัดการวันลา" description="จัดการและตรวจสอบข้อมูลการลา/ขาดงาน ของพนักงาน" />
        <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
            <TabsTrigger value="summary">สรุปวันลาและวันขาด</TabsTrigger>
            <TabsTrigger value="requests" className="gap-2">
              <span>คำขอทั้งหมด</span>
              {pendingSubmittedCount > 0 && (
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2 border-black bg-yellow-400 animate-leave-pending-blink"
                  title={`มี ${pendingSubmittedCount} คำขอรออนุมัติ`}
                  aria-label={`มี ${pendingSubmittedCount} คำขอรออนุมัติ`}
                />
              )}
            </TabsTrigger>
        </TabsList>
        <TabsContent value="summary" className="space-y-4">
            <Card>
            <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <CardTitle>สรุปวันลาและวันขาดสะสม</CardTitle>
                    <CardDescription>
                      {selectedMonth === "ALL" 
                        ? `ประจำปี ${selectedYear}`
                        : `ประจำเดือน ${monthOptions.find(m => m.value === selectedMonth)?.label} ${selectedYear}`
                      }
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {isLoadingExtras && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    <Select value={selectedMonth || ""} onValueChange={setSelectedMonth}><SelectTrigger className="w-[150px]"><SelectValue placeholder="เลือกเดือน..." /></SelectTrigger><SelectContent>{monthOptions.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent></Select>
                    <Select value={selectedYear?.toString() || ""} onValueChange={(v) => setSelectedYear(Number(v))}><SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger><SelectContent>{yearOptions.map(y => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}</SelectContent></Select>
                  </div>
                </div>
            </CardHeader>
            <CardContent>
                <Table>
                <TableHeader><TableRow><TableHead>พนักงาน</TableHead><TableHead className="text-center">ป่วย (วัน)</TableHead><TableHead className="text-center">กิจ (วัน)</TableHead><TableHead className="text-center">รวมลา (วัน)</TableHead><TableHead className="text-center text-destructive font-bold">วันขาด (Absent)</TableHead><TableHead className="text-right">จัดการ</TableHead></TableRow></TableHeader>
                <TableBody>
                    {leaveSummary.length > 0 ? leaveSummary.map(s => (
                    <TableRow key={s.userId} className="hover:bg-muted/30 transition-colors">
                        <TableCell className="font-medium">{s.userName}<p className="text-[10px] text-muted-foreground">{deptLabel(s.user.department)}</p></TableCell>
                        <TableCell className="text-center">{s.SICK}</TableCell>
                        <TableCell className="text-center">{s.BUSINESS}</TableCell>
                        <TableCell className="text-center font-semibold text-primary">{s.TOTAL}</TableCell>
                        <TableCell className="text-center font-bold text-destructive bg-destructive/5">{s.ABSENT}</TableCell>
                        <TableCell className="text-right">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4"/></Button></DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onSelect={() => { setFilters(f => ({ ...f, userId: s.userId })); setActiveTab('requests'); }}><FileText className="mr-2 h-4 w-4"/> ดูรายการใบลา</DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => setCreatingForUser(s.user)}><PlusCircle className="mr-2 h-4 w-4"/> สร้างใบลาให้</DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </TableCell>
                    </TableRow>
                    )) : <TableRow><TableCell colSpan={6} className="text-center h-24 text-muted-foreground">ไม่พบข้อมูลพนักงาน</TableCell></TableRow>}
                </TableBody>
                </Table>
            </CardContent>
            </Card>
        </TabsContent>
        <TabsContent value="requests" className="space-y-4">
            <Card>
            <CardHeader><CardTitle>คำขอลาทั้งหมด</CardTitle></CardHeader>
            <CardContent>
                <div className="flex flex-wrap gap-4 mb-6">
                <div className="flex flex-col gap-1.5 flex-1 min-w-[100px] max-w-[120px]"><Label className="text-xs">ปี</Label><Select value={selectedYear?.toString() || ""} onValueChange={(v) => setSelectedYear(Number(v))}><SelectTrigger><SelectValue placeholder="..." /></SelectTrigger><SelectContent>{yearOptions.map(y => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}</SelectContent></Select></div>
                <div className="flex flex-col gap-1.5 flex-1 min-w-[150px]"><Label className="text-xs">สถานะ</Label><Select value={filters.status} onValueChange={(v) => setFilters(f => ({...f, status: v}))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">ทุกสถานะ</SelectItem>{LEAVE_STATUSES.map(s=><SelectItem key={s} value={s}>{leaveStatusLabel(s)}</SelectItem>)}</SelectContent></Select></div>
                <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]"><Label className="text-xs">พนักงาน</Label><Select value={filters.userId} onValueChange={(v) => setFilters(f => ({...f, userId: v}))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">พนักงานทั้งหมด</SelectItem>{users?.map(u=><SelectItem key={u.id} value={u.id}>{u.displayName}</SelectItem>)}</SelectContent></Select></div>
                </div>
                <Table>
                <TableHeader><TableRow><TableHead>พนักงาน</TableHead><TableHead>ประเภท</TableHead><TableHead>วันที่ลา</TableHead><TableHead className="text-center">จำนวนวัน</TableHead><TableHead>สถานะ</TableHead><TableHead className="min-w-[100px]">เอกสาร</TableHead><TableHead className="text-right">จัดการ</TableHead></TableRow></TableHeader>
                <TableBody>{filteredLeaves.length > 0 ? filteredLeaves.map(leave => (
                    <TableRow key={leave.id}><TableCell className="font-medium">{leave.userName}</TableCell><TableCell>{leaveTypeLabel(leave.leaveType)}{leave.isHalfDay && <Badge variant="outline" className="ml-2 text-[9px] h-4">0.5 วัน</Badge>}</TableCell><TableCell className="text-sm">{dfFormat(parseISO(leave.startDate), 'dd/MM/yy')} {!leave.isHalfDay && leave.endDate !== leave.startDate && ` - ${dfFormat(parseISO(leave.endDate), 'dd/MM/yy')}`}</TableCell><TableCell className="text-center">{leave.days}</TableCell><TableCell><Badge variant={leave.status === 'APPROVED' ? 'default' : leave.status === 'REJECTED' ? 'destructive' : 'secondary'}>{leaveStatusLabel(leave.status)}</Badge></TableCell>
                        <TableCell className="text-xs">
                          {leave.attachmentUrls && leave.attachmentUrls.length > 0 ? (
                            <div className="flex flex-col gap-1">
                              {leave.attachmentUrls.map((url, i) => (
                                <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                                  <ExternalLink className="h-3 w-3 shrink-0" />รูป {i + 1}
                                </a>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => setEditingLeave(leave)}><Edit className="mr-2 h-4 w-4" />แก้ไข</DropdownMenuItem>
                                <DropdownMenuSeparator/><DropdownMenuItem onSelect={() => setApprovingLeave(leave)} disabled={leave.status !== 'SUBMITTED'}><CheckCircle className="mr-2 h-4 w-4 text-green-600" />อนุมัติ</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setRejectingLeave(leave)} className="text-destructive" disabled={leave.status !== 'SUBMITTED'}><XCircle className="mr-2 h-4 w-4" />ไม่อนุมัติ</DropdownMenuItem>
                                <DropdownMenuSeparator /><DropdownMenuItem className="text-destructive" onSelect={() => setDeletingLeave(leave)}><Trash2 className="mr-2 h-4 w-4" />ลบ</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                    </TableRow>
                    )) : <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">ไม่พบคำขอ</TableCell></TableRow>}</TableBody>
                </Table>
            </CardContent>
            </Card>
        </TabsContent>
        
        {(editingLeave || creatingForUser) && (
            <LeaveManageDialog 
                leave={editingLeave} targetUser={creatingForUser}
                isOpen={!!editingLeave || !!creatingForUser} onClose={() => { setEditingLeave(null); setCreatingForUser(null); }} 
                onConfirm={handleAdminManageSave} isSubmitting={isSubmitting} 
            />
        )}

        <AlertDialog open={!!approvingLeave} onOpenChange={(open) => !open && setApprovingLeave(null)}>
            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>ยืนยันการอนุมัติ</AlertDialogTitle><AlertDialogDescription className="space-y-2">ต้องการอนุมัติใบลาของ <span className="font-bold">{approvingLeave?.userName}</span> หรือไม่?
            {approvingLeave?.attachmentUrls && approvingLeave.attachmentUrls.length > 0 && (
              <span className="block pt-2 text-foreground">
                <span className="font-medium">เอกสารแนบ:</span>
                <span className="flex flex-col gap-1 mt-1">
                  {approvingLeave.attachmentUrls.map((url, i) => (
                    <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1 w-fit">
                      <ExternalLink className="h-3.5 w-3.5" /> เปิดรูป {i + 1}
                    </a>
                  ))}
                </span>
              </span>
            )}
            </AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>ยกเลิก</AlertDialogCancel><AlertDialogAction onClick={handleApprove}>ยืนยัน</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
        </AlertDialog>
        
        <Dialog open={!!rejectingLeave} onOpenChange={(open) => !open && setRejectingLeave(null)}>
            <DialogContent><DialogHeader><DialogTitle>เหตุผลที่ไม่อนุมัติ</DialogTitle></DialogHeader><div className="py-4"><Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="ระบุรายละเอียด..."/></div>
            <DialogFooter><Button variant="outline" onClick={() => setRejectingLeave(null)}>ยกเลิก</Button><Button variant="destructive" onClick={handleReject} disabled={!rejectReason}>ยืนยันไม่อนุมัติ</Button></DialogFooter></DialogContent>
        </Dialog>
        </Tabs>
    </>
  );
}
