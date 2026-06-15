
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import type { PayrollBatch, HRSettings } from "@/lib/types";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { Loader2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

type SsoSettings = NonNullable<HRSettings['sso']>;
type SsoDecision = NonNullable<PayrollBatch['ssoDecision']>;

interface SsoDecisionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (decision: SsoDecision) => void;
  batchDecision: SsoDecision;
  currentSettings: SsoSettings;
}

const customDecisionSchema = z.object({
  employeePercent: z.coerce.number().min(0).max(100),
  monthlyMinBase: z.coerce.number().min(0),
  monthlyCap: z.coerce.number().min(0),
});

const decisionSchema = z.object({
  choice: z.enum(["current", "previous", "custom"]),
  custom: customDecisionSchema.optional(),
}).refine(data => data.choice !== 'custom' || !!data.custom, {
    message: "Custom values are required when 'custom' is selected.",
    path: ["custom"],
});

export function SsoDecisionDialog({ isOpen, onClose, onConfirm, batchDecision, currentSettings }: SsoDecisionDialogProps) {
  const form = useForm<z.infer<typeof decisionSchema>>({
    resolver: zodResolver(decisionSchema),
    defaultValues: {
      choice: "current",
      custom: { 
        employeePercent: currentSettings.employeePercent || 0,
        monthlyMinBase: currentSettings.monthlyMinBase || 0,
        monthlyCap: currentSettings.monthlyCap || 0
      },
    },
  });

  const choice = form.watch("choice");

  const handleSubmit = (data: z.infer<typeof decisionSchema>) => {
    let finalDecision: SsoDecision;

    if (data.choice === "current") {
      finalDecision = { 
        employeePercent: currentSettings.employeePercent || 0,
        employerPercent: currentSettings.employerPercent || 0,
        monthlyMinBase: currentSettings.monthlyMinBase || 0,
        monthlyCap: currentSettings.monthlyCap || 0,
        source: 'HR_OVERRIDE' 
      } as SsoDecision;
    } else if (data.choice === "custom" && data.custom) {
      finalDecision = { 
        ...data.custom, 
        employerPercent: currentSettings.employerPercent || 0,
        source: 'CUSTOM' 
      } as SsoDecision;
    } else { // 'previous'
      finalDecision = { ...batchDecision, source: 'MONTH_LOCKED_PREVIOUS' }; 
    }
    onConfirm(finalDecision);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="text-amber-500" />
            ตรวจพบการเปลี่ยนแปลงการตั้งค่าประกันสังคม
          </DialogTitle>
          <DialogDescription>
            การตั้งค่าประกันสังคมใน HR Settings เปลี่ยนจากค่าที่ล็อกไว้ในเดือนนี้ กรุณาเลือกวิธีคำนวณสำหรับเดือนนี้
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-4">
            <Card className="bg-muted/30">
                <CardContent className="pt-6">
                    <h3 className="font-bold text-xs uppercase text-muted-foreground mb-3">ค่าที่ล็อกไว้ (งวดที่ 1)</h3>
                    <div className="space-y-1">
                        <p className="text-sm">Rate: <span className="font-bold">{batchDecision?.employeePercent || 0}%</span></p>
                        <p className="text-sm">Min Base: <span className="font-bold">฿{Number(batchDecision?.monthlyMinBase || 0).toLocaleString()}</span></p>
                        <p className="text-sm">Cap: <span className="font-bold">฿{Number(batchDecision?.monthlyCap || 0).toLocaleString()}</span></p>
                    </div>
                </CardContent>
            </Card>
             <Card className="border-primary/20 bg-primary/5">
                <CardContent className="pt-6">
                    <h3 className="font-bold text-xs uppercase text-primary mb-3">ค่าปัจจุบัน (จาก Settings)</h3>
                    <div className="space-y-1">
                        <p className="text-sm">Rate: <span className="font-bold">{currentSettings.employeePercent || 0}%</span></p>
                        <p className="text-sm">Min Base: <span className="font-bold">฿{Number(currentSettings.monthlyMinBase || 0).toLocaleString()}</span></p>
                        <p className="text-sm">Cap: <span className="font-bold">฿{Number(currentSettings.monthlyCap || 0).toLocaleString()}</span></p>
                    </div>
                </CardContent>
            </Card>
        </div>
        <Form {...form}>
            <form id="sso-decision-form" onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                <FormField
                    control={form.control}
                    name="choice"
                    render={({ field }) => (
                        <FormItem className="space-y-3">
                        <FormLabel className="font-bold">สำหรับเดือนนี้ คุณต้องการ...</FormLabel>
                        <FormControl>
                            <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex flex-col space-y-2">
                                <FormItem className="flex items-center space-x-3 space-y-0 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors">
                                    <FormControl><RadioGroupItem value="previous" /></FormControl>
                                    <FormLabel className="font-medium cursor-pointer">ใช้ค่าที่ล็อกไว้เดิมสำหรับทั้งเดือน (แนะนำ)</FormLabel>
                                </FormItem>
                                <FormItem className="flex items-center space-x-3 space-y-0 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors">
                                    <FormControl><RadioGroupItem value="current" /></FormControl>
                                    <FormLabel className="font-medium cursor-pointer">ใช้ค่าปัจจุบันสำหรับทั้งเดือน (ระบบจะปรับปรุงยอดหักในงวดที่ 2)</FormLabel>
                                </FormItem>
                                <FormItem className="flex items-center space-x-3 space-y-0 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors">
                                    <FormControl><RadioGroupItem value="custom" /></FormControl>
                                    <FormLabel className="font-medium cursor-pointer">กำหนดค่าสำหรับเดือนนี้เอง</FormLabel>
                                </FormItem>
                            </RadioGroup>
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                />

                {choice === 'custom' && (
                     <Card className="p-4 bg-muted/50 animate-in fade-in slide-in-from-top-1">
                        <div className="grid grid-cols-3 gap-4">
                            <FormField control={form.control} name="custom.employeePercent" render={({ field }) => (<FormItem><FormLabel>Rate (%)</FormLabel><FormControl><Input type="number" step="0.01" {...field} value={field.value ?? 0} /></FormControl></FormItem>)} />
                            <FormField control={form.control} name="custom.monthlyMinBase" render={({ field }) => (<FormItem><FormLabel>Min Base</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? 0} /></FormControl></FormItem>)} />
                            <FormField control={form.control} name="custom.monthlyCap" render={({ field }) => (<FormItem><FormLabel>Cap</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? 0} /></FormControl></FormItem>)} />
                        </div>
                    </Card>
                )}
            </form>
        </Form>
        <DialogFooter className="mt-6">
          <Button type="button" variant="outline" onClick={onClose}>ยกเลิก</Button>
          <Button type="submit" form="sso-decision-form" className="min-w-[150px]">
            ยืนยันและคำนวณใหม่
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
