
"use client";

import { useMemo } from "react";
import type { PayslipSnapshot, PayType, UserProfile } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Trash2, AlertCircle, Clock, Calculator } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  calcTotals,
  displayDeductionName,
  monthLeaveDays,
  leaveDaysFrom,
  otherDeductions,
  ssoDeductionAmount,
  whtDeductionAmount,
} from "@/lib/payroll/payslip-display";
import { round2 } from "@/lib/payroll/sso";

export { calcTotals };

const formatCurrency = (value: number | undefined) => (value ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const safeParseFloat = (value: any): number => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const num = parseFloat(value);
        return isNaN(num) ? 0 : num;
    }
    return 0;
};

interface PayslipSlipViewProps {
  userName: string;
  periodLabel: string;
  snapshot: PayslipSnapshot;
  otherPeriodSnapshot?: PayslipSnapshot | null;
  currentPeriodNo?: number;
  userProfile?: UserProfile;
  mode: "read" | "edit";
  payType?: PayType;
  onChange?: (nextSnapshot: PayslipSnapshot) => void;
  onAdjustAttendance?: () => void;
  onAdjustLeave?: () => void;
  className?: string;
}

export function PayslipSlipView({ 
  userName, 
  periodLabel, 
  snapshot, 
  otherPeriodSnapshot,
  currentPeriodNo = 1,
  userProfile,
  mode, 
  payType, 
  onChange, 
  onAdjustAttendance, 
  onAdjustLeave,
  className 
}: PayslipSlipViewProps) {
  const isEdit = mode === 'edit';
  const currentTotals = useMemo(() => calcTotals(snapshot), [snapshot]);
  const otherTotals = useMemo(() => calcTotals(otherPeriodSnapshot), [otherPeriodSnapshot]);

  const p1Totals = currentPeriodNo === 1 ? currentTotals : otherTotals;
  const p2Totals = currentPeriodNo === 2 ? currentTotals : otherTotals;
  const monthlyTotalNet = p1Totals.netPay + p2Totals.netPay;
  const monthlySalary =
    (userProfile?.hr?.salaryMonthly && userProfile.hr.salaryMonthly > 0)
      ? userProfile.hr.salaryMonthly
      : (p1Totals.basePay + p2Totals.basePay) || currentTotals.basePay;
  const monthLeave = monthLeaveDays(snapshot, otherPeriodSnapshot);
  const ytdLeave = leaveDaysFrom(snapshot.leaveSummaryYtd);
  const ssoAmt = ssoDeductionAmount(snapshot);
  const whtAmt = whtDeductionAmount(snapshot);
  const extraDeductions = otherDeductions(snapshot);
  const p1Known = currentPeriodNo === 1 || !!otherPeriodSnapshot;
  const p2Known = currentPeriodNo === 2 || !!otherPeriodSnapshot;

  const handleFieldChange = (field: string, value: any) => {
    if (!onChange) return;
    const newSnapshot: PayslipSnapshot = JSON.parse(JSON.stringify(snapshot));
    const parts = field.split('.');
    if (parts.length === 3) {
        const [arrayName, indexStr, propName] = parts as ['additions' | 'deductions', string, 'name' | 'amount' | 'notes'];
        const index = parseInt(indexStr, 10);
        if (!newSnapshot[arrayName]) newSnapshot[arrayName] = [];
        if (!newSnapshot[arrayName]![index]) newSnapshot[arrayName]![index] = {name:'',amount:0, notes:''};
        (newSnapshot[arrayName]![index] as any)[propName] = value;
    } else {
        (newSnapshot as any)[field] = value;
    }
    onChange(newSnapshot);
  };
  
  const handleAddRow = (type: 'additions' | 'deductions') => {
    if (!onChange) return;
    const newSnapshot = { ...snapshot };
    newSnapshot[type] = [...(newSnapshot[type] || []), {name: '', amount: 0, notes: ''}];
    onChange(newSnapshot);
  }

  const handleRemoveRow = (type: 'additions' | 'deductions', index: number) => {
     if (!onChange) return;
     const newSnapshot = { ...snapshot };
     if (newSnapshot[type]) {
        newSnapshot[type] = newSnapshot[type]!.filter((_, i) => i !== index);
        onChange(newSnapshot);
     }
  }

  return (
    <div className={cn("space-y-6 pb-8", className)}>
        <div className="text-center">
            <h2 className="text-2xl font-bold text-primary">{userName}</h2>
            <p className="text-muted-foreground">{periodLabel}</p>
        </div>

        {snapshot.attendanceSummary?.warnings && snapshot.attendanceSummary.warnings.length > 0 && (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription><ul className="list-disc pl-4 text-xs">{snapshot.attendanceSummary.warnings.map((warn, i) => <li key={i}>{warn}</li>)}</ul></AlertDescription>
            </Alert>
        )}

        <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-2"><CardTitle className="text-xs font-bold uppercase flex items-center gap-2"><Calculator className="h-3 w-3"/> สรุปรายเดือน</CardTitle></CardHeader>
            <CardContent>
                <div className="flex justify-between items-end border-b border-dashed pb-3 mb-3">
                    <div><p className="text-[10px] text-muted-foreground uppercase">เงินเดือนทั้งเดือน</p><p className="text-xl font-bold text-primary">฿{formatCurrency(monthlySalary)}</p></div>
                    <div className="text-right"><p className="text-[10px] text-muted-foreground uppercase">ยอดรับสุทธิเดือนนี้</p><p className="text-xl font-bold text-green-600">฿{formatCurrency(monthlyTotalNet)}</p></div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-[11px]">
                    <div className="p-2 bg-background rounded border">
                        <p className="text-muted-foreground mb-1">รับจริงงวด 1 (1-15)</p>
                        <p className="font-bold">{p1Known ? formatCurrency(p1Totals.netPay) : "ยังไม่มีสลิป"}</p>
                    </div>
                    <div className="p-2 bg-background rounded border">
                        <p className="text-muted-foreground mb-1">รับจริงงวด 2 (16-สิ้นเดือน)</p>
                        <p className="font-bold">{p2Known ? formatCurrency(p2Totals.netPay) : "ยังไม่มีสลิป"}</p>
                    </div>
                </div>
            </CardContent>
        </Card>

        <Card>
            <CardHeader className="bg-muted/30 py-3"><CardTitle className="text-sm">รายละเอียดรายได้และรายการหัก (งวดนี้)</CardTitle></CardHeader>
            <CardContent className="space-y-4 pt-4">
                <div className="flex justify-between items-center">
                    <Label className="text-sm">ฐานเงินเดือน/ค่าแรงงวดนี้</Label>
                    {isEdit ? (
                        <Input type="number" step="0.01" className="w-32 text-right font-bold" value={snapshot?.basePay || ''} onChange={(e) => handleFieldChange('basePay', round2(safeParseFloat(e.target.value)))}/>
                    ) : (
                         <span className="font-bold">{formatCurrency(currentTotals.basePay)}</span>
                    )}
                </div>
                <Separator />
                <div className="space-y-2">
                    <div className="flex justify-between items-center"><h4 className="text-xs font-bold text-green-600 uppercase">รายรับเพิ่ม</h4>{isEdit && <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => handleAddRow('additions')}>+ เพิ่ม</Button>}</div>
                    {isEdit ? (
                        snapshot.additions?.map((item, i) => (
                            <div key={i} className="flex gap-2 mb-2"><Input placeholder="รายการ" value={item.name} onChange={e=>handleFieldChange(`additions.${i}.name`, e.target.value)} /><Input type="number" step="0.01" className="w-24 text-right" value={item.amount || ''} onChange={e=>handleFieldChange(`additions.${i}.amount`, round2(safeParseFloat(e.target.value)))} /><Button variant="ghost" size="icon" onClick={()=>handleRemoveRow('additions', i)}><Trash2 className="h-4 w-4"/></Button></div>
                        ))
                    ) : (snapshot.additions?.map((item, i)=><div key={i} className="flex justify-between text-xs py-1 border-b border-dashed"><p>{item.name}</p><p className="text-green-600 font-bold">+{formatCurrency(item.amount)}</p></div>))}
                </div>
                <div className="space-y-2">
                    <div className="flex justify-between items-center"><h4 className="text-xs font-bold text-destructive uppercase">รายการหัก</h4>{isEdit && <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => handleAddRow('deductions')}>+ เพิ่ม</Button>}</div>
                    {isEdit ? (
                        snapshot.deductions?.map((item, i) => (
                            <div key={i} className="flex gap-2 mb-2"><Input placeholder="รายการ" value={item.name} onChange={e=>handleFieldChange(`deductions.${i}.name`, e.target.value)} /><Input type="number" step="0.01" className="w-24 text-right" value={item.amount || ''} onChange={e=>handleFieldChange(`deductions.${i}.amount`, round2(safeParseFloat(e.target.value)))} /><Button variant="ghost" size="icon" onClick={()=>handleRemoveRow('deductions', i)}><Trash2 className="h-4 w-4"/></Button></div>
                        ))
                    ) : (
                        <>
                            <div className="flex justify-between text-xs py-1 border-b border-dashed"><p>ประกันสังคม</p><p className="text-destructive font-bold">-{formatCurrency(ssoAmt)}</p></div>
                            <div className="flex justify-between text-xs py-1 border-b border-dashed"><p>ภาษีหัก ณ ที่จ่าย</p><p className="text-destructive font-bold">-{formatCurrency(whtAmt)}</p></div>
                            {extraDeductions.map((item, i)=><div key={i} className="flex justify-between text-xs py-1 border-b border-dashed"><p>{displayDeductionName(item.name)}</p><p className="text-destructive font-bold">-{formatCurrency(item.amount)}</p></div>)}
                        </>
                    )}
                </div>
                <div className="bg-primary/5 p-3 rounded-lg border border-primary/10 flex justify-between items-center font-bold">
                    <span className="text-sm">ยอดสุทธิที่ได้รับจริง</span>
                    <span className="text-lg text-primary">฿{formatCurrency(currentTotals.netPay)}</span>
                </div>
            </CardContent>
        </Card>

        <Card className="border-dashed">
            <CardHeader className="py-2"><CardTitle className="text-xs text-muted-foreground">สรุปวันลา</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-[11px] pb-3">
                <div className="rounded border p-2 space-y-1">
                    <p className="font-bold text-foreground">ภายในเดือน</p>
                    <div className="flex justify-between"><span>ลาป่วย</span><span>{monthLeave.sickDays} วัน</span></div>
                    <div className="flex justify-between"><span>ลากิจ</span><span>{monthLeave.businessDays} วัน</span></div>
                    <div className="flex justify-between"><span>พักร้อน</span><span>{monthLeave.vacationDays} วัน</span></div>
                    <div className="flex justify-between font-bold border-t pt-1"><span>รวม</span><span>{monthLeave.total} วัน</span></div>
                </div>
                <div className="rounded border p-2 space-y-1">
                    <p className="font-bold text-foreground">สะสมปีนี้</p>
                    <div className="flex justify-between"><span>ลาป่วย</span><span>{ytdLeave.sickDays} วัน</span></div>
                    <div className="flex justify-between"><span>ลากิจ</span><span>{ytdLeave.businessDays} วัน</span></div>
                    <div className="flex justify-between"><span>พักร้อน</span><span>{ytdLeave.vacationDays} วัน</span></div>
                    <div className="flex justify-between font-bold border-t pt-1"><span>รวม</span><span>{ytdLeave.total} วัน</span></div>
                </div>
            </CardContent>
        </Card>

        <Card className="border-dashed"><CardHeader className="py-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-2"><Clock className="h-3 w-3"/> สาย ขาด ลา (งวดนี้)</CardTitle></CardHeader>
            <CardContent className="space-y-1">
                {snapshot.attendanceSummary?.dayLogs?.map((log, i) => (
                    <div key={i} className="flex justify-between text-[10px] py-1 border-b last:border-0 border-dashed">
                        <span><Badge variant="outline" className="h-3 text-[8px] px-1 mr-2">{log.type}</Badge>{log.date}</span>
                        <span className="text-muted-foreground">{log.detail}</span>
                    </div>
                )) || <p className="text-center py-4 text-xs text-muted-foreground">ไม่มีรายการ</p>}
            </CardContent>
        </Card>

        {isEdit && (
            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase text-amber-600">หมายเหตุจาก HR (แสดงในสลิป)</Label>
                <Textarea className="text-xs" placeholder="ระบุเหตุผลการคำนวณ..." value={snapshot.calcNotes || ''} onChange={e=>handleFieldChange('calcNotes', e.target.value)} />
            </div>
        )}
    </div>
  );
}
