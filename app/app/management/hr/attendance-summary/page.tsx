"use client";

import { useState, useMemo, useEffect, useCallback, Fragment } from "react";
import { doc, collection, query, where, orderBy, getDocs, getDoc, Timestamp } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import {
  format as dfFormat,
  isWithinInterval,
  isSaturday,
  isSunday,
  subMonths,
  addMonths,
  parseISO,
  differenceInMinutes,
  set,
  isBefore,
  isAfter,
  startOfToday,
  eachDayOfInterval,
  startOfMonth,
  endOfMonth,
} from 'date-fns';
import { safeFormat } from '@/lib/date-utils';

import type { UserProfile, Attendance, LeaveRequest, HRHoliday as HRHolidayType, HRSettings, AttendanceAdjustment, UserStatus } from "@/lib/types";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, AlertCircle, Edit, CalendarDays, ExternalLink, Search, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AttendanceAdjustmentDialog } from "@/components/attendance-adjustment-dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { WithId } from "@/firebase/firestore/use-collection";

interface AttendanceDailySummary {
  date: Date;
  status: 'PRESENT' | 'LATE' | 'ABSENT' | 'LEAVE' | 'HOLIDAY' | 'WEEKEND' | 'NO_DATA' | 'NOT_STARTED' | 'ENDED' | 'SUSPENDED' | 'FUTURE';
  workHours?: string;
  lateMinutes?: number;
  rawIn?: Date | null;
  rawOut?: Date | null;
  adjustment?: WithId<AttendanceAdjustment>;
  leaveType?: string;
}

interface AttendanceMonthlySummary {
  userId: string;
  userName: string;
  totalPresent: number;
  totalLate: number;
  totalAbsent: number;
  totalLeave: number;
  totalLateMinutes: number;
  dailySummaries: AttendanceDailySummary[];
  reviewNeeded: boolean;
  startDate?: string | null;
  endDate?: string | null;
  status: UserStatus;
}

