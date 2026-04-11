import {
  format,
  eachDayOfInterval,
  isWithinInterval,
  isSaturday,
  isSunday,
  isAfter,
  isBefore,
  differenceInMinutes,
  set,
  startOfDay,
  endOfDay,
  parseISO,
} from 'date-fns';
import type {
  UserProfile,
  PayType,
  HRSettings,
  LeaveRequest,
  Attendance,
  AttendanceAdjustment,
  PayslipSnapshot,
  PayslipDeduction,
  LeaveType as TLeaveType,
  AttendanceDayLog
} from '@/lib/types';
import { WithId } from '@/firebase/firestore/use-collection';

export type PeriodMetrics = {
  attendanceSummary: {
    scheduledWorkDays: number;
    presentDays: number;
    lateDays: number;
    lateMinutes: number;
    absentUnits: number;
    leaveDays: number;
    payableUnits: number;
    warnings: string[];
    dayLogs: AttendanceDayLog[];
  };
  leaveSummary: {
    sickDays: number;
    businessDays: number;
    vacationDays: number;
    overLimitDays: number;
  };
  autoDeductions: PayslipDeduction[];
  calcNotes: string;
};

export function computePeriodMetrics(params: {
  user: WithId<UserProfile>;
  payType: PayType;
  period: { start: Date; end: Date };
  hrSettings: HRSettings;
  holidays: Map<string, string>; // yyyy-mm-dd -> name
  userLeavesApprovedYear: LeaveRequest[]; // year approved (already fetched)
  userAttendance: Attendance[]; // in period
  userAdjustments: AttendanceAdjustment[]; // in period
  today: Date;
}): PeriodMetrics {
  const {
    user,
    payType,
    period,
    hrSettings,
    holidays,
    userLeavesApprovedYear,
    userAttendance,
    userAdjustments,
    today,
  } = params;

  let dayLogs: AttendanceDayLog[] = [];
  let attendanceSummary = { scheduledWorkDays: 0, presentDays: 0, lateDays: 0, lateMinutes: 0, absentUnits: 0, leaveDays: 0, payableUnits: 0, warnings: [] as string[], dayLogs };
  let leaveSummary = { sickDays: 0, businessDays: 0, vacationDays: 0, overLimitDays: 0 };
  let calcNotes = '';
  let autoDeductions: PayslipDeduction[] = [];

  /** พนักงานค่าแรงรายวัน: วันลาไม่นับเป็นวันจ่ายค่าจ้าง (ไม่ใช้สิทธิ์ลาแบบพนักงานเงินเดือน) */
  const isDailyPay = payType === 'DAILY';

  const periodDays = eachDayOfInterval({ start: period.start, end: Math.min(period.end.getTime(), today.getTime()) as any });
  const weekendMode = hrSettings.weekendPolicy?.mode || 'SAT_SUN';
  const [workStartHour, workStartMinute] = (hrSettings.workStart || '08:00').split(':').map(Number);
  const graceMinutes = hrSettings.graceMinutes || 0;
  const [absentCutoffHour, absentCutoffMinute] = (hrSettings.absentCutoffTime || '09:00').split(':').map(Number);
  
  const userStartDate = user.hr?.startDate ? parseISO(user.hr.startDate) : null;
  const userEndDate = user.hr?.endDate ? parseISO(user.hr.endDate) : null;

  let scheduledWorkDays = 0;
  let tempPayableUnits = 0;

  periodDays.forEach(day => {
    if (userStartDate && isBefore(day, userStartDate)) return;
    if (userEndDate && isAfter(day, userEndDate)) return;

    const dayStr = format(day, 'yyyy-MM-dd');
    if (holidays.has(dayStr)) return;

    const isWeekendDay = (weekendMode === 'SAT_SUN' && (isSaturday(day) || isSunday(day))) || (weekendMode === 'SUN_ONLY' && isSunday(day));
    if (isWeekendDay) return;

    scheduledWorkDays++;

    const onLeave = userLeavesApprovedYear.find(l => isWithinInterval(day, { start: parseISO(l.startDate), end: parseISO(l.endDate) }));
    
    let leaveUnits = 0;
    if (onLeave) {
        if (onLeave.isHalfDay && onLeave.startDate === onLeave.endDate && dayStr === onLeave.startDate) {
            leaveUnits = 0.5;
        } else {
            leaveUnits = 1;
        }
        
        attendanceSummary.leaveDays += leaveUnits;
        if (onLeave.leaveType === 'SICK') leaveSummary.sickDays += leaveUnits;
        if (onLeave.leaveType === 'BUSINESS') leaveSummary.businessDays += leaveUnits;
        if (onLeave.leaveType === 'VACATION') leaveSummary.vacationDays += leaveUnits;
        
        dayLogs.push({
            date: dayStr,
            type: 'LEAVE',
            detail: `ลา${onLeave.leaveType === 'SICK' ? 'ป่วย' : onLeave.leaveType === 'BUSINESS' ? 'กิจ' : 'พักร้อน'}${onLeave.isHalfDay ? ` (ครึ่ง${onLeave.halfDaySession === 'MORNING' ? 'เช้า' : 'บ่าย'})` : ''}: ${onLeave.reason || '-'}`
        });
        
        if (leaveUnits === 1) {
            // พนักงานเงินเดือน: วันลาเต็มวันยังนับเป็นวันจ่ายตามสิทธิ์ — รายวันไม่จ่ายค่าแรงวันลา
            if (!isDailyPay) {
                tempPayableUnits += 1;
            }
            return; // Full day leave covered, move to next day
        }
    }

    if (payType === 'MONTHLY' || payType === 'DAILY') {
        const adjustmentForDay = userAdjustments.find(a => a.date === dayStr);
        const attendanceForDay = userAttendance.filter(a => a.timestamp && format(a.timestamp.toDate(), 'yyyy-MM-dd') === dayStr);
        
        let firstIn = attendanceForDay.filter(a => a.type === 'IN').map(a => a.timestamp.toDate()).sort((a,b) => a.getTime() - b.getTime())[0] ?? null;
        let lastOut = attendanceForDay.filter(a => a.type === 'OUT').map(a => a.timestamp.toDate()).sort((a,b) => b.getTime() - a.getTime())[0] ?? null;

        if (adjustmentForDay?.type === 'ADD_RECORD') {
            if (adjustmentForDay.adjustedIn) firstIn = adjustmentForDay.adjustedIn.toDate();
            if (adjustmentForDay.adjustedOut) lastOut = adjustmentForDay.adjustedOut.toDate();
        }

        // รายวัน: ไม่จ่ายในส่วนที่ลา (ครึ่งวันลาไม่ได้รับค่าครึ่งวันจากการลา)
        let dayPayableUnit = isDailyPay ? 0 : leaveUnits;
        const remainingCapacity = 1 - leaveUnits;

        if (!firstIn) {
            // No clock-in
            if (remainingCapacity > 0) {
                attendanceSummary.absentUnits += remainingCapacity;
                dayLogs.push({ date: dayStr, type: 'ABSENT', detail: leaveUnits > 0 ? 'ขาดงาน (ไม่มีสแกนในส่วนที่เหลือ)' : 'ขาดงาน (ไม่มีสแกนเข้า)' });
            }
        } else {
            // Has clock-in
            const absentCutoff = set(day, { hours: absentCutoffHour, minutes: absentCutoffMinute });
            
            // If it was a morning leave, we don't apply morning cutoff to the afternoon session
            const isMorningLeave = onLeave?.isHalfDay && onLeave?.halfDaySession === 'MORNING';
            
            if (isAfter(firstIn, absentCutoff) && !isMorningLeave) {
                attendanceSummary.absentUnits += (remainingCapacity * 0.5); 
                dayPayableUnit += (remainingCapacity * 0.5);
                dayLogs.push({ date: dayStr, type: 'ABSENT', detail: 'ขาดเช้า (สแกนหลังเส้นตาย)' });
            } else {
                const lateThreshold = set(day, { hours: workStartHour, minutes: workStartMinute + graceMinutes });
                const isForgiven = adjustmentForDay?.type === 'FORGIVE_LATE';
                
                // Only mark late if they were supposed to be there in the morning
                if (!isMorningLeave && isAfter(firstIn, lateThreshold) && !isForgiven) {
                    const lateMins = differenceInMinutes(firstIn, set(day, { hours: workStartHour, minutes: workStartMinute }));
                    attendanceSummary.lateDays++;
                    attendanceSummary.lateMinutes += lateMins;
                    dayLogs.push({ date: dayStr, type: 'LATE', detail: `สาย ${lateMins} นาที (สแกน ${format(firstIn, 'HH:mm')})` });
                }
                dayPayableUnit += remainingCapacity;
            }
            
            if (!lastOut && isBefore(day, today)) {
                 attendanceSummary.warnings.push(`วันที่ ${dayStr} ไม่มีสแกนออก (OUT) กรุณาแก้ไข`);
            }
        }
        tempPayableUnits += dayPayableUnit;
    }
  });

  if (payType === 'MONTHLY_NOSCAN') {
    attendanceSummary.presentDays = Math.max(0, scheduledWorkDays - attendanceSummary.leaveDays);
  } else {
    attendanceSummary.absentUnits = Math.round(attendanceSummary.absentUnits * 2) / 2;
    attendanceSummary.presentDays = Math.max(0, scheduledWorkDays - attendanceSummary.leaveDays - Math.floor(attendanceSummary.absentUnits));
    attendanceSummary.payableUnits = tempPayableUnits;
  }
  attendanceSummary.scheduledWorkDays = scheduledWorkDays;
  attendanceSummary.dayLogs = dayLogs;

  if (isDailyPay && attendanceSummary.leaveDays > 0) {
    calcNotes += 'พนักงานค่าแรงรายวัน: วันลาที่อนุมัติไม่นับรวมค่าจ้างตามวันทำงาน\n';
  }

  // Over-limit leave calculation — เฉพาะพนักงานเงินเดือน (สิทธิ์ลาต่อปี / หักเกินโควตา)
  if (!isDailyPay) {
    (Object.keys(hrSettings.leavePolicy?.leaveTypes || {}) as TLeaveType[]).forEach(leaveType => {
        const policy = hrSettings.leavePolicy?.leaveTypes?.[leaveType];
        if (!policy?.annualEntitlement) return;

        const annualEntitlement = policy.annualEntitlement;
        const approvedLeavesOfYear = userLeavesApprovedYear.filter(l => l.leaveType === leaveType).sort((a,b) => parseISO(a.startDate).getTime() - parseISO(b.startDate).getTime());
        
        let daysTakenThisYear = 0;
        let overLimitDaysThisPeriod = 0;

        approvedLeavesOfYear.forEach(leave => {
            const leaveStart = parseISO(leave.startDate);
            const leaveEnd = parseISO(leave.endDate);

            for (let day = startOfDay(leaveStart); day <= endOfDay(leaveEnd); day.setDate(day.getDate() + 1)) {
                const dayUnits = (leave.isHalfDay && format(day, 'yyyy-MM-dd') === leave.startDate) ? 0.5 : 1;
                daysTakenThisYear += dayUnits;
                
                if (daysTakenThisYear > annualEntitlement) {
                    const overage = Math.min(dayUnits, daysTakenThisYear - annualEntitlement);
                    if (isWithinInterval(day, {start: period.start, end: period.end})) {
                        overLimitDaysThisPeriod += overage;
                    }
                }
            }
        });
        leaveSummary.overLimitDays += overLimitDaysThisPeriod;
        
        const overLimitMode = policy.overLimitHandling?.mode;
        const salary = user.hr?.salaryMonthly;

        if (overLimitDaysThisPeriod > 0 && salary && (overLimitMode === 'DEDUCT_SALARY' || overLimitMode === 'UNPAID')) {
            const baseDays = policy.overLimitHandling?.salaryDeductionBaseDays || hrSettings.payroll?.salaryDeductionBaseDays || 26;
            // FORCE INTEGER for deduction
            const deductionAmount = Math.round((salary / baseDays) * overLimitDaysThisPeriod);
            autoDeductions.push({
                name: `[AUTO] หักลาเกินสิทธิ์ (${leaveType})`,
                amount: deductionAmount,
                notes: `${overLimitDaysThisPeriod} วัน`
            });
        } else if (overLimitDaysThisPeriod > 0 && overLimitMode === 'DISALLOW') {
            calcNotes += `คำเตือน: การลา ${leaveType} เกินสิทธิ์ ${overLimitDaysThisPeriod} วัน แต่ระบบตั้งค่าไม่อนุญาตให้หักเงิน\n`;
        }
    });
  }


  // Money deductions for MONTHLY - Using integers
  if (payType === 'MONTHLY' && user.hr?.salaryMonthly) {
      const baseDays = hrSettings.payroll?.salaryDeductionBaseDays || 26;
      const ratePerDay = user.hr.salaryMonthly / baseDays;
      const ratePerMinute = (ratePerDay / 8) / 60; // Assume 8 hour work day

      if (attendanceSummary.absentUnits > 0) {
        autoDeductions.push({
            name: `[AUTO] หักขาดงาน`,
            amount: Math.round(ratePerDay * attendanceSummary.absentUnits),
            notes: `${attendanceSummary.absentUnits} หน่วย`
        });
      }
      if (attendanceSummary.lateMinutes > 0) {
        autoDeductions.push({
            name: `[AUTO] หักมาสาย`,
            amount: Math.round(ratePerMinute * attendanceSummary.lateMinutes),
            notes: `${attendanceSummary.lateMinutes} นาที`
        });
      }
  }

  return { attendanceSummary, leaveSummary, calcNotes: calcNotes.trim(), autoDeductions };
}
