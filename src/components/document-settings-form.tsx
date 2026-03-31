
"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { doc, setDoc } from "firebase/firestore";

import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useDoc } from "@/firebase/firestore/use-doc";
import { useToast } from "@/hooks/use-toast";
import type { DocumentSettings } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Loader2, Save, Edit, X } from "lucide-react";
import { Skeleton } from "./ui/skeleton";
import { Separator } from "./ui/separator";

const documentSettingsSchema = z.object({
  quotationPrefix: z.string().optional(),
  deliveryNotePrefix: z.string().optional(),
  taxInvoicePrefix: z.string().optional(),
  receiptPrefix: z.string().optional(),
  billingNotePrefix: z.string().optional(),
  creditNotePrefix: z.string().optional(),
  debitNotePrefix: z.string().optional(),
  withholdingTaxPrefix: z.string().optional(),
  purchasePrefix: z.string().optional(),
  withdrawalPrefix: z.string().optional(),
});

const InfoRow = ({ label, value }: { label: string, value: React.ReactNode }) => (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="text-sm font-mono sm:text-right">{value || '-'}</p>
    </div>
);

export function DocumentSettingsForm() {
  const { db } = useFirebase();
  const { toast } = useToast();
  const { profile } = useAuth();
  const [isEditing, setIsEditing] = useState(false);

  const canEditSettings = profile?.role === 'ADMIN' || profile?.department === 'ACCOUNTING_HR';

  const settingsDocRef = useMemo(() => {
    if (!db) return null;
    return doc(db, "settings", "documents");
  }, [db]);

  const { data: settings, isLoading } = useDoc<DocumentSettings>(settingsDocRef);

  const form = useForm<z.infer<typeof documentSettingsSchema>>({
    resolver: zodResolver(documentSettingsSchema),
    defaultValues: {},
  });

  useEffect(() => {
    if (settings) {
      form.reset(settings);
    }
  }, [settings, form]);

  const onSubmit = async (values: z.infer<typeof documentSettingsSchema>) => {
    if (!settingsDocRef) return;
    try {
      await setDoc(settingsDocRef, values, { merge: true });
      toast({
        title: "Settings Saved",
        description: "Document settings have been updated successfully.",
      });
      setIsEditing(false);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error Saving Settings",
        description: error.message,
      });
    }
  };

  if (isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }
  
  if (!isEditing) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>เลขที่เอกสาร</CardTitle>
                    <CardDescription>คำนำหน้า (Prefix) สำหรับเอกสารแต่ละประเภท</CardDescription>
                </div>
                {canEditSettings && <Button variant="outline" onClick={() => setIsEditing(true)}><Edit /> Edit</Button>}
            </CardHeader>
            <CardContent className="space-y-1">
                <Separator />
                <InfoRow label="ใบเสนอราคา" value={settings?.quotationPrefix} />
                <Separator />
                <InfoRow label="ใบส่งของชั่วคราว" value={settings?.deliveryNotePrefix} />
                <Separator />
                <InfoRow label="ใบกำกับภาษี" value={settings?.taxInvoicePrefix} />
                <Separator />
                <InfoRow label="ใบเสร็จรับเงิน" value={settings?.receiptPrefix} />
                <Separator />
                <InfoRow label="ใบวางบิล" value={settings?.billingNotePrefix} />
                <Separator />
                <InfoRow label="ใบลดหนี้" value={settings?.creditNotePrefix} />
                <Separator />
                <InfoRow label="ใบเพิ่มหนี้" value={settings?.debitNotePrefix} />
                <Separator />
                <InfoRow label="หนังสือหัก ณ ที่จ่าย" value={settings?.withholdingTaxPrefix} />
                <Separator />
                <InfoRow label="เอกสารจัดซื้อ" value={settings?.purchasePrefix} />
                <Separator />
                <InfoRow label="ใบเบิกอะไหล่" value={settings?.withdrawalPrefix} />
            </CardContent>
        </Card>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>แก้ไขเลขที่เอกสาร</CardTitle>
            <CardDescription>
              กำหนดคำนำหน้า (Prefix) สำหรับเอกสารแต่ละประเภท
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField control={form.control} name="quotationPrefix" render={({ field }) => (<FormItem><FormLabel>ใบเสนอราคา</FormLabel><FormControl><Input placeholder="QT" {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
            <FormField control={form.control} name="deliveryNotePrefix" render={({ field }) => (<FormItem><FormLabel>ใบส่งของชั่วคราว</FormLabel><FormControl><Input placeholder="DN" {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
            <FormField control={form.control} name="taxInvoicePrefix" render={({ field }) => (<FormItem><FormLabel>ใบกำกับภาษี</FormLabel><FormControl><Input placeholder="INV" {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
            <FormField control={form.control} name="receiptPrefix" render={({ field }) => (<FormItem><FormLabel>ใบเสร็จรับเงิน</FormLabel><FormControl><Input placeholder="RE" {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
            <FormField control={form.control} name="billingNotePrefix" render={({ field }) => (<FormItem><FormLabel>ใบวางบิล</FormLabel><FormControl><Input placeholder="BN" {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
            <FormField control={form.control} name="creditNotePrefix" render={({ field }) => (<FormItem><FormLabel>ใบลดหนี้</FormLabel><FormControl><Input placeholder="CN" {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
            <FormField control={form.control} name="debitNotePrefix" render={({ field }) => (<FormItem><FormLabel>ใบเพิ่มหนี้</FormLabel><FormControl><Input placeholder="DBN" {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
            <FormField control={form.control} name="withholdingTaxPrefix" render={({ field }) => (<FormItem><FormLabel>หนังสือหัก ณ ที่จ่าย</FormLabel><FormControl><Input placeholder="WHT" {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
            <FormField control={form.control} name="purchasePrefix" render={({ field }) => (<FormItem><FormLabel>เอกสารจัดซื้อ</FormLabel><FormControl><Input placeholder="PUR" {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
            <FormField control={form.control} name="withdrawalPrefix" render={({ field }) => (<FormItem><FormLabel>ใบเบิกอะไหล่</FormLabel><FormControl><Input placeholder="SWD" {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
          </CardContent>
        </Card>
        
        <div className="flex justify-end gap-4">
            <Button type="button" variant="ghost" onClick={() => setIsEditing(false)} disabled={form.formState.isSubmitting}><X className="mr-2 h-4 w-4" /> Cancel</Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4"/>}
              Save Settings
            </Button>
        </div>
      </form>
    </Form>
  );
}