export default function ManagementHRAttendanceSummaryPage() {
  const { db } = useFirebase();
  const { toast } = useToast();
  
  // FIXED: Initialize currentMonth to null to prevent hydration mismatch
  const [currentMonth, setCurrentMonth] = useState<Date | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  
  const [summaryData, setSummaryData] = useState<AttendanceMonthlySummary[]>([]);
  const [allUsers, setAllUsers] = useState<WithId<UserProfile>[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<any>(null);
  const [indexCreationUrl, setIndexCreationUrl] = useState<string | null>(null);
  const [openUserIds, setOpenUserIds] = useState<Set<string>>(new Set());
  const [adjustingDayInfo, setAdjustingDayInfo] = useState<{ user: WithId<UserProfile>, day: AttendanceDailySummary } | null>(null);

  // Set initial date on client only
  useEffect(() => {
    setCurrentMonth(startOfMonth(new Date()));
  }, []);

  const toggleOpen = (userId: string) => {
    setOpenUserIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const calculateSummary = useCallback((
    users: WithId<UserProfile>[],
    hrSettings: HRSettings,
    holidays: HRHolidayType[],
    yearLeaves: LeaveRequest[],
    monthAttendance: Attendance[],
    monthAdjustments: WithId<AttendanceAdjustment>[],
    dateRange: { from: Date, to: Date }
  ): AttendanceMonthlySummary[] => {
      
    const today = startOfToday();
    const now = new Date();
    const approvedLeaves = yearLeaves.filter(l => l.status === 'APPROVED');
    const daysInMonth = eachDayOfInterval({ start: dateRange.from, end: dateRange.to });
    const holidaysMap = new Map(holidays.map(h => [h.date, h.name]));
    const [workStartHour, workStartMinute] = (hrSettings.workStart || '08:00').split(':').map(Number);
    const [workEndHour, workEndMinute] = (hrSettings.workEnd || '17:00').split(':').map(Number);
    const graceMinutes = hrSettings.graceMinutes || 0;
    const weekendMode = hrSettings.weekendPolicy?.mode || 'SAT_SUN';

    return users.map(user => {
      const userLeaves = approvedLeaves.filter(l => l.userId === user.id);
      const userAttendance = monthAttendance.filter(a => a.userId === user.id);
      const userAdjustments = monthAdjustments.filter(a => a.userId === user.id);
      
      let totalPresent = 0, totalLate = 0, totalAbsent = 0, totalLeave = 0, totalLateMinutes = 0, reviewNeeded = false;
      const startDate = user.hr?.startDate ? parseISO(user.hr.startDate) : null;
      const endDate = user.hr?.endDate ? parseISO(user.hr.endDate) : null;

      const dailySummaries: AttendanceDailySummary[] = daysInMonth.map(day => {
        const dayStr = dfFormat(day, 'yyyy-MM-dd');
        const isToday = dayStr === dfFormat(now, 'yyyy-MM-dd');
        let daily: AttendanceDailySummary = { date: day, status: 'NO_DATA' };
        
        if (isAfter(day, today)) {
          daily.status = 'FUTURE';
          return daily;
        }

        if (startDate && isBefore(day, startDate)) {
          daily.status = 'NOT_STARTED';
          return daily;
        }

        if (endDate && isAfter(day, endDate)) {
          daily.status = 'ENDED';
          return daily;
        }
        
        if (user.status === 'SUSPENDED') {
          daily.status = 'SUSPENDED';
          return daily;
        }

        if (holidaysMap.has(dayStr)) {
          daily.status = 'HOLIDAY';
          return daily;
        }

        const isWeekendDay = (weekendMode === 'SAT_SUN' && (isSaturday(day) || isSunday(day))) || (weekendMode === 'SUN_ONLY' && isSunday(day));
        if (isWeekendDay) {
            daily.status = 'WEEKEND';
            return daily;
        }

        const onLeave = userLeaves.find(l => isWithinInterval(day, { start: parseISO(l.startDate), end: parseISO(l.endDate) }));
        if (onLeave) {
          totalLeave += 1;
          daily.status = 'LEAVE';
          daily.leaveType = onLeave.leaveType;
          return daily;
        }

        const adjustmentForDay = userAdjustments.find(a => a.date === dayStr);
        daily.adjustment = adjustmentForDay;

        const attendanceForDay = userAttendance.filter(a => {
            if (!a.timestamp || !(a.timestamp instanceof Timestamp)) return false;
            return dfFormat(a.timestamp.toDate(), 'yyyy-MM-dd') === dayStr;
        });
        
        const rawIns = attendanceForDay.filter(a => a.type === 'IN' && a.timestamp instanceof Timestamp).map(a => a.timestamp.toDate()).sort((a,b) => a.getTime() - b.getTime());
        const rawOuts = attendanceForDay.filter(a => a.type === 'OUT' && a.timestamp instanceof Timestamp).map(a => a.timestamp.toDate()).sort((a,b) => b.getTime() - a.getTime());

        let firstIn = rawIns[0] ?? null;
        let lastOut = rawOuts[rawOuts.length-1] ?? null;

        if (adjustmentForDay?.type === 'ADD_RECORD') {
          if (adjustmentForDay.adjustedIn) firstIn = adjustmentForDay.adjustedIn.toDate();
          if (adjustmentForDay.adjustedOut) lastOut = adjustmentForDay.adjustedOut.toDate();
        }
        daily.rawIn = firstIn;
        daily.rawOut = lastOut;

        if (!firstIn) {
          if (!isToday) {
            totalAbsent += 1;
            daily.status = 'ABSENT';
          } else {
            const absentTriggerTime = set(now, { hours: 23, minutes: 50, seconds: 0 });
            if (isAfter(now, absentTriggerTime)) {
              totalAbsent += 1;
              daily.status = 'ABSENT';
            } else {
              daily.status = 'NO_DATA'; 
            }
          }
          return daily;
        }
        
        if (!lastOut) {
          reviewNeeded = true;
          daily.status = 'NO_DATA';
          return daily;
        }

        const workStartTimeWithGrace = set(day, { hours: workStartHour, minutes: workStartMinute + graceMinutes });
        let lateMins = differenceInMinutes(firstIn, workStartTimeWithGrace);
        if (lateMins < 0) lateMins = 0;

        if (adjustmentForDay?.type === 'FORGIVE_LATE') lateMins = 0;

        if (lateMins > 0) {
          daily.status = 'LATE';
          daily.lateMinutes = lateMins;
          totalLate += 1;
          totalLateMinutes += lateMins;
        } else {
          daily.status = 'PRESENT';
          totalPresent += 1;
        }
        
        const workMins = differenceInMinutes(lastOut, firstIn);
        daily.workHours = `${Math.floor(workMins/60)}h ${workMins % 60}m`;
        
        return daily;
      });

      return {
        userId: user.id, userName: user.displayName,
        status: user.status,
        startDate: user.hr?.startDate,
        endDate: user.hr?.endDate,
        totalPresent, totalLate, totalAbsent, totalLeave, totalLateMinutes,
        dailySummaries, reviewNeeded
      };
    });
  }, []);
  
  const fetchData = useCallback(async () => {
      if (!db || !currentMonth) return;
      setIsLoading(true);
      setError(null);
      setIndexCreationUrl(null);

      try {
          const dateRange = { from: startOfMonth(currentMonth), to: endOfMonth(currentMonth) };
          const year = currentMonth.getFullYear();
          const startStr = dfFormat(dateRange.from, 'yyyy-MM-dd');
          const nextMonthStart = startOfMonth(addMonths(currentMonth, 1));
          
          const usersQuery = query(collection(db, 'users'), orderBy('displayName','asc'));
          const settingsDocRef = doc(db, 'settings', 'hr');
          const holidaysQuery = query(collection(db, 'hrHolidays'), orderBy('date', 'asc'));
          const leavesQuery = query(collection(db, 'hrLeaves'), where('year', '==', year));
          const attendanceQuery = query(collection(db, 'attendance'), where('timestamp', '>=', dateRange.from), where('timestamp', '<', nextMonthStart), orderBy('timestamp', 'asc'));
          const adjustmentsQuery = query(collection(db, 'hrAttendanceAdjustments'), where('date', '>=', startStr), where('date', '<', dfFormat(nextMonthStart, 'yyyy-MM-dd')), orderBy('date', 'asc'));

          const [usersSnap, settingsSnap, holidaysSnap, leavesSnap, attendanceSnap, adjustmentsSnap] = await Promise.all([
              getDocs(usersQuery),
              getDoc(settingsDocRef),
              getDocs(holidaysQuery),
              getDocs(leavesQuery),
              getDocs(attendanceQuery),
              getDocs(adjustmentsQuery),
          ]);

          const allUsersData = usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<UserProfile>));
          setAllUsers(allUsersData);
          const monthAttendanceData: Attendance[] = attendanceSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
          const yearLeavesData: LeaveRequest[] = leavesSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
          const hrSettingsData = settingsSnap.exists() ? settingsSnap.data() as HRSettings : {};
          const allHolidaysData = holidaysSnap.docs.map(d => ({ id: d.id, name: d.data().name, date: d.data().date })).filter(h => !!h.date);
          const monthAdjustmentsData = adjustmentsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
          
          const usersToProcess = allUsersData.filter(u => u.hr?.payType && u.hr.payType !== 'NOPAY' && u.hr.payType !== 'MONTHLY_NOSCAN');
          setSummaryData(calculateSummary(usersToProcess, hrSettingsData, allHolidaysData, yearLeavesData, monthAttendanceData, monthAdjustmentsData, dateRange));
      } catch (err: any) {
          if (err.message?.includes('requires an index')) {
              const urlMatch = err.message.match(/https?:\/\/[^\s]+/);
              if (urlMatch) setIndexCreationUrl(urlMatch[0]);
          }
          setError(err);
      } finally {
          setIsLoading(false);
      }
  }, [db, currentMonth, calculateSummary]);

  useEffect(() => { fetchData(); }, [fetchData]);
  
  const filteredSummaryData = useMemo(() => {
    if (!searchQuery) return summaryData;
    return summaryData.filter(s => s.userName.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [summaryData, searchQuery]);

  const getStatusBadge = (status: AttendanceDailySummary['status'], date: Date, leaveType?: string) => {
    const isToday = dfFormat(date, 'yyyy-MM-dd') === dfFormat(new Date(), 'yyyy-MM-dd');
    
    switch (status) {
      case 'PRESENT': return <Badge variant="default">Present (ปกติ)</Badge>;
      case 'LATE': return <Badge variant="destructive">Late (สาย)</Badge>;
      case 'ABSENT': return <Badge variant="destructive">Absent (ขาดงาน)</Badge>;
      case 'LEAVE': return <Badge variant="secondary">{leaveType || 'Leave'} (ลา)</Badge>;
      case 'NO_DATA': 
        return isToday ? <Badge variant="outline" className="bg-amber-50">รอการลงเวลา</Badge> : <Badge variant="outline">No Data</Badge>;
      case 'FUTURE': return <span className="text-muted-foreground text-xs">-</span>;
      default: return <span className="text-muted-foreground text-xs">{status}</span>
    }
  };

  return (
    <>
      <PageHeader title="จัดการการลงเวลา" description="สรุปการลงเวลาทำงานรายวันของพนักงานทุกคน" />
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="w-full sm:w-auto">
              <CardTitle>Attendance Summary</CardTitle>
              <div className="relative mt-2">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search employee..." className="pl-8 w-full sm:w-[250px]" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-center">
              <Button variant="outline" onClick={() => setCurrentMonth(startOfMonth(new Date()))}><CalendarDays className="mr-2 h-4 w-4" />Today</Button>
              <Button variant="outline" size="icon" onClick={() => setCurrentMonth(prev => prev ? subMonths(prev, 1) : null)}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="font-semibold text-lg text-center w-36">{currentMonth ? dfFormat(currentMonth, 'MMMM yyyy') : '...'}</span>
              <Button variant="outline" size="icon" onClick={() => setCurrentMonth(prev => prev ? addMonths(prev, 1) : null)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading || !currentMonth ? (
            <div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>
          ) : error && !indexCreationUrl ? (
            <div className="text-center p-8 text-destructive"><AlertCircle className="h-8 w-8 mx-auto mb-2" /><p>{error.message}</p></div>
          ) : indexCreationUrl ? (
            <div className="text-center p-8"><Button asChild><a href={indexCreationUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" />สร้าง Index</a></Button></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[250px]">Employee</TableHead>
                  <TableHead className="text-right">Late</TableHead>
                  <TableHead className="text-right">Absent</TableHead>
                  <TableHead className="text-right">Leave</TableHead>
                  <TableHead className="text-right">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSummaryData.map((summary) => {
                  const isOpen = openUserIds.has(summary.userId);
                  return (
                    <Fragment key={summary.userId}>
                      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => toggleOpen(summary.userId)}>
                        <TableCell className="font-medium flex items-center gap-2">
                          <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
                          {summary.userName}
                        </TableCell>
                        <TableCell className="text-right">{summary.totalLate}</TableCell>
                        <TableCell className="text-right">{summary.totalAbsent}</TableCell>
                        <TableCell className="text-right">{summary.totalLeave}</TableCell>
                        <TableCell className="text-right">{summary.reviewNeeded && <Badge variant="destructive">Review</Badge>}</TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow>
                          <TableCell colSpan={5} className="p-0">
                            <div className="p-4 bg-muted/30 max-h-96 overflow-y-auto">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>IN</TableHead>
                                    <TableHead>OUT</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {summary.dailySummaries.map(day => (
                                    <TableRow key={day.date.toISOString()}>
                                      <TableCell>{dfFormat(day.date, 'dd/MM')}</TableCell>
                                      <TableCell>{getStatusBadge(day.status, day.date, day.leaveType)}</TableCell>
                                      <TableCell>{safeFormat(day.rawIn, 'HH:mm')}</TableCell>
                                      <TableCell>{safeFormat(day.rawOut, 'HH:mm')}</TableCell>
                                      <TableCell className="text-right">
                                        <Button variant="outline" size="icon" onClick={() => setAdjustingDayInfo({ user: allUsers.find(u => u.id === summary.userId)!, day })}>
                                          <Edit className="h-4 w-4" />
                                        </Button>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {adjustingDayInfo && (
        <AttendanceAdjustmentDialog
          isOpen={!!adjustingDayInfo}
          onOpenChange={(open) => !open && setAdjustingDayInfo(null)}
          onSaved={fetchData}
          dayInfo={adjustingDayInfo.day}
          user={adjustingDayInfo.user}
        />
      )}
    </>
  );
}
