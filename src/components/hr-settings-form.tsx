"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { doc, setDoc } from "firebase/firestore";

import { useFirebase, useDoc } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import type { HRSettings } from "@/lib/types";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save, Edit, X } from "lucide-react";
import { Skeleton } from "./ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "./ui/separator";
import { Switch } from "./ui/switch";

const leaveTypePolicySchema = z.object({
  annualEntitlement: z.coerce.number().min(0).optional(),
  overLimitHandling: z.object({
    mode: z.enum(["DEDUCT_SALARY", "UNPAID", "DISALLOW"]).optional(),
    salaryDeductionBaseDays: z.coerce.number().min(1).optional(),
  }).optional(),
});

// Zod schema for validation
const hrSettingsSchema = z.object({
  workStart: z.string().optional(),
  workEnd: z.string().optional(),
  breakStart: z.string().optional(),
  breakEnd: z.string().optional(),
  graceMinutes: z.coerce.number().min(0).optional(),
  absentCutoffTime: z.string().optional(),
  afternoonCutoffTime: z.string().optional(),
  minSecondsBetweenScans: z.coerce.number().min(0).optional(),
  weekendPolicy: z.object({
    mode: z.enum(["SAT_SUN", "SUN_ONLY"]).optional(),
  }).optional(),
  payroll: z.object({
    payday1: z.coerce.number().min(1).max(31).optional(),
    period1Start: z.coerce.number().min(1).max(31).optional(),
    period1End: z.coerce.number().min(1).max(31).optional(),
    payday2: z.string().optional(),
    period2Start: z.coerce.number().min(1).max(31).optional(),
    period2End: z.string().optional(),
    salaryDeductionBaseDays: z.coerce.number().min(1).optional(),
  }).optional(),
  sso: z.object({
    employeePercent: z.coerce.number().min(0).max(100).optional(),
    employerPercent: z.coerce.number().min(0).max(100).optional(),
    monthlyMinBase: z.coerce.number().min(0).optional(),
    monthlyCap: z.coerce.number().min(0).optional(),
  }).optional(),
  withholding: z.object({
    enabled: z.boolean().default(false),
    defaultPercent: z.coerce.number().min(0).max(100).optional(),
    note: z.string().optional(),
  }).optional(),
  leavePolicy: z.object({
    calculationPeriod: z.literal("CALENDAR_YEAR").optional(),
    leaveTypes: z.object({
      SICK: leaveTypePolicySchema.optional(),
      BUSINESS: leaveTypePolicySchema.optional(),
      VACATION: leaveTypePolicySchema.optional(),
    }).optional()
  }).optional(),
  backfillMode: z.boolean().optional(),
});

