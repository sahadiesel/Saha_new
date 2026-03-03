
"use client";

import { useMemo } from "react";
import type { PayslipSnapshot, PayType, UserProfile, AttendanceDayLog } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { PlusCircle, Trash2, AlertCircle, Clock, FileText, Edit, BadgeCheck, Calculator, FilePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

// --- Helper Functions - Forced Integer ---
const formatCurrency = (value: number | undefined) => (value ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const safeParseFloat = (value: any): number => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const num = parseFloat(value);
        return isNaN(num) ? 0 : num;
    }
    return 0;
};

export const calcTotals = (snapshot: PayslipSnapshot | null | undefined) => {
    if (!snapshot) return { basePay: 0, addTotal: 0, dedTotal: 0, netPay: 0 };
    const basePay = Math.round(safeParseFloat(snapshot?.basePay));
    const addTotal = Math.round((snapshot?.additions || []).reduce((sum, item) => sum + safeParseFloat(item.amount), 0));
    const dedTotal = Math.round((snapshot?.deductions || []).reduce((sum, item) => sum + safeParseFloat(item.amount), 0));
    const netPay = Math.round(basePay + addTotal - dedTotal);
    return { basePay, addTotal, dedTotal, netPay };
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
  currentPeriodNo,
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
                    <div><p className="text-[10px] text-muted-foreground uppercase">เงินเดือนรวม</p><p className="text-xl font-bold text-primary">฿{formatCurrency(userProfile?.hr?.salaryMonthly)}</p></div>
                    <div className="text-right"><p className="text-[10px] text-muted-foreground uppercase">ยอดรับสุทธิเดือนนี้</p><p className="text-xl font-bold text-green-600">฿{formatCurrency(monthlyTotalNet)}</p></div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-[11px]">
                    <div className="p-2 bg-background rounded border">
                        <p className="text-muted-foreground mb-1">งวด 1 (1-15)</p>
                        <p className="font-bold">{formatCurrency(p1Totals.netPay)}</p>
                    </div>
                    <div className="p-2 bg-background rounded border">
                        <p className="text-muted-foreground mb-1">งวด 2 (16-สิ้นเดือน)</p>
                        <p className="font-bold">{formatCurrency(p2Totals.netPay)}</p>
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
                        <Input type="number" className="w-32 text-right font-bold" value={snapshot?.basePay || ''} onChange={(e) => handleFieldChange('basePay', Math.round(safeParseFloat(e.target.value)))}/>
                    ) : (
                         <span className="font-bold">{formatCurrency(currentTotals.basePay)}</span>
                    )}
                </div>
                <Separator />
                <div className="space-y-2">
                    <div className="flex justify-between items-center"><h4 className="text-xs font-bold text-green-600 uppercase">รายรับเพิ่ม</h4>{isEdit && <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => handleAddRow('additions')}>+ เพิ่ม</Button>}</div>
                    {isEdit ? (
                        snapshot.additions?.map((item, i) => (
                            <div key={i} className="flex gap-2 mb-2"><Input placeholder="รายการ" value={item.name} onChange={e=>handleFieldChange(`additions.${i}.name`, e.target.value)} /><Input type="number" className="w-24 text-right" value={item.amount || ''} onChange={e=>handleFieldChange(`additions.${i}.amount`, Math.round(safeParseFloat(e.target.value)))} /><Button variant="ghost" size="icon" onClick={()=>handleRemoveRow('additions', i)}><Trash2 className="h-4 w-4"/></Button></div>
                        ))
                    ) : (snapshot.additions?.map((item, i)=><div key={i} className="flex justify-between text-xs py-1 border-b border-dashed"><p>{item.name}</p><p className="text-green-600 font-bold">+{formatCurrency(item.amount)}</p></div>))}
                </div>
                <div className="space-y-2">
                    <div className="flex justify-between items-center"><h4 className="text-xs font-bold text-destructive uppercase">รายการหัก</h4>{isEdit && <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => handleAddRow('deductions')}>+ เพิ่ม</Button>}</div>
                    {isEdit ? (
                        snapshot.deductions?.map((item, i) => (
                            <div key={i} className="flex gap-2 mb-2"><Input placeholder="รายการ" value={item.name} onChange={e=>handleFieldChange(`deductions.${i}.name`, e.target.value)} /><Input type="number" className="w-24 text-right" value={item.amount || ''} onChange={e=>handleFieldChange(`deductions.${i}.amount`, Math.round(safeParseFloat(e.target.value)))} /><Button variant="ghost" size="icon" onClick={()=>handleRemoveRow('deductions', i)}><Trash2 className="h-4 w-4"/></Button></div>
                        ))
                    ) : (snapshot.deductions?.map((item, i)=><div key={i} className="flex justify-between text-xs py-1 border-b border-dashed"><p>{item.name}</p><p className="text-destructive font-bold">-{formatCurrency(item.amount)}</p></div>))}
                </div>
                <div className="bg-primary/5 p-3 rounded-lg border border-primary/10 flex justify-between items-center font-bold">
                    <span className="text-sm">ยอดสุทธิที่ได้รับจริง</span>
                    <span className="text-lg text-primary">฿{formatCurrency(currentTotals.netPay)}</span>
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