const LeavePolicyFields = ({ type, form }: { type: 'SICK' | 'BUSINESS' | 'VACATION', form: any }) => {
  const overLimitMode = form.watch(`leavePolicy.leaveTypes.${type}.overLimitHandling.mode`);
  const typeLabel = type.charAt(0) + type.slice(1).toLowerCase();

  return (
    <div>
      <h4 className="font-medium mb-2">{typeLabel} Leave</h4>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-md">
        <FormField
          control={form.control}
          name={`leavePolicy.leaveTypes.${type}.annualEntitlement`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>จำนวนวันลาต่อปี</FormLabel>
              <FormControl><Input type="number" placeholder="เช่น 30" {...field} value={field.value ?? ''} /></FormControl>
              <FormDescription>วัน/ปี</FormDescription>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name={`leavePolicy.leaveTypes.${type}.overLimitHandling.mode`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>กรณีลาเกิน</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="เลือก..." />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="DEDUCT_SALARY">หักเงินเดือน</SelectItem>
                  <SelectItem value="UNPAID">ไม่จ่ายค่าจ้าง</SelectItem>
                  <SelectItem value="DISALLOW">ไม่อนุญาต</SelectItem>
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />
        {overLimitMode === 'DEDUCT_SALARY' && (
          <FormField
            control={form.control}
            name={`leavePolicy.leaveTypes.${type}.overLimitHandling.salaryDeductionBaseDays`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>ฐานวันหักเงิน</FormLabel>
                <FormControl><Input type="number" placeholder="เช่น 26" {...field} value={field.value ?? ''} /></FormControl>
                <FormDescription>เงินเดือนจะถูกหารด้วยจำนวนวันนี้</FormDescription>
              </FormItem>
            )}
          />
        )}
      </div>
    </div>
  );
};

const InfoRow = ({ label, value }: { label: string, value: React.ReactNode }) => (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between py-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <div className="text-sm sm:text-right break-words max-w-xs">{value || '-'}</div>
    </div>
);


export function HRSettingsForm() {
  const { db } = useFirebase();
  const { toast } = useToast();
  const { profile } = useAuth();
  const [isEditing, setIsEditing] = useState(false);

  const canEditSettings = profile?.role === 'ADMIN' || profile?.department === 'ACCOUNTING_HR';

  const settingsDocRef = useMemo(() => {
    if (!db) return null;
    return doc(db, "settings", "hr");
  }, [db]);

  const { data: settings, isLoading } = useDoc<HRSettings>(settingsDocRef);

  const form = useForm<z.infer<typeof hrSettingsSchema>>({
    resolver: zodResolver(hrSettingsSchema),
    defaultValues: {
      workStart: "",
      workEnd: "",
      breakStart: "",
      breakEnd: "",
      graceMinutes: 0,
      absentCutoffTime: "",
      afternoonCutoffTime: "",
      minSecondsBetweenScans: 60,
      weekendPolicy: {
        mode: 'SAT_SUN',
      },
      payroll: {
        payday1: 15,
        period1Start: 1,
        period1End: 15,
        payday2: "EOM",
        period2Start: 16,
        period2End: "EOM",
        salaryDeductionBaseDays: 26,
      },
      sso: {
        employeePercent: 0,
        employerPercent: 0,
        monthlyMinBase: 1650,
        monthlyCap: 15000,
      },
      withholding: {
        enabled: false,
        defaultPercent: 0,
        note: "",
      },
      leavePolicy: {
        calculationPeriod: 'CALENDAR_YEAR',
        leaveTypes: {
          SICK: { annualEntitlement: 30, overLimitHandling: { mode: 'DEDUCT_SALARY', salaryDeductionBaseDays: 26 } },
          BUSINESS: { annualEntitlement: 7, overLimitHandling: { mode: 'DEDUCT_SALARY', salaryDeductionBaseDays: 26 } },
          VACATION: { annualEntitlement: 6, overLimitHandling: { mode: 'DISALLOW', salaryDeductionBaseDays: 26 } },
        }
      },
      backfillMode: false,
    },
  });

  useEffect(() => {
    if (settings) {
      const defaultValues = form.formState.defaultValues;
      form.reset({
        workStart: settings.workStart || "",
        workEnd: settings.workEnd || "",
        breakStart: settings.breakStart || "",
        breakEnd: settings.breakEnd || "",
        graceMinutes: settings.graceMinutes ?? 0,
        absentCutoffTime: settings.absentCutoffTime || "",
        afternoonCutoffTime: settings.afternoonCutoffTime || "",
        minSecondsBetweenScans: settings.minSecondsBetweenScans ?? 60,
        weekendPolicy: { ...defaultValues.weekendPolicy, ...settings.weekendPolicy },
        payroll: { ...defaultValues.payroll, ...settings.payroll },
        sso: { ...defaultValues.sso, ...settings.sso },
        withholding: { ...defaultValues.withholding, ...settings.withholding },
        leavePolicy: {
          calculationPeriod: 'CALENDAR_YEAR',
          leaveTypes: {
            SICK: {
              ...(defaultValues.leavePolicy?.leaveTypes?.SICK),
              ...(settings.leavePolicy?.leaveTypes?.SICK),
              overLimitHandling: {
                ...(defaultValues.leavePolicy?.leaveTypes?.SICK?.overLimitHandling),
                ...(settings.leavePolicy?.leaveTypes?.SICK?.overLimitHandling),
              },
            },
            BUSINESS: {
              ...(defaultValues.leavePolicy?.leaveTypes?.BUSINESS),
              ...(settings.leavePolicy?.leaveTypes?.BUSINESS),
              overLimitHandling: {
                ...(defaultValues.leavePolicy?.leaveTypes?.BUSINESS?.overLimitHandling),
                ...(settings.leavePolicy?.leaveTypes?.BUSINESS?.overLimitHandling),
              },
            },
            VACATION: {
              ...(defaultValues.leavePolicy?.leaveTypes?.VACATION),
              ...(settings.leavePolicy?.leaveTypes?.VACATION),
              overLimitHandling: {
                ...(defaultValues.leavePolicy?.leaveTypes?.VACATION?.overLimitHandling),
                ...(settings.leavePolicy?.leaveTypes?.VACATION?.overLimitHandling),
              },
            },
          }
        },
        backfillMode: settings.backfillMode ?? false,
      });
    }
  }, [settings, form]);

  const onSubmit = async (values: z.infer<typeof hrSettingsSchema>) => {
    if (!settingsDocRef) return;
    try {
      const finalValues = {
        ...values,
        leavePolicy: {
          ...values.leavePolicy,
          calculationPeriod: 'CALENDAR_YEAR'
        }
      };

      await setDoc(settingsDocRef, finalValues, { merge: true });
      toast({
        title: "บันทึกการตั้งค่าแล้ว",
        description: "การตั้งค่า HR ถูกบันทึกเรียบร้อยแล้ว",
      });
       setIsEditing(false);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "เกิดข้อผิดพลาด",
        description: error.message,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!isEditing) {
    return (
        <div className="space-y-8">
            <div className="flex justify-end sticky top-20 z-10 -mb-8">
                {canEditSettings && <Button variant="outline" onClick={() => setIsEditing(true)} className="bg-background shadow-lg"><Edit /> แก้ไข</Button>}
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>เวลาทำงานและเวลาพัก</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    <div><p className="text-sm font-medium text-muted-foreground">เวลาเข้างาน</p><p>{settings?.workStart || '-'}</p></div>
                    <div><p className="text-sm font-medium text-muted-foreground">เวลาออกงาน</p><p>{settings?.workEnd || '-'}</p></div>
                    <div><p className="text-sm font-medium text-muted-foreground">เวลาพัก (เริ่ม)</p><p>{settings?.breakStart || '-'}</p></div>
                    <div><p className="text-sm font-medium text-muted-foreground">เวลาพัก (สิ้นสุด)</p><p>{settings?.breakEnd || '-'}</p></div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>กติกาการบันทึกเวลา</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div><p className="text-sm font-medium text-muted-foreground">อนุญาตให้สาย (นาที)</p><p>{settings?.graceMinutes ?? '-'}</p></div>
                    <div><p className="text-sm font-medium text-muted-foreground">เวลาเกินนี้ถือว่าขาดเช้า</p><p>{settings?.absentCutoffTime || '-'}</p></div>
                    <div><p className="text-sm font-medium text-muted-foreground">เวลาเกินนี้ถือว่าขาดบ่าย</p><p>{settings?.afternoonCutoffTime || '-'}</p></div>
                    <div><p className="text-sm font-medium text-muted-foreground">หน่วงเวลาสแกนซ้ำ (วินาที)</p><p>{settings?.minSecondsBetweenScans ?? '-'}</p></div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>กำหนดวันหยุดประจำสัปดาห์</CardTitle>
                </CardHeader>
                <CardContent>
                    <InfoRow label="วันหยุดสุดสัปดาห์" value={settings?.weekendPolicy?.mode} />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>นโยบายการลา</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div>
                        <h4 className="font-medium mb-2">ลาป่วย</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-md">
                            <div><p className="text-sm font-medium text-muted-foreground">จำนวนวันลาต่อปี</p><p>{settings?.leavePolicy?.leaveTypes?.SICK?.annualEntitlement ?? '-'}</p></div>
                            <div><p className="text-sm font-medium text-muted-foreground">กรณีลาเกิน</p><p>{settings?.leavePolicy?.leaveTypes?.SICK?.overLimitHandling?.mode ?? '-'}</p></div>
                            <div><p className="text-sm font-medium text-muted-foreground">ฐานวันหักเงิน</p><p>{settings?.leavePolicy?.leaveTypes?.SICK?.overLimitHandling?.salaryDeductionBaseDays ?? '-'}</p></div>
                        </div>
                    </div>
                    <div>
                        <h4 className="font-medium mb-2">ลากิจ</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-md">
                           <div><p className="text-sm font-medium text-muted-foreground">จำนวนวันลาต่อปี</p><p>{settings?.leavePolicy?.leaveTypes?.BUSINESS?.annualEntitlement ?? '-'}</p></div>
                            <div><p className="text-sm font-medium text-muted-foreground">กรณีลาเกิน</p><p>{settings?.leavePolicy?.leaveTypes?.BUSINESS?.overLimitHandling?.mode ?? '-'}</p></div>
                            <div><p className="text-sm font-medium text-muted-foreground">ฐานวันหักเงิน</p><p>{settings?.leavePolicy?.leaveTypes?.BUSINESS?.overLimitHandling?.salaryDeductionBaseDays ?? '-'}</p></div>
                        </div>
                    </div>
                    <div>
                        <h4 className="font-medium mb-2">ลาพักร้อน</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-md">
                            <div><p className="text-sm font-medium text-muted-foreground">จำนวนวันลาต่อปี</p><p>{settings?.leavePolicy?.leaveTypes?.VACATION?.annualEntitlement ?? '-'}</p></div>
                            <div><p className="text-sm font-medium text-muted-foreground">กรณีลาเกิน</p><p>{settings?.leavePolicy?.leaveTypes?.VACATION?.overLimitHandling?.mode ?? '-'}</p></div>
                            <div><p className="text-sm font-medium text-muted-foreground">ฐานวันหักเงิน</p><p>{settings?.leavePolicy?.leaveTypes?.VACATION?.overLimitHandling?.salaryDeductionBaseDays ?? '-'}</p></div>
                        </div>
                    </div>
                </CardContent>
            </Card>

             <Card>
                <CardHeader><CardTitle>รอบจ่ายเงินเดือน</CardTitle></CardHeader>
                <CardContent className="space-y-6">
                    <div>
                      <h4 className="font-medium mb-2">ทั่วไป</h4>
                      <div className="grid grid-cols-3 gap-4 p-4 border rounded-md">
                        <div><p className="text-sm font-medium text-muted-foreground">ฐานวันหักเงินเดือน</p><p>{settings?.payroll?.salaryDeductionBaseDays ?? '-'}</p></div>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-medium mb-2">งวดที่ 1</h4>
                      <div className="grid grid-cols-3 gap-4 p-4 border rounded-md">
                        <div><p className="text-sm font-medium text-muted-foreground">วันที่เริ่ม</p><p>{settings?.payroll?.period1Start ?? '-'}</p></div>
                        <div><p className="text-sm font-medium text-muted-foreground">วันที่สิ้นสุด</p><p>{settings?.payroll?.period1End ?? '-'}</p></div>
                        <div><p className="text-sm font-medium text-muted-foreground">วันที่จ่าย</p><p>{settings?.payroll?.payday1 ?? '-'}</p></div>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-medium mb-2">งวดที่ 2</h4>
                      <div className="grid grid-cols-3 gap-4 p-4 border rounded-md">
                        <div><p className="text-sm font-medium text-muted-foreground">วันที่เริ่ม</p><p>{settings?.payroll?.period2Start ?? '-'}</p></div>
                        <div><p className="text-sm font-medium text-muted-foreground">วันที่สิ้นสุด</p><p>{settings?.payroll?.period2End ?? '-'}</p></div>
                        <div><p className="text-sm font-medium text-muted-foreground">วันที่จ่าย</p><p>{settings?.payroll?.payday2 ?? '-'}</p></div>
                      </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle>ประกันสังคม (SSO)</CardTitle></CardHeader>
                 <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div><p className="text-sm font-medium text-muted-foreground">ลูกจ้าง (%)</p><p>{settings?.sso?.employeePercent ?? '-'}</p></div>
                    <div><p className="text-sm font-medium text-muted-foreground">นายจ้าง (%)</p><p>{settings?.sso?.employerPercent ?? '-'}</p></div>
                    <div><p className="text-sm font-medium text-muted-foreground">ฐานเงินเดือนขั้นต่ำ (บาท)</p><p>{settings?.sso?.monthlyMinBase?.toLocaleString() ?? '-'}</p></div>
                    <div><p className="text-sm font-medium text-muted-foreground">เพดานฐานเงินเดือน (บาท)</p><p>{settings?.sso?.monthlyCap?.toLocaleString() ?? '-'}</p></div>
                 </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle>ภาษีหัก ณ ที่จ่าย</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <InfoRow label="เปิดใช้งาน" value={settings?.withholding?.enabled ? "ใช่" : "ไม่ใช่"} />
                    <Separator />
                    <InfoRow label="เปอร์เซ็นต์ตั้งต้น (%)" value={settings?.withholding?.defaultPercent} />
                    <Separator />
                    <InfoRow label="หมายเหตุ" value={<span className="whitespace-pre-wrap">{settings?.withholding?.note}</span>} />
                </CardContent>
            </Card>
            
            {canEditSettings && (
              <>
                <Card>
                    <CardHeader>
                        <CardTitle>Admin Controls</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <InfoRow label="โหมดแก้ไขย้อนหลัง (Backfill Mode)" value={settings?.backfillMode ? "เปิด" : "ปิด"} />
                    </CardContent>
                </Card>
              </>
            )}
        </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>เวลาทำงานและเวลาพัก</CardTitle>
            <CardDescription>
              ตั้งค่าเวลาทำงานและเวลาพักมาตรฐาน
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <FormField control={form.control} name="workStart" render={({ field }) => (<FormItem><FormLabel>เวลาเข้างาน</FormLabel><FormControl><Input type="time" {...field} value={field.value ?? ""} /></FormControl></FormItem>)} />
            <FormField control={form.control} name="workEnd" render={({ field }) => (<FormItem><FormLabel>เวลาออกงาน</FormLabel><FormControl><Input type="time" {...field} value={field.value ?? ""} /></FormControl></FormItem>)} />
            <FormField control={form.control} name="breakStart" render={({ field }) => (<FormItem><FormLabel>เวลาพัก (เริ่ม)</FormLabel><FormControl><Input type="time" {...field} value={field.value ?? ""} /></FormControl></FormItem>)} />
            <FormField control={form.control} name="breakEnd" render={({ field }) => (<FormItem><FormLabel>เวลาพัก (สิ้นสุด)</FormLabel><FormControl><Input type="time" {...field} value={field.value ?? ""} /></FormControl></FormItem>)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>กติกาการบันทึกเวลา</CardTitle>
            <CardDescription>
              กฎการมาสาย, ขาด, และการป้องกันการสแกนซ้ำ
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <FormField control={form.control} name="graceMinutes" render={({ field }) => (<FormItem><FormLabel>อนุญาตให้สาย (นาที)</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? 0} /></FormControl><FormDescription>นาทีที่อนุญาตให้สายได้</FormDescription></FormItem>)} />
            <FormField control={form.control} name="absentCutoffTime" render={({ field }) => (<FormItem><FormLabel>เวลาเกินนี้ถือว่าขาดเช้า</FormLabel><FormControl><Input type="time" {...field} value={field.value ?? ""} /></FormControl><FormDescription>หลังเวลานี้ถือว่าขาด</FormDescription></FormItem>)} />
            <FormField control={form.control} name="afternoonCutoffTime" render={({ field }) => (<FormItem><FormLabel>เวลาเกินนี้ถือว่าขาดบ่าย</FormLabel><FormControl><Input type="time" {...field} value={field.value ?? ""} /></FormControl><FormDescription>เวลาตัดรอบ บ่าย/ครึ่งวัน</FormDescription></FormItem>)} />
            <FormField control={form.control} name="minSecondsBetweenScans" render={({ field }) => (<FormItem><FormLabel>หน่วงเวลาสแกนซ้ำ (วินาที)</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? 0} /></FormControl><FormDescription>กันการสแกนซ้ำ</FormDescription></FormItem>)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>กำหนดวันหยุดประจำสัปดาห์</CardTitle>
            <CardDescription>
              กำหนดวันที่ไม่ใช่วันทำงานปกติ
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="weekendPolicy.mode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>วันหยุดสุดสัปดาห์</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="เลือก..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="SAT_SUN">เสาร์ และ อาทิตย์</SelectItem>
                      <SelectItem value="SUN_ONLY">เฉพาะวันอาทิตย์</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>การตั้งค่านี้มีผลกับการคำนวณสรุปการลงเวลาในอนาคต</FormDescription>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>นโยบายการลา</CardTitle>
            <CardDescription>
              กำหนดสิทธิ์การลาประเภทต่างๆ คำนวณตามปีปฏิทิน (1 ม.ค. - 31 ธ.ค.)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <LeavePolicyFields type="SICK" form={form} />
            <LeavePolicyFields type="BUSINESS" form={form} />
            <LeavePolicyFields type="VACATION" form={form} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>รอบจ่ายเงินเดือน</CardTitle>
            <CardDescription>
              กำหนดรอบการจ่ายเงินเดือน (ปัจจุบันรองรับ 2 รอบ)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h4 className="font-medium mb-2">ทั่วไป</h4>
              <div className="grid grid-cols-3 gap-4 p-4 border rounded-md">
                <FormField control={form.control} name="payroll.salaryDeductionBaseDays" render={({ field }) => (<FormItem className="col-span-1"><FormLabel>ฐานวันหักเงินเดือน</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl><FormDescription>ฐานวันสำหรับคำนวณหักเงินเดือน</FormDescription></FormItem>)} />
              </div>
            </div>
            <div>
              <h4 className="font-medium mb-2">งวดที่ 1</h4>
              <div className="grid grid-cols-3 gap-4 p-4 border rounded-md">
                <FormField control={form.control} name="payroll.period1Start" render={({ field }) => (<FormItem><FormLabel>วันที่เริ่ม</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
                <FormField control={form.control} name="payroll.period1End" render={({ field }) => (<FormItem><FormLabel>วันที่สิ้นสุด</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
                <FormField control={form.control} name="payroll.payday1" render={({ field }) => (<FormItem><FormLabel>วันที่จ่าย</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
              </div>
            </div>
            <div>
              <h4 className="font-medium mb-2">งวดที่ 2</h4>
              <div className="grid grid-cols-3 gap-4 p-4 border rounded-md">
                <FormField control={form.control} name="payroll.period2Start" render={({ field }) => (<FormItem><FormLabel>วันที่เริ่ม</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
                <FormField control={form.control} name="payroll.period2End" render={({ field }) => (<FormItem><FormLabel>วันที่สิ้นสุด</FormLabel><FormControl><Input placeholder="EOM" {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
                <FormField control={form.control} name="payroll.payday2" render={({ field }) => (<FormItem><FormLabel>วันที่จ่าย</FormLabel><FormControl><Input placeholder="EOM" {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>ประกันสังคม (SSO)</CardTitle>
            <CardDescription>
              การตั้งค่าการคำนวณประกันสังคม
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-6">
             <FormField control={form.control} name="sso.employeePercent" render={({ field }) => (<FormItem><FormLabel>ลูกจ้าง (%)</FormLabel><FormControl><Input type="number" step="0.01" {...field} value={field.value ?? 0} /></FormControl></FormItem>)} />
             <FormField control={form.control} name="sso.employerPercent" render={({ field }) => (<FormItem><FormLabel>นายจ้าง (%)</FormLabel><FormControl><Input type="number" step="0.01" {...field} value={field.value ?? 0} /></FormControl></FormItem>)} />
             <FormField control={form.control} name="sso.monthlyMinBase" render={({ field }) => (<FormItem><FormLabel>ฐานเงินเดือนขั้นต่ำ (บาท)</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? 0} /></FormControl></FormItem>)} />
             <FormField
                control={form.control}
                name="sso.monthlyCap"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>เพดานฐานเงินเดือน (บาท)</FormLabel>
                    <FormControl><Input type="number" {...field} value={field.value ?? 0} /></FormControl>
                    <FormDescription>ฐานเงินเดือนสูงสุดที่ใช้ในการคำนวณ</FormDescription>
                  </FormItem>
                )}
              />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>ภาษีหัก ณ ที่จ่าย</CardTitle>
            <CardDescription>
              การตั้งค่าภาษีหัก ณ ที่จ่ายสำหรับเงินเดือน
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
             <FormField control={form.control} name="withholding.enabled" render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                  <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  <FormLabel className="font-normal">เปิดใช้งานภาษีหัก ณ ที่จ่าย</FormLabel>
                </FormItem>
            )} />
            <FormField control={form.control} name="withholding.defaultPercent" render={({ field }) => (<FormItem><FormLabel>เปอร์เซ็นต์ตั้งต้น (%)</FormLabel><FormControl><Input type="number" step="0.01" {...field} value={field.value ?? 0} disabled={!form.watch('withholding.enabled')} /></FormControl></FormItem>)} />
            <FormField control={form.control} name="withholding.note" render={({ field }) => (<FormItem><FormLabel>หมายเหตุ</FormLabel><FormControl><Textarea {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
          </CardContent>
        </Card>

        {canEditSettings && (
            <Card>
                <CardHeader><CardTitle>Admin Controls</CardTitle></CardHeader>
                <CardContent>
                    <FormField
                        control={form.control}
                        name="backfillMode"
                        render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                <div className="space-y-0.5">
                                    <FormLabel>โหมดแก้ไขย้อนหลัง (Backfill Mode)</FormLabel>
                                    <FormDescription>
                                        อนุญาตให้แอดมินแก้ไขข้อมูล HR ในอดีตได้ (เช่น วันหยุด, การลงเวลา)
                                    </FormDescription>
                                </div>
                                <FormControl>
                                    <Switch
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                </CardContent>
            </Card>
        )}
        
        <div className="flex justify-end gap-4 sticky bottom-0 bg-background/80 backdrop-blur-sm py-4 -mb-8">
            <Button type="button" variant="ghost" onClick={() => setIsEditing(false)} disabled={form.formState.isSubmitting}><X className="mr-2 h-4 w-4" /> ยกเลิก</Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4"/>}
              บันทึกการตั้งค่า
            </Button>
        </div>
      </form>
    </Form>
  );
}
